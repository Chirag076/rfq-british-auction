import { Controller, Post } from '@nestjs/common';

import { DemoService } from './demo.service';

@Controller('api/demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  /**
   * Wipe and re-seed, so the live deployment always has an auction that is
   * about to close. Destructive by design, and only acceptable because this
   * is a demo: a real system would put this behind an admin role, or not
   * ship it at all. Called out as a limitation in the README.
   */
  @Post('reset')
  reset() {
    return this.demo.reset();
  }
}
