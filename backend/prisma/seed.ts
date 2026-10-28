/**
 * Seed data built for a demo, not for a screenshot.
 *
 * The point is that a reviewer can run one command and immediately watch an
 * extension happen. So one auction closes five minutes from now with a trigger
 * window that is already open: any qualifying bid pushes the clock out, live,
 * while they are looking at it.
 *
 * The other two exist to show the states the listing page has to handle —
 * a scheduled auction and one that already force-closed against its ceiling.
 */
import { AuctionStatus, EventType, ExtensionTrigger, Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const minutes = (n: number) => n * 60_000;
const from = (base: number, mins: number) => new Date(base + minutes(mins));

async function main() {
  await prisma.auctionEvent.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.rfq.deleteMany();
  await prisma.supplier.deleteMany();

  const suppliers = await Promise.all(
    [
      ['Maersk Line', 'ops@maersk.example'],
      ['Hapag-Lloyd', 'quotes@hapag.example'],
      ['CMA CGM', 'desk@cmacgm.example'],
      ['MSC', 'bids@msc.example'],
    ].map(([name, email]) => prisma.supplier.create({ data: { name, email } })),
  );

  const now = Date.now();

  // --- the one to watch: closing in five minutes, window already open ------
  const live = await prisma.rfq.create({
    data: {
      reference: 'RFQ-2026-101',
      name: 'Nhava Sheva to Rotterdam, 2x40ft HC',
      bidStartAt: from(now, -30),
      bidCloseAt: from(now, 5),
      originalCloseAt: from(now, 5),
      forcedCloseAt: from(now, 11),
      pickupDate: from(now, 60 * 24 * 9),
      triggerWindowMinutes: 5,
      extensionMinutes: 3,
      trigger: ExtensionTrigger.L1_CHANGE,
      status: AuctionStatus.ACTIVE,
    },
  });

  // Two standing quotes so the board is not empty and a third bid can visibly
  // take L1 off someone.
  const opening: Array<[number, number, number, number, number]> = [
    [0, 184000, 12500, 9800, 24],
    [1, 191500, 11000, 10400, 21],
  ];
  for (const [i, freight, origin, destination, transit] of opening) {
    const total = freight + origin + destination;
    const bid = await prisma.bid.create({
      data: {
        rfqId: live.id,
        supplierId: suppliers[i].id,
        carrierName: `${suppliers[i].name} Express`,
        freightCharges: new Prisma.Decimal(freight),
        originCharges: new Prisma.Decimal(origin),
        destinationCharges: new Prisma.Decimal(destination),
        totalAmount: new Prisma.Decimal(total),
        transitTimeDays: transit,
        validUntil: from(now, 60 * 24 * 14),
        placedAt: from(now, -20 + i),
      },
    });
    await prisma.auctionEvent.create({
      data: {
        rfqId: live.id,
        bidId: bid.id,
        type: EventType.BID_PLACED,
        reason: `${suppliers[i].name} quoted ${total.toFixed(2)} (${suppliers[i].name} Express)`,
        createdAt: from(now, -20 + i),
      },
    });
  }

  // --- not open yet --------------------------------------------------------
  await prisma.rfq.create({
    data: {
      reference: 'RFQ-2026-102',
      name: 'Chennai to Jebel Ali, 1x20ft',
      bidStartAt: from(now, 45),
      bidCloseAt: from(now, 120),
      originalCloseAt: from(now, 120),
      forcedCloseAt: from(now, 150),
      pickupDate: from(now, 60 * 24 * 12),
      triggerWindowMinutes: 10,
      extensionMinutes: 5,
      trigger: ExtensionTrigger.ANY_RANK_CHANGE,
      status: AuctionStatus.SCHEDULED,
    },
  });

  // --- already hit the ceiling --------------------------------------------
  const forced = await prisma.rfq.create({
    data: {
      reference: 'RFQ-2026-099',
      name: 'Mundra to Hamburg, 3x40ft',
      bidStartAt: from(now, -180),
      bidCloseAt: from(now, -60),
      originalCloseAt: from(now, -90),
      forcedCloseAt: from(now, -60),
      pickupDate: from(now, 60 * 24 * 4),
      triggerWindowMinutes: 10,
      extensionMinutes: 10,
      trigger: ExtensionTrigger.BID_RECEIVED,
      status: AuctionStatus.FORCE_CLOSED,
    },
  });
  const winner = await prisma.bid.create({
    data: {
      rfqId: forced.id,
      supplierId: suppliers[2].id,
      carrierName: 'CMA CGM Direct',
      freightCharges: new Prisma.Decimal(276000),
      originCharges: new Prisma.Decimal(18200),
      destinationCharges: new Prisma.Decimal(15400),
      totalAmount: new Prisma.Decimal(309600),
      transitTimeDays: 26,
      validUntil: from(now, 60 * 24 * 7),
      placedAt: from(now, -61),
    },
  });
  await prisma.auctionEvent.createMany({
    data: [
      {
        rfqId: forced.id,
        bidId: winner.id,
        type: EventType.AUCTION_EXTENDED,
        reason:
          'a bid was received inside the trigger window; extended to the forced close time (a full 10 minutes would have passed it)',
        previousCloseAt: from(now, -70),
        newCloseAt: from(now, -60),
        createdAt: from(now, -70),
      },
      {
        rfqId: forced.id,
        bidId: winner.id,
        type: EventType.EXTENSION_CAPPED,
        reason:
          'a bid was received inside the trigger window, but the forced close time has been reached so the auction cannot extend further',
        previousCloseAt: from(now, -60),
        newCloseAt: from(now, -60),
        createdAt: from(now, -61),
      },
      {
        rfqId: forced.id,
        type: EventType.AUCTION_CLOSED,
        reason:
          'Auction force-closed: bidding was still extending it when the forced close time was reached.',
        createdAt: from(now, -60),
      },
    ],
  });

  console.log(`Seeded ${suppliers.length} suppliers and 3 RFQs.`);
  console.log(`Watch RFQ-2026-101 — it closes in 5 minutes and its trigger window is already open.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
