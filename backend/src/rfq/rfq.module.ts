import { Module } from '@nestjs/common';
import { RfqController } from './rfq.controller';
import { RfqService } from './rfq.service';

@Module({ controllers: [RfqController], providers: [RfqService] })
export class RfqModule {}
