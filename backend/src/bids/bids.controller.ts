import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BidsService } from './bids.service';
import { SubmitBidDto } from './dto/submit-bid.dto';

@Controller('api/rfqs/:rfqId/bids')
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  @Post()
  submit(@Param('rfqId', ParseUUIDPipe) rfqId: string, @Body() dto: SubmitBidDto) {
    return this.bids.submit(rfqId, dto);
  }
}
