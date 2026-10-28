import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Used as the platform health check.
   *
   * It runs a real query rather than returning a constant. A health check that
   * only proves the process is alive will report healthy while every request
   * fails on a dead database, which is the one case the check exists for.
   */
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', at: new Date().toISOString() };
  }
}
