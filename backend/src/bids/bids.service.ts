import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuctionStatus, EventType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { decideExtension, rank, type Quote } from '../auction/engine';
import { SubmitBidDto } from './dto/submit-bid.dto';

@Injectable()
export class BidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Submit a quote, and let it move the finish line if the rules say so.
   *
   * This is the only interesting write in the system, and the whole of it runs
   * inside one transaction that begins by locking the RFQ row.
   *
   * The lock is the point. Reading the ranking, inserting a bid, recomputing
   * the ranking and moving the close time is a read-modify-write on shared
   * state, and the moment it matters most — the final seconds — is exactly
   * when two suppliers are most likely to do it at once. Without the lock,
   * two bids landing together both read the same "before" ranking, both decide
   * to extend, and the auction either jumps 2Y into the future or loses an
   * extension entirely, depending on which write lands last. Neither failure
   * raises anything; the auction just quietly ends at the wrong time.
   *
   * `FOR UPDATE` serialises them: the second bid waits, then reads a ranking
   * that already includes the first.
   */
  async submit(rfqId: string, dto: SubmitBidDto) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Take the row lock before reading anything that the decision depends on.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Rfq" WHERE id = ${rfqId} FOR UPDATE
        `;
        if (locked.length === 0) throw new NotFoundException('RFQ not found');

        const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: rfqId } });
        const now = new Date();

        this.assertOpen(rfq, now);

        const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const live = await tx.bid.findMany({
          where: { rfqId, superseded: false },
          select: { supplierId: true, totalAmount: true, placedAt: true },
        });
        const before: Quote[] = live.map(toQuote);

        const total =
          Number(dto.freightCharges) + Number(dto.originCharges) + Number(dto.destinationCharges);

        this.assertImproves(before, dto.supplierId, total);

        // One live quote per supplier: the previous one stops counting.
        await tx.bid.updateMany({
          where: { rfqId, supplierId: dto.supplierId, superseded: false },
          data: { superseded: true },
        });

        const bid = await tx.bid.create({
          data: {
            rfqId,
            supplierId: dto.supplierId,
            carrierName: dto.carrierName,
            freightCharges: new Prisma.Decimal(dto.freightCharges),
            originCharges: new Prisma.Decimal(dto.originCharges),
            destinationCharges: new Prisma.Decimal(dto.destinationCharges),
            totalAmount: new Prisma.Decimal(total),
            transitTimeDays: dto.transitTimeDays,
            validUntil: new Date(dto.validUntil),
            placedAt: now,
          },
        });

        const after: Quote[] = [
          ...before.filter((q) => q.supplierId !== dto.supplierId),
          { supplierId: dto.supplierId, totalAmount: total, placedAt: now },
        ];

        await tx.auctionEvent.create({
          data: {
            rfqId,
            bidId: bid.id,
            type: EventType.BID_PLACED,
            reason: `${supplier.name} quoted ${total.toFixed(2)} (${dto.carrierName})`,
          },
        });

        const decision = decideExtension({
          now,
          bidCloseAt: rfq.bidCloseAt,
          forcedCloseAt: rfq.forcedCloseAt,
          config: {
            triggerWindowMinutes: rfq.triggerWindowMinutes,
            extensionMinutes: rfq.extensionMinutes,
            trigger: rfq.trigger,
          },
          rankingBefore: rank(before),
          rankingAfter: rank(after),
        });

        if (decision.extend) {
          await tx.rfq.update({
            where: { id: rfqId },
            data: { bidCloseAt: decision.newCloseAt },
          });
          await tx.auctionEvent.create({
            data: {
              rfqId,
              bidId: bid.id,
              type: EventType.AUCTION_EXTENDED,
              reason: decision.reason,
              previousCloseAt: rfq.bidCloseAt,
              newCloseAt: decision.newCloseAt,
            },
          });
        } else if (decision.capped) {
          // Worth recording even though nothing moved: this is the evidence
          // that the auction ended because it ran out of ceiling, not because
          // bidding stopped.
          await tx.auctionEvent.create({
            data: {
              rfqId,
              bidId: bid.id,
              type: EventType.EXTENSION_CAPPED,
              reason: decision.reason,
              previousCloseAt: rfq.bidCloseAt,
              newCloseAt: rfq.bidCloseAt,
            },
          });
        }

        return { bidId: bid.id, decision };
      },
      // Serializable would also be correct, but it makes conflicting bids fail
      // and retry rather than queue. An explicit row lock queues them, which is
      // the behaviour a supplier expects: their bid waits a few milliseconds
      // instead of being rejected at 17:59:59.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
    );

    this.events.emitAuctionChanged(rfqId, { bidId: result.bidId });
    this.events.emitListChanged();
    return result;
  }

  private assertOpen(
    rfq: { status: AuctionStatus; bidStartAt: Date; bidCloseAt: Date; britishAuction: boolean },
    now: Date,
  ) {
    if (!rfq.britishAuction) {
      throw new BadRequestException('This RFQ is not running as a British auction.');
    }
    if (now < rfq.bidStartAt) {
      throw new BadRequestException(`Bidding opens at ${rfq.bidStartAt.toISOString()}.`);
    }
    // Checked against the clock rather than the stored status: the closing job
    // runs on an interval, so for a few seconds after the close the row can
    // still say ACTIVE. Trusting the status here would let a bid in after time.
    if (now >= rfq.bidCloseAt || rfq.status === AuctionStatus.CLOSED || rfq.status === AuctionStatus.FORCE_CLOSED) {
      throw new BadRequestException('Bidding on this auction has closed.');
    }
  }

  /**
   * A supplier may only improve on their own standing quote.
   *
   * Without this a supplier can "bid" upward in the last seconds to trigger an
   * extension under BID_RECEIVED while giving up nothing — the exact
   * manipulation the brief's trigger window is there to prevent.
   */
  private assertImproves(before: Quote[], supplierId: string, total: number) {
    const own = before.find((q) => q.supplierId === supplierId);
    if (own && total >= own.totalAmount) {
      throw new BadRequestException(
        `Your current quote is ${own.totalAmount.toFixed(2)}. A new quote must be lower.`,
      );
    }
  }
}

function toQuote(row: { supplierId: string; totalAmount: Prisma.Decimal; placedAt: Date }): Quote {
  return {
    supplierId: row.supplierId,
    totalAmount: Number(row.totalAmount),
    placedAt: row.placedAt,
  };
}
