import { Controller, Get, Post, Body, Param, Query, Req, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/auth.module';
import { VendorActiveGuard } from '../../vendors/guards/vendor-active.guard';
import { SsOrdersService } from './ss-orders.service';
import { PreviewPlanDto, StartPlanDto, PayOrderDto, SetPaymentModeDto } from './dto/orders.dto';
import { DispatchOrderDto, DeliveryAddressDto, DeliveryMethodDto, DeliveryOptionDto, PickupReadyDto } from './dto/dispatch.dto';

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

  // Throttled like withdrawals: these move money. The transaction PIN comes in the x-transaction-pin header.
  @Post()
  @Throttle({ long: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a plan: pays the deposit from your wallet and reserves the product' })
  start(@Req() req: any, @Body() dto: StartPlanDto, @Headers('x-transaction-pin') pin?: string) {
    return this.orders.startPlan(req.user.id, dto, pin);
  }

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
  @ApiOperation({ summary: 'Pay towards a plan from your wallet (needs the transaction PIN)' })
  pay(@Req() req: any, @Param('id') id: string, @Body() dto: PayOrderDto, @Headers('x-transaction-pin') pin?: string) {
    return this.orders.payOrder(req.user.id, id, dto, pin);
  }

  @Post(':id/payment-mode')
  @ApiOperation({ summary: 'Switch between manual and automatic (wallet) payments' })
  setMode(@Req() req: any, @Param('id') id: string, @Body() dto: SetPaymentModeDto) {
    return this.orders.setPaymentMode(req.user.id, id, dto.mode);
  }

  @Get(':id/delivery-quote')
  @ApiOperation({ summary: 'The delivery price and time for my plan (needs delivery chosen and an address saved)' })
  deliveryQuote(@Req() req: any, @Param('id') id: string) { return this.orders.quoteMyDelivery(req.user.id, id); }

  @Post(':id/delivery-option')
  @ApiOperation({ summary: 'Pick one of the couriers offered for my delivery' })
  setOption(@Req() req: any, @Param('id') id: string, @Body() dto: DeliveryOptionDto) {
    return this.orders.setDeliveryOption(req.user.id, id, dto.optionId);
  }

  @Post(':id/delivery-method')
  @ApiOperation({ summary: 'Choose how I want my goods: delivery or pickup from the vendor' })
  setMethod(@Req() req: any, @Param('id') id: string, @Body() dto: DeliveryMethodDto) {
    return this.orders.setDeliveryMethod(req.user.id, id, dto.method);
  }

  @Post(':id/delivery-address')
  @ApiOperation({ summary: 'Tell the vendor where to deliver my goods' })
  setAddress(@Req() req: any, @Param('id') id: string, @Body() dto: DeliveryAddressDto) {
    return this.orders.setDeliveryAddress(req.user.id, id, dto);
  }

  @Post(':id/received')
  @ApiOperation({ summary: 'Confirm that I received my goods' })
  received(@Req() req: any, @Param('id') id: string) { return this.orders.confirmDelivered(req.user.id, id); }

  @Post(':id/refund')
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cancel and get your money back to your wallet (only below the vendor refund limit)' })
  refund(@Req() req: any, @Param('id') id: string) { return this.orders.requestRefund(req.user.id, id); }
}

// ══════════════════════════════════════════════════════════════
// VENDOR: orders on my products, delivery, and customers who cancelled
// ══════════════════════════════════════════════════════════════

@ApiTags('Small Small: Vendor Orders')
@Controller('small-small/vendor')
@UseGuards(JwtAuthGuard, VendorActiveGuard)
@ApiBearerAuth()
export class SsVendorOrdersController {
  constructor(private readonly orders: SsOrdersService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Plans customers started on my products (filter by product and by stage)' })
  list(
    @Req() req: any, @Query('status') status?: string, @Query('page') page?: string,
    @Query('productId') productId?: string, @Query('view') view?: string,
  ) {
    return this.orders.listVendorOrders(req.user.id, status, Number(page) || 1, productId, view);
  }

  @Get('order-products')
  @ApiOperation({ summary: 'My products that have orders, with counts (paying, to dispatch, dispatched, delivered)' })
  orderProducts(@Req() req: any) { return this.orders.listVendorOrderProducts(req.user.id); }

  @Post('orders/:id/dispatch')
  @Throttle({ long: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark an order as dispatched (logistics company and tracking number)' })
  dispatch(@Req() req: any, @Param('id') id: string, @Body() dto: DispatchOrderDto) {
    return this.orders.dispatchOrder(req.user.id, id, dto, req.ip);
  }

  @Post('orders/:id/ready-for-pickup')
  @Throttle({ long: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Tell the customer their goods are ready to collect from me' })
  readyForPickup(@Req() req: any, @Param('id') id: string, @Body() dto: PickupReadyDto) {
    return this.orders.markReadyForPickup(req.user.id, id, dto.note, dto.location, req.ip);
  }

  @Post('orders/:id/gig-quote')
  @ApiOperation({ summary: 'Price of a GIG delivery for this order (GIG price + company fee). Nothing is booked.' })
  gigQuote(@Req() req: any, @Param('id') id: string) { return this.orders.quoteDelivery(req.user.id, id); }

  @Post('orders/:id/gig-book')
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Book a GIG rider to collect this order from me and deliver it to the customer' })
  gigBook(@Req() req: any, @Param('id') id: string) { return this.orders.bookDelivery(req.user.id, id, req.ip); }

  @Get('refunds')
  @ApiOperation({ summary: 'Customers who cancelled and got their money back (with my share)' })
  refunds(@Req() req: any, @Query('page') page?: string) {
    return this.orders.listVendorRefunds(req.user.id, Number(page) || 1);
  }
}