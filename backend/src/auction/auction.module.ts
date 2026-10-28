import { Module } from '@nestjs/common';
import { CloserService } from './closer.service';

@Module({ providers: [CloserService] })
export class AuctionModule {}
