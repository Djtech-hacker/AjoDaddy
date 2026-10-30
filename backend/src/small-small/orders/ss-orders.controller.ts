import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/auth.module';
import { VendorActiveGuard } from '../../vendors/guards/vendor-active.guard';
import { SsOrdersService } from './ss-orders.service';
import { PreviewPlanDto, StartPlanDto, PayOrderDto, SetPaymentModeDto } from './dto/orders.dto';

// ══════════════════════════════════════════════════════════════
// CUSTOMER: my plans
// ══════════════════════════════════════════════════════════════

@ApiTags('Small Small: Plans')
@Controller('small-small/orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SsOrdersController {
  constructor(private readonly orders: SsOrdersService) {}

  @Post('preview')
  @ApiOperation({ summary: 'Preview a plan (installments and dates) before confirming. No money moves.' })
  preview(@Body() dto: PreviewPlanDto) { return this.orders.previewPlan(dto); }

  // Throttled like withdrawals: these move money
  @Post()
  @Throttle({ long: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a plan: pays the deposit from your wallet and reserves the product' })
  start(@Req() req: any, @Body() dto: StartPlanDto) { return this.orders.startPlan(req.user.id, dto); }

  @Get()
  @ApiOperation({ summary: 'My plans' })
  list(@Req() req: any, @Query('status') status?: string, @Query('page') page?: string) {
    return this.orders.listMyOrders(req.user.id, status, Number(page) || 1);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One plan: installments, payments, and whether a refund is possible' })
  get(@Req() req: any, @Param('id') id: string) { return this.orders.getMyOrder(req.user.id, id); }

  @Post(':id/pay')
  @Throttle({ long: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pay towards a plan from your wallet' })
  pay(@Req() req: any, @Param('id') id: string, @Body() dto: PayOrderDto) {
    return this.orders.payOrder(req.user.id, id, dto);
  }

  @Post(':id/payment-mode')
  @ApiOperation({ summary: 'Switch between manual and automatic (wallet) payments' })
  setMode(@Req() req: any, @Param('id') id: string, @Body() dto: SetPaymentModeDto) {
    return this.orders.setPaymentMode(req.user.id, id, dto.mode);
  }

  @Post(':id/refund')
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cancel and get your money back to your wallet (only below the vendor refund limit)' })
  refund(@Req() req: any, @Param('id') id: string) { return this.orders.requestRefund(req.user.id, id); }
}

// ══════════════════════════════════════════════════════════════
// VENDOR: orders on my products, and customers who cancelled
// ══════════════════════════════════════════════════════════════

@ApiTags('Small Small: Vendor Orders')
@Controller('small-small/vendor')
@UseGuards(JwtAuthGuard, VendorActiveGuard)
@ApiBearerAuth()
export class SsVendorOrdersController {
  constructor(private readonly orders: SsOrdersService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Plans customers started on my products' })
  list(@Req() req: any, @Query('status') status?: string, @Query('page') page?: string) {
    return this.orders.listVendorOrders(req.user.id, status, Number(page) || 1);
  }

  @Get('refunds')
  @ApiOperation({ summary: 'Customers who cancelled and got their money back (with my share)' })
  refunds(@Req() req: any, @Query('page') page?: string) {
    return this.orders.listVendorRefunds(req.user.id, Number(page) || 1);
  }
}