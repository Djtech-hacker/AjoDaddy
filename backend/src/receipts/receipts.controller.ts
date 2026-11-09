import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/auth.module';
import { ReceiptsService } from './receipts.service';

@ApiTags('Receipts')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  // PUBLIC: anyone holding a receipt can check it is real. Declared first so "verify" is never read as an id.
  @Get('verify/:code')
  @Throttle({ long: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check a printed receipt against the real record (public)' })
  verify(@Param('code') code: string) {
    return this.receipts.verify(code);
  }

  // The owner asks for the verification code to print on their receipt
  @Get(':txId/code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the verification code for one of my transactions' })
  code(@Req() req: any, @Param('txId') txId: string) {
    return this.receipts.getCode(req.user.id, txId);
  }
}