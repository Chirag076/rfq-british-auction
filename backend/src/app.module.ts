import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { RfqModule } from './rfq/rfq.module';
import { BidsModule } from './bids/bids.module';
import { AuctionModule } from './auction/auction.module';
import { DemoModule } from './demo/demo.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    EventsModule,
    RfqModule,
    BidsModule,
    AuctionModule,
    DemoModule,
    HealthModule,
  ],
})
export class AppModule {}
