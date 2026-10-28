import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuctionStatus, EventType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

/**
 * Finalises auctions whose time is up.
 *
 * A closing job is not the only way to do this — status could be derived from
 * the clock on every read, with no job at all. That is tempting and wrong here
 * for two reasons.
 *
 * The brief wants an activity log with a close event in it, and a derived
 * status produces no event: nothing ever happens, the answer just changes.
 * And CLOSED has to be told apart from FORCE_CLOSED, which depends on whether
 * a trigger was still firing at the end — something only the history knows.
 *
 * So the clock stays authoritative for *accepting bids* (checked directly in
 * BidsService, because this job runs on an interval and a bid must never slip
 * through in the seconds between), while the job is authoritative for the
 * recorded outcome.
 */
@Injectable()
export class CloserService {
  private readonly logger = new Logger(CloserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async sweep() {
    const now = new Date();

    // Open auctions whose start time has arrived.
    const started = await this.prisma.rfq.updateMany({
      where: { status: AuctionStatus.SCHEDULED, bidStartAt: { lte: now } },
      data: { status: AuctionStatus.ACTIVE },
    });

    const due = await this.prisma.rfq.findMany({
      where: { status: AuctionStatus.ACTIVE, bidCloseAt: { lte: now } },
      select: { id: true, bidCloseAt: true, forcedCloseAt: true, reference: true },
    });

    for (const rfq of due) {
      // Force-closed means the auction was still being extended when it ran
      // out of ceiling, not merely that it happened to end at that instant.
      // The capped event is the evidence; without it an auction that simply
      // had its close configured to equal the ceiling would be mislabelled.
      const capped = await this.prisma.auctionEvent.count({
        where: { rfqId: rfq.id, type: EventType.EXTENSION_CAPPED },
      });
      const forceClosed = capped > 0 && rfq.bidCloseAt.getTime() >= rfq.forcedCloseAt.getTime();

      await this.prisma.$transaction([
        this.prisma.rfq.update({
          where: { id: rfq.id },
          data: { status: forceClosed ? AuctionStatus.FORCE_CLOSED : AuctionStatus.CLOSED },
        }),
        this.prisma.auctionEvent.create({
          data: {
            rfqId: rfq.id,
            type: EventType.AUCTION_CLOSED,
            reason: forceClosed
              ? 'Auction force-closed: bidding was still extending it when the forced close time was reached.'
              : 'Auction closed: no further qualifying activity before the close time.',
          },
        }),
      ]);

      this.events.emitAuctionChanged(rfq.id, { closed: true });
      this.logger.log(`${rfq.reference} ${forceClosed ? 'force-closed' : 'closed'}`);
    }

    if (started.count || due.length) this.events.emitListChanged();
  }
}
