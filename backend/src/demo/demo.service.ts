import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { seedDemoData, SeedResult } from './demo.seed';

/**
 * Demo data management.
 *
 * Two jobs, both of which exist because this is a reviewable assignment rather
 * than a production system:
 *
 * 1. Seed an empty database on boot. A fresh deployment that shows nothing is
 *    a worse first impression than one that shows a live auction.
 * 2. Re-seed on request. The interesting auction closes five minutes after the
 *    seed runs, which on a hosted deployment means five minutes after *deploy*
 *    — long gone by the time anyone opens the link.
 *
 * Boot seeding only touches an empty database, so a restart never destroys
 * whatever a reviewer was in the middle of.
 */
@Injectable()
export class DemoService implements OnModuleInit {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async onModuleInit() {
    const existing = await this.prisma.rfq.count();
    if (existing > 0) {
      this.logger.log(`${existing} RFQs already present, skipping the seed.`);
      return;
    }
    const result = await seedDemoData(this.prisma);
    this.logger.log(`Seeded an empty database: ${result.rfqs} RFQs, ${result.suppliers} suppliers.`);
  }

  async reset(): Promise<SeedResult> {
    const result = await seedDemoData(this.prisma);
    this.events.emitListChanged();
    this.logger.log('Demo data reset on request.');
    return result;
  }
}
