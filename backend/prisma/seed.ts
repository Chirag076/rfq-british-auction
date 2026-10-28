/**
 * Seed the database from the command line.
 *
 * The data itself lives in `src/demo/demo.seed.ts` so that this script, the
 * API's first-boot seed and `POST /api/demo/reset` all produce the same thing.
 * Three copies of a dataset drift, and the one that drifts is always the one
 * the reviewer sees.
 */
import { PrismaClient } from '@prisma/client';

import { seedDemoData } from '../src/demo/demo.seed';

const prisma = new PrismaClient();

seedDemoData(prisma)
  .then((result) => {
    console.log(`Seeded ${result.suppliers} suppliers and ${result.rfqs} RFQs.`);
    console.log(
      `Watch ${result.liveReference} — it closes in ${result.closesInMinutes} minutes and its trigger window is already open.`,
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
