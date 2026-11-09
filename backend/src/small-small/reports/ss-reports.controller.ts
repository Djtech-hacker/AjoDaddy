import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/auth.module';
import { SsReportsService } from './ss-reports.service';
import { ReportVendorDto } from './dto/reports.dto';

@ApiTags('Small Small: Reports')
@Controller('small-small/reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SsReportsController {
  constructor(private readonly reports: SsReportsService) {}

  @Post('vendor')
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Report a vendor to customer care (from a product, a plan or a chat)' })
  reportVendor(@Req() req: any, @Body() dto: ReportVendorDto) {
    return this.reports.reportVendor(req.user.id, dto, req.ip);
  }
}