import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.module';
import { SsCronService } from './ss-cron.service';

// Admin only (the role check is inside the service). Lets you run the hourly checks
// right now, for testing, instead of waiting for the next hour.
@ApiTags('Small Small: Admin')
@Controller('small-small/admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SsCronController {
  constructor(private readonly cron: SsCronService) {}

  @Post('run-checks')
  @ApiOperation({ summary: 'Admin: run the reminders, auto-payments, missed-payment and deadline checks now' })
  run(@Req() req: any) { return this.cron.runNowAs(req.user.id, req.ip); }
}