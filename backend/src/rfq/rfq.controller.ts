import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';

@Controller('api')
export class RfqController {
  constructor(private readonly rfqs: RfqService) {}

  @Get('rfqs')
  list() {
    return this.rfqs.list();
  }

  @Post('rfqs')
  create(@Body() dto: CreateRfqDto) {
    return this.rfqs.create(dto);
  }

  @Get('rfqs/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.detail(id);
  }

  @Get('suppliers')
  suppliers() {
    return this.rfqs.suppliers();
  }
}
