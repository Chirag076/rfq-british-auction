import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuctionStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { rank, rankLabels, validateCloseTimes, type Quote } from '../auction/engine';
import { CreateRfqDto } from './dto/create-rfq.dto';

@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async create(dto: CreateRfqDto) {
    const bidStartAt = new Date(dto.bidStartAt);
    const bidCloseAt = new Date(dto.bidCloseAt);
    const forcedCloseAt = new Date(dto.forcedCloseAt);

    // The brief states this as an invariant, so it is enforced here as well as
    // in the UI: a form is a convenience, not a constraint.
    const errors = validateCloseTimes({ bidStartAt, bidCloseAt, forcedCloseAt });
    if (errors.length) throw new BadRequestException(errors);

    const rfq = await this.prisma.rfq.create({
      data: {
        reference: dto.reference,
        name: dto.name,
        bidStartAt,
        bidCloseAt,
        originalCloseAt: bidCloseAt,
        forcedCloseAt,
        pickupDate: new Date(dto.pickupDate),
        britishAuction: dto.britishAuction ?? true,
        triggerWindowMinutes: dto.triggerWindowMinutes,
        extensionMinutes: dto.extensionMinutes,
        trigger: dto.trigger,
        status: bidStartAt <= new Date() ? AuctionStatus.ACTIVE : AuctionStatus.SCHEDULED,
      },
    });

    this.events.emitListChanged();
    return rfq;
  }

  /** The listing page: one row per auction with just enough to decide where to look. */
  async list() {
    const rfqs = await this.prisma.rfq.findMany({
      orderBy: { bidCloseAt: 'asc' },
      include: {
        bids: {
          where: { superseded: false },
          orderBy: { totalAmount: 'asc' },
          take: 1,
          include: { supplier: true },
        },
        _count: { select: { bids: true } },
      },
    });

    return rfqs.map((rfq) => ({
      id: rfq.id,
      reference: rfq.reference,
      name: rfq.name,
      status: rfq.status,
      britishAuction: rfq.britishAuction,
      bidCloseAt: rfq.bidCloseAt,
      forcedCloseAt: rfq.forcedCloseAt,
      originalCloseAt: rfq.originalCloseAt,
      trigger: rfq.trigger,
      triggerWindowMinutes: rfq.triggerWindowMinutes,
      extensionMinutes: rfq.extensionMinutes,
      bidCount: rfq._count.bids,
      lowestBid: rfq.bids[0]
        ? {
            totalAmount: Number(rfq.bids[0].totalAmount),
            supplierName: rfq.bids[0].supplier.name,
            carrierName: rfq.bids[0].carrierName,
          }
        : null,
    }));
  }

  /** The details page: every live quote ranked, the config, and the full log. */
  async detail(id: string) {
    const rfq = await this.prisma.rfq.findUnique({
      where: { id },
      include: {
        bids: {
          where: { superseded: false },
          orderBy: [{ totalAmount: 'asc' }, { placedAt: 'asc' }],
          include: { supplier: true },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { bid: { include: { supplier: true } } },
        },
      },
    });
    if (!rfq) throw new NotFoundException('RFQ not found');

    const quotes: Quote[] = rfq.bids.map((b) => ({
      supplierId: b.supplierId,
      totalAmount: Number(b.totalAmount),
      placedAt: b.placedAt,
    }));
    const labels = rankLabels(quotes);

    return {
      id: rfq.id,
      reference: rfq.reference,
      name: rfq.name,
      status: rfq.status,
      britishAuction: rfq.britishAuction,
      bidStartAt: rfq.bidStartAt,
      bidCloseAt: rfq.bidCloseAt,
      originalCloseAt: rfq.originalCloseAt,
      forcedCloseAt: rfq.forcedCloseAt,
      pickupDate: rfq.pickupDate,
      config: {
        triggerWindowMinutes: rfq.triggerWindowMinutes,
        extensionMinutes: rfq.extensionMinutes,
        trigger: rfq.trigger,
      },
      // How far the auction has already moved, which is the headline the brief's
      // success metrics ask about.
      extendedByMinutes: Math.round(
        (rfq.bidCloseAt.getTime() - rfq.originalCloseAt.getTime()) / 60_000,
      ),
      ranking: rank(quotes),
      bids: rfq.bids.map((b) => ({
        id: b.id,
        rank: labels.get(b.supplierId) ?? null,
        supplierId: b.supplierId,
        supplierName: b.supplier.name,
        carrierName: b.carrierName,
        freightCharges: Number(b.freightCharges),
        originCharges: Number(b.originCharges),
        destinationCharges: Number(b.destinationCharges),
        totalAmount: Number(b.totalAmount),
        transitTimeDays: b.transitTimeDays,
        validUntil: b.validUntil,
        placedAt: b.placedAt,
      })),
      events: rfq.events.map((e) => ({
        id: e.id,
        type: e.type,
        reason: e.reason,
        supplierName: e.bid?.supplier.name ?? null,
        previousCloseAt: e.previousCloseAt,
        newCloseAt: e.newCloseAt,
        createdAt: e.createdAt,
      })),
    };
  }

  async suppliers() {
    return this.prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  }
}
