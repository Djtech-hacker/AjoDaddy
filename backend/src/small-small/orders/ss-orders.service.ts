// ============================================================
// PAY SMALL SMALL: ORDERS (a customer's installment plan on one product)
// ============================================================
//
// Safety rules every money method follows:
//   1. ONE database transaction per action, so a payment, its escrow hold, its ledger
//      lines and the order update all happen together or not at all.
//   2. The order row is locked (SELECT ... FOR UPDATE) before it is read, so two
//      payments on the same plan can never run at the same moment.
//   3. Every payment has an idempotency key, so a double tap or a network retry
//      cannot charge twice.
//   4. Notifications are sent AFTER the transaction commits. A notification problem
//      can never undo a payment.
//   5. Money amounts are BigInt kobo inside, naira in the API.
//
// The daily checks (auto-debit, missed payments, deadline) reuse applyPaymentInTx()
// and refundInTx() from here, and are added in the next step.
//
// DELIVERY: once a customer has finished paying (status COMPLETED) the vendor marks
// the goods as dispatched (courier + tracking), and the customer confirms receipt.

import {
  Injectable, BadRequestException, ConflictException, ForbiddenException,
  NotFoundException, ServiceUnavailableException, Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SsEscrowService } from '../escrow/ss-escrow.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { generateReferenceNumber, looksLikeReferenceNumber } from '../utils/reference-number.util';
import { buildSchedule, resolveIntervalDays, MIN_FIRST_PAYMENT_KOBO } from '../utils/ss-schedule.util';
import { refundAllowed, refundBreakdown, payoutDue, percentPaid } from '../utils/ss-money.util';
import { PreviewPlanDto, StartPlanDto, PayOrderDto } from './dto/orders.dto';
import { DispatchOrderDto, DeliveryAddressDto } from './dto/dispatch.dto';
import { createGigClient, GigAddress } from './gig.client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
const MIN_PAYMENT_KOBO = 10_000n; // ₦100

// A database transaction that does ~20 queries over the internet needs more than
// Prisma's default 5 seconds.
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

// Our fee on top of what GIG charges for a delivery. 200 = 2%. Change with GIG_COMPANY_FEE_BPS in .env.
const GIG_COMPANY_FEE_BPS = BigInt(Number(process.env.GIG_COMPANY_FEE_BPS ?? 200));
// Shown as the "courier" when the customer collects the goods from the vendor
const PICKUP_LABEL = 'Pickup in person';
const companyFeeOn = (gigFeeKobo: bigint) => (gigFeeKobo * GIG_COMPANY_FEE_BPS + 5_000n) / 10_000n;

const toKobo  = (naira: number) => BigInt(Math.round(naira * 100));
const toNaira = (kobo: bigint | number) => Number(kobo) / 100;
const naira   = (kobo: bigint) => '₦' + toNaira(kobo).toLocaleString('en-NG', { maximumFractionDigits: 2 });

export type NotifyEvent = {
  userId: string; type: string; title: string; body: string; data?: any; important?: boolean;
};

export type SsSettings = {
  frozen: boolean;
  autoDebitEnabled: boolean;
  graceHours: number;
  maxMissed: number;
  refundFeePercent: number;
  vendorSharePercent: number;
  saleFeeBps: bigint;
};

@Injectable()
export class SsOrdersService {
  private readonly logger = new Logger('SsOrdersService');
  private readonly gig = createGigClient();

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationsService,
    private readonly escrow:        SsEscrowService,
    private readonly cloudinary:    CloudinaryService,
  ) {}

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  async settings(): Promise<SsSettings> {
    const s: any = await this.prisma.platformSetting.findFirst();
    return {
      frozen:             s?.ssFrozen ?? false,
      autoDebitEnabled:   s?.ssAutoDebitEnabled ?? true,
      graceHours:         s?.ssGraceHours ?? 48,
      maxMissed:          s?.ssMaxMissedPayments ?? 3,
      refundFeePercent:   Number(s?.ssRefundFeePercent ?? 10),
      vendorSharePercent: Number(s?.ssRefundVendorSharePercent ?? 3),
      saleFeeBps:         BigInt(Math.round(Number(s?.ssSaleFeePercent ?? 0) * 100)),
    };
  }

  // Same rule your wallet uses: no wallet use without finished identity verification
  private async assertKyc(userId: string) {
    const rec = await this.prisma.identityRecord.findUnique({
      where: { userId },
      select: { status: true, ninVerified: true, bvnVerified: true, faceScannedAt: true },
    });
    const ok = rec?.status === 'VERIFIED' && rec?.ninVerified && rec?.bvnVerified && !!rec?.faceScannedAt;
    if (!ok) throw new ForbiddenException('KYC_REQUIRED: Complete identity verification before starting a plan.');
  }

  // The same transaction PIN the wallet uses. Wrong or missing PIN stops the money moving.
  async verifyPin(userId: string, pin?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { transactionPinHash: true } });
    if (!user?.transactionPinHash) {
      throw new BadRequestException('PIN_REQUIRED: Set your transaction PIN in your wallet first.');
    }
    if (!/^\d{4}$/.test(pin || '')) throw new ForbiddenException('Incorrect PIN');
    const ok = await bcrypt.compare(pin as string, user.transactionPinHash);
    if (!ok) throw new ForbiddenException('Incorrect PIN');
  }

  // Sent after the transaction commits. Failures are logged and ignored.
  async sendNotifications(events: NotifyEvent[]) {
    for (const e of events) {
      try {
        // `priority` is saved once NotificationsService supports it; until then it is ignored
        const payload: any = {
          userId: e.userId, type: e.type, title: e.title, body: e.body, data: e.data,
          priority: e.important ? 'IMPORTANT' : 'NORMAL',
        };
        await this.notifications.create(payload);
      } catch (err: any) {
        this.logger.warn(`Notification failed (${e.type}): ${err?.message}`);
      }
    }
  }

  private async resolveProductId(idOrReference: string): Promise<string> {
    const key = (idOrReference || '').trim();
    if (UUID_RE.test(key)) return key;
    if (looksLikeReferenceNumber(key)) {
      const p = await this.prisma.ssProduct.findUnique({ where: { referenceNumber: key.toUpperCase() }, select: { id: true } });
      if (p) return p.id;
    }
    throw new NotFoundException('Product not found');
  }

  private shortName(u?: { firstName?: string | null; lastName?: string | null } | null) {
    if (!u) return 'A customer';
    const last = (u.lastName || '').trim();
    return `${(u.firstName || 'A customer').trim()}${last ? ' ' + last[0].toUpperCase() + '.' : ''}`;
  }

  private refundStatus(o: any) {
    const paidPct = percentPaid(o.amountPaid, o.totalPrice);
    const allowed = refundAllowed({
      status: o.status, payoutReleased: o.payoutReleased, thresholdPercent: o.refundThresholdPercent,
      amountPaid: o.amountPaid, totalPrice: o.totalPrice,
    });
    let reason: string | null = null;
    if (!allowed) {
      if (o.status !== 'ACTIVE') reason = 'This plan is not active.';
      else if (o.refundThresholdPercent <= 0) reason = 'This vendor does not offer refunds on this product.';
      else if (o.payoutReleased) reason = 'The vendor has already been paid.';
      else reason = `You have paid ${paidPct}%. Refunds are only available while you have paid less than ${o.refundThresholdPercent}%.`;
    }
    let preview: any = null;
    if (allowed) {
      const b = refundBreakdown(o.amountPaid, o.refundFeePercent, o.refundVendorSharePercent);
      preview = { youPaid: toNaira(b.paid), feeTotal: toNaira(b.feeTotal), feePercent: Number(o.refundFeePercent), youGetBack: toNaira(b.customerRefund) };
    }
    return { allowed, reason, preview };
  }

  private presentOrder(o: any, forCustomer: boolean) {
    const remaining: bigint = BigInt(o.totalPrice) - BigInt(o.amountPaid);
    const out: any = {
      id: o.id, orderNumber: o.orderNumber, status: o.status,
      product: o.product ? {
        id: o.productId, name: o.product.name, referenceNumber: o.product.referenceNumber,
        thumbnail: o.product.thumbnail ?? null,
      } : { id: o.productId },
      totalPrice: toNaira(o.totalPrice), depositAmount: toNaira(o.depositAmount),
      amountPaid: toNaira(o.amountPaid), amountRemaining: toNaira(remaining < 0n ? 0n : remaining),
      percentPaid: percentPaid(o.amountPaid, o.totalPrice),
      paymentMode: o.paymentMode, frequency: o.frequency, intervalDays: o.intervalDays, durationDays: o.durationDays,
      installmentCount: o.installmentCount, installmentAmount: toNaira(o.installmentAmount),
      startedAt: o.startedAt, deadlineAt: o.deadlineAt, nextDueDate: o.nextDueDate,
      missedCount: o.missedCount, graceExpiresAt: o.graceExpiresAt,
      completedAt: o.completedAt, refundedAt: o.refundedAt,
      // delivery: only meaningful once the customer has finished paying
      fulfillmentStatus: o.fulfillmentStatus, dispatchedAt: o.dispatchedAt, courier: o.courier,
      trackingNumber: o.trackingNumber, dispatchNote: o.dispatchNote, deliveredAt: o.deliveredAt,
      deliveryMethod: o.deliveryMethod ?? null,
      deliveryOptionId: o.deliveryOptionId ?? null, deliveryCarrier: o.deliveryCarrier ?? null,
      deliveryLat: o.deliveryLat ?? null, deliveryLng: o.deliveryLng ?? null,
      deliveryName: o.deliveryName ?? null, deliveryPhone: o.deliveryPhone ?? null,
      deliveryAddress: o.deliveryAddress ?? null, deliveryCity: o.deliveryCity ?? null, deliveryState: o.deliveryState ?? null,
      gigWaybill: o.gigWaybill ?? null, gigStatus: o.gigStatus ?? null, gigSimulated: !!o.gigSimulated,
      // delivery cost = what GIG charges + our fee
      deliveryFee: o.deliveryFee != null ? toNaira(o.deliveryFee) : null,
      deliveryCompanyFee: o.deliveryCompanyFee != null ? toNaira(o.deliveryCompanyFee) : null,
      deliveryTotal: o.deliveryFee != null ? toNaira(BigInt(o.deliveryFee) + BigInt(o.deliveryCompanyFee ?? 0n)) : null,
    };
    if (forCustomer) {
      out.vendor = { businessName: o.vendor?.vendorProfile?.businessName ?? null };
      out.refundThresholdPercent = o.refundThresholdPercent;
      out.refund = this.refundStatus(o);
      out.chatThreadId = o.chatThread?.id ?? null;
      // the vendor's pickup address is only shown once they have said the goods are ready for pickup
      const vp = o.vendor?.vendorProfile;
      const pickupAt = o.pickupLocation || vp?.address;
      out.pickupAddress = o.deliveryMethod === 'PICKUP' && o.courier === PICKUP_LABEL && pickupAt
        ? { name: vp?.businessName ?? null, phone: vp?.phone ?? null, address: pickupAt } : null;
      out.suggestedAddress = !o.deliveryAddress && o.customer ? {
        name: `${o.customer.firstName ?? ''} ${o.customer.lastName ?? ''}`.trim(),
        phone: o.customer.phone ?? '', address: o.customer.streetAddress ?? '',
        city: o.customer.city ?? '', state: o.customer.state ?? '',
      } : null;
      if (o.refund) {
        out.refundDetails = {
          paid: toNaira(o.refund.paidAmount), fee: toNaira(o.refund.feeTotal), refunded: toNaira(o.refund.customerRefund),
        };
      }
    } else {
      out.payoutReleased = o.payoutReleased;
    }
    if (o.installments) {
      out.installments = o.installments.map((i: any) => ({
        number: i.number, dueDate: i.dueDate, amount: toNaira(i.amount), paidAmount: toNaira(i.paidAmount),
        status: i.status, paidAt: i.paidAt,
      }));
    }
    if (o.payments) {
      out.payments = o.payments.map((p: any) => ({ amount: toNaira(p.amount), mode: p.mode, paidAt: p.paidAt }));
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════
  // PREVIEW (no money moves)
  // ══════════════════════════════════════════════════════════

  async previewPlan(dto: PreviewPlanDto) {
    const productId = await this.resolveProductId(dto.productId);
    const p = await this.prisma.ssProduct.findFirst({
      where: { id: productId, status: 'ACTIVE', vendor: { vendorProfile: { is: { status: 'ACTIVE' } } } },
    });
    if (!p) throw new NotFoundException('This product is not available.');

    const intervalDays = resolveIntervalDays(dto.frequency, p.allowedFrequencies, p.customIntervalDays, dto.customIntervalDays);
    const cfg = await this.settings();
    const schedule = buildSchedule({
      priceKobo: p.price, depositKobo: toKobo(dto.depositAmount),
      intervalDays, durationDays: dto.durationDays, maxDurationDays: p.paymentDeadlineDays, startAt: new Date(),
    });

    return {
      product: { id: p.id, name: p.name, referenceNumber: p.referenceNumber },
      price: toNaira(p.price),
      deposit: toNaira(toKobo(dto.depositAmount)),
      minimumDeposit: toNaira(MIN_FIRST_PAYMENT_KOBO),
      remaining: toNaira(schedule.remaining),
      installmentCount: schedule.installmentCount,
      installmentAmount: toNaira(schedule.installmentAmount),
      deadlineAt: schedule.deadlineAt,
      schedule: schedule.installments.map(i => ({ number: i.number, dueDate: i.dueDate, amount: toNaira(i.amount) })),
      refund: {
        offered: p.refundThresholdPercent > 0,
        belowPercent: p.refundThresholdPercent,
        feePercent: cfg.refundFeePercent,
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // START A PLAN
  // ══════════════════════════════════════════════════════════

  async startPlan(customerId: string, dto: StartPlanDto, pin?: string) {
    const cfg = await this.settings();
    if (cfg.frozen) throw new ServiceUnavailableException('Pay Small Small is temporarily unavailable. Please try again later.');
    if (dto.paymentMode === 'AUTO' && !cfg.autoDebitEnabled) {
      throw new BadRequestException('Automatic payments are not available right now. Choose manual payments.');
    }
    await this.assertKyc(customerId);
    await this.verifyPin(customerId, pin);

    // Same tap sent twice: return the plan that was already created
    const depositKey = `ss-deposit:${customerId}:${dto.idempotencyKey}`;
    const dup = await this.prisma.ssPayment.findUnique({ where: { idempotencyKey: depositKey }, select: { orderId: true } });
    if (dup) return this.getMyOrder(customerId, dup.orderId);

    const productId = await this.resolveProductId(dto.productId);
    const events: NotifyEvent[] = [];
    let orderId = '';

    await this.prisma.$transaction(async (tx: any) => {
      // Lock the product so two customers cannot take the last unit at the same moment
      await tx.$queryRaw`SELECT id FROM ss_products WHERE id = ${productId} FOR UPDATE`;
      const p = await tx.ssProduct.findUnique({
        where: { id: productId },
        include: { vendor: { select: { vendorProfile: { select: { status: true } } } } },
      });
      if (!p) throw new NotFoundException('Product not found');
      if (p.status !== 'ACTIVE' || p.isFlagged || p.vendor?.vendorProfile?.status !== 'ACTIVE') {
        throw new BadRequestException('This product is not available right now.');
      }
      if (p.vendorId === customerId) throw new BadRequestException('You cannot buy your own product.');

      const available = p.totalStock - p.reservedCount - p.soldCount;
      if (available <= 0) throw new BadRequestException('Sorry, this product is sold out.');

      const already = await tx.ssOrder.count({ where: { customerId, productId, status: 'ACTIVE' } });
      if (already > 0) throw new ConflictException('You already have an active plan for this product.');

      // The plan: checks the vendor's frequency options, first payment floor and deadline
      const intervalDays = resolveIntervalDays(dto.frequency, p.allowedFrequencies, p.customIntervalDays, dto.customIntervalDays);
      const now = new Date();
      const depositKobo = toKobo(dto.depositAmount);
      const schedule = buildSchedule({
        priceKobo: p.price, depositKobo,
        intervalDays, durationDays: dto.durationDays, maxDurationDays: p.paymentDeadlineDays, startAt: now,
      });

      let orderNumber = '';
      for (let i = 0; i < 5; i++) {
        const candidate = generateReferenceNumber('SSO');
        const taken = await tx.ssOrder.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
        if (!taken) { orderNumber = candidate; break; }
      }
      if (!orderNumber) throw new ConflictException('Could not create the plan. Please try again.');

      const order = await tx.ssOrder.create({
        data: {
          orderNumber, productId, customerId, vendorId: p.vendorId, status: 'ACTIVE',
          totalPrice: p.price, depositAmount: depositKobo, amountPaid: 0n, escrowBalance: 0n,
          paymentMode: dto.paymentMode, frequency: dto.frequency, intervalDays, durationDays: dto.durationDays,
          installmentCount: schedule.installmentCount, installmentAmount: schedule.installmentAmount,
          startedAt: now, deadlineAt: schedule.deadlineAt, nextDueDate: schedule.firstDueDate,
          // The vendor's rules and the refund fees AT THIS MOMENT: later edits never change this plan
          refundThresholdPercent: p.refundThresholdPercent, payoutMode: p.payoutMode, payoutPercent: p.payoutPercent,
          refundFeePercent: cfg.refundFeePercent, refundVendorSharePercent: cfg.vendorSharePercent,
        },
      });
      orderId = order.id;

      if (schedule.installments.length > 0) {
        await tx.ssInstallment.createMany({
          data: schedule.installments.map(i => ({ orderId, number: i.number, dueDate: i.dueDate, amount: i.amount })),
        });
      }
      // If they already chatted with the vendor before buying, that conversation continues on the plan
      const earlier = await tx.ssChatThread.findFirst({
        where: { productId, customerId, orderId: null }, orderBy: { createdAt: 'desc' }, select: { id: true },
      });
      if (earlier) await tx.ssChatThread.update({ where: { id: earlier.id }, data: { orderId } });
      else await tx.ssChatThread.create({ data: { orderId, productId, customerId, vendorId: p.vendorId } });

      // Reserve one unit
      await tx.ssProduct.update({ where: { id: productId }, data: { reservedCount: { increment: 1 } } });
      if (available - 1 === 0) {
        await tx.ssProduct.update({ where: { id: productId }, data: { status: 'OUT_OF_STOCK' } });
        events.push({
          userId: p.vendorId, type: 'SS_OUT_OF_STOCK', title: 'Product sold out',
          body: `"${p.name}" has no units left. Add stock to keep selling.`, data: { productId },
        });
      }

      // The deposit. If the wallet is short, this throws and EVERYTHING above is undone.
      await this.applyPaymentInTx(tx, {
        orderId, amount: depositKobo, mode: 'MANUAL', key: depositKey, payerId: customerId, isDeposit: true, cfg,
      }, events);

      const buyer = await tx.user.findUnique({ where: { id: customerId }, select: { firstName: true, lastName: true } });
      events.push({
        userId: p.vendorId, type: 'SS_PLAN_STARTED', title: 'New plan started',
        body: `${this.shortName(buyer)} started a plan on "${p.name}" with ${naira(depositKobo)} down.`,
        data: { orderId, productId }, important: true,
      });
    }, TX_OPTIONS);

    await this.sendNotifications(events);
    return this.getMyOrder(customerId, orderId);
  }

  // ══════════════════════════════════════════════════════════
  // PAY (manual). The daily auto-debit calls applyPaymentInTx() directly.
  // ══════════════════════════════════════════════════════════

  async payOrder(customerId: string, orderId: string, dto: PayOrderDto, pin?: string) {
    const cfg = await this.settings();
    if (cfg.frozen) throw new ServiceUnavailableException('Pay Small Small is temporarily unavailable. Please try again later.');
    await this.assertKyc(customerId);
    await this.verifyPin(customerId, pin);

    const events: NotifyEvent[] = [];
    const key = `ss-pay:${customerId}:${dto.idempotencyKey}`;

    await this.prisma.$transaction(async (tx: any) => {
      await this.applyPaymentInTx(tx, {
        orderId, amount: toKobo(dto.amount), mode: 'MANUAL', key, payerId: customerId, isDeposit: false, cfg,
      }, events);
    }, TX_OPTIONS);

    await this.sendNotifications(events);
    return this.getMyOrder(customerId, orderId);
  }

  // THE core money method. Used for the deposit, manual payments and auto-debit.
  // Must be called inside a transaction (tx).
  async applyPaymentInTx(
    tx: any,
    p: { orderId: string; amount: bigint; mode: 'MANUAL' | 'AUTO'; key: string; payerId: string; isDeposit: boolean; cfg: SsSettings },
    events: NotifyEvent[],
  ) {
    // 1) Lock the order, then read it fresh
    await tx.$queryRaw`SELECT id FROM ss_orders WHERE id = ${p.orderId} FOR UPDATE`;
    const order = await tx.ssOrder.findUnique({
      where: { id: p.orderId },
      include: { product: { select: { name: true } } },
    });
    if (!order || order.customerId !== p.payerId) throw new NotFoundException('Plan not found');

    // 2) Same payment sent twice: do nothing the second time
    const dupe = await tx.ssPayment.findUnique({ where: { idempotencyKey: p.key }, select: { id: true } });
    if (dupe) return { duplicate: true };

    if (order.status !== 'ACTIVE') throw new BadRequestException('This plan is no longer active.');
    if (p.amount <= 0n) throw new BadRequestException('Enter an amount.');
    const owed: bigint = BigInt(order.totalPrice) - BigInt(order.amountPaid);
    if (p.amount > owed) throw new BadRequestException(`You only owe ${naira(owed)} on this plan.`);
    if (!p.isDeposit && p.amount < MIN_PAYMENT_KOBO && p.amount !== owed) {
      throw new BadRequestException('The smallest payment is ₦100, unless it finishes your plan.');
    }

    // 3) Move the money
    const base = { orderId: order.id, orderNumber: order.orderNumber, productName: order.product.name, amount: p.amount, key: p.key };
    let directNet = 0n;
    if (!order.payoutReleased) {
      await this.escrow.chargeCustomerIntoEscrow(tx, {
        ...base, customerId: p.payerId, kind: p.isDeposit ? 'DEPOSIT' : 'PAYMENT',
      });
    } else {
      const r = await this.escrow.chargeCustomerToVendor(tx, {
        ...base, customerId: p.payerId, vendorId: order.vendorId, saleFeeBps: p.cfg.saleFeeBps,
      });
      directNet = r.net;
    }

    const newPaid = order.amountPaid + p.amount;
    let newEscrow = order.payoutReleased ? order.escrowBalance : order.escrowBalance + p.amount;

    await tx.ssPayment.create({
      data: { orderId: order.id, userId: p.payerId, amount: p.amount, mode: p.mode, idempotencyKey: p.key },
    });

    // 4) Tick off installments in order (the deposit is not an installment)
    const now = new Date();
    const data: any = { amountPaid: newPaid };
    if (!p.isDeposit) {
      const insts = await tx.ssInstallment.findMany({ where: { orderId: order.id }, orderBy: { number: 'asc' } });
      let left = p.amount;
      let nextDue: Date | null = null;
      let caughtUp = true;
      // Work out which installments this payment finishes, and the one it may part-pay.
      // (A plan can have ~90 installments, and "Pay everything" finishes all of them. Updating them
      //  one by one took so long over the internet that the whole payment timed out and was cancelled.)
      const finishedIds: string[] = [];
      let partial: { id: string; paidAmount: bigint } | null = null;
      for (const i of insts) {
        let status = i.status;
        if (status !== 'PAID' && left > 0n) {
          const need: bigint = BigInt(i.amount) - BigInt(i.paidAmount);
          const add: bigint = left < need ? left : need;
          const paidAmount: bigint = BigInt(i.paidAmount) + add;
          left -= add;
          const full = paidAmount >= BigInt(i.amount);
          if (full) { finishedIds.push(i.id); status = 'PAID'; }
          else partial = { id: i.id, paidAmount };
        }
        if (status !== 'PAID') {
          if (!nextDue) nextDue = i.dueDate;
          if (i.dueDate.getTime() <= now.getTime()) caughtUp = false;
        }
      }
      // ONE query marks every finished installment as paid in full ...
      if (finishedIds.length > 0) {
        await tx.$executeRaw`UPDATE ss_installments SET "paidAmount" = "amount", "status" = 'PAID'::"SsInstallmentStatus", "paidAt" = ${now} WHERE id = ANY(${finishedIds}::text[])`;
      }
      // ... and at most one more query records a part payment
      if (partial) {
        await tx.ssInstallment.update({ where: { id: partial.id }, data: { paidAmount: partial.paidAmount } });
      }
      data.nextDueDate = nextDue;
      if (caughtUp) data.graceExpiresAt = null;
    }

    // 5) Is the vendor due their money now?
    //    (If the plan is finished, the vendor is ALWAYS paid, so money can never be left in escrow)
    const completed = newPaid >= order.totalPrice;
    const due = payoutDue({
      payoutMode: order.payoutMode, payoutPercent: order.payoutPercent, payoutReleased: order.payoutReleased,
      amountPaid: newPaid, totalPrice: order.totalPrice,
    }) || (completed && !order.payoutReleased);

    let payoutNowNet = 0n;
    let payoutNow = false;
    if (due && !order.payoutReleased && newEscrow > 0n) {
      const r = await this.escrow.releaseEscrowToVendor(tx, {
        orderId: order.id, orderNumber: order.orderNumber, productName: order.product.name,
        vendorId: order.vendorId, amount: newEscrow, saleFeeBps: p.cfg.saleFeeBps,
      });
      payoutNowNet = r.net;
      payoutNow = true;
      newEscrow = 0n;
      data.payoutReleased = true;
      data.payoutReleasedAt = now;
    }
    data.escrowBalance = newEscrow;

    // 6) Finished?
    if (completed) {
      data.status = 'COMPLETED';
      data.completedAt = now;
      data.nextDueDate = null;
      data.graceExpiresAt = null;
      await tx.ssProduct.updateMany({
        where: { id: order.productId, reservedCount: { gte: 1 } },
        data: { reservedCount: { decrement: 1 }, soldCount: { increment: 1 } },
      });
    }
    await tx.ssOrder.update({ where: { id: order.id }, data });

    // 7) Tell people (sent after the transaction commits)
    const pct = percentPaid(newPaid, order.totalPrice);
    events.push({
      userId: p.payerId, type: 'SS_PAYMENT_RECEIVED', title: 'Payment received',
      body: `${naira(p.amount)} received for "${order.product.name}". You have paid ${pct}%.`,
      data: { orderId: order.id }, important: true,
    });
    if (payoutNow) {
      events.push({
        userId: order.vendorId, type: 'SS_VENDOR_PAYOUT', title: 'You have been paid',
        body: completed
          ? `The customer finished paying for "${order.product.name}". ${naira(payoutNowNet)} was added to your wallet. You can now send the goods.`
          : `The customer reached ${pct}% on "${order.product.name}". ${naira(payoutNowNet)} was added to your wallet.`,
        data: { orderId: order.id }, important: true,
      });
    } else if (order.payoutReleased && directNet > 0n) {
      events.push({
        userId: order.vendorId, type: 'SS_VENDOR_PAYOUT', title: 'Payment received',
        body: `${naira(directNet)} received for "${order.product.name}".`,
        data: { orderId: order.id }, important: true,
      });
    }
    if (completed) {
      events.push({
        userId: p.payerId, type: 'SS_PLAN_COMPLETED', title: 'Plan completed 🎉',
        body: `You finished paying for "${order.product.name}". The vendor will send your goods.`,
        data: { orderId: order.id }, important: true,
      });
    }
    return { duplicate: false, completed, newPaid };
  }

  // ══════════════════════════════════════════════════════════
  // REFUND
  // ══════════════════════════════════════════════════════════

  async requestRefund(customerId: string, orderId: string) {
    const cfg = await this.settings();
    if (cfg.frozen) throw new ServiceUnavailableException('Pay Small Small is temporarily unavailable. Please try again later.');

    const events: NotifyEvent[] = [];
    await this.prisma.$transaction(async (tx: any) => {
      await this.refundInTx(tx, { orderId, reason: 'CUSTOMER_REQUEST', requireEligible: true, requesterId: customerId }, events);
    }, TX_OPTIONS);

    await this.sendNotifications(events);
    return this.getMyOrder(customerId, orderId);
  }

  // Used for customer refunds and (next step) for plans that default.
  // Must be called inside a transaction (tx).
  async refundInTx(
    tx: any,
    p: { orderId: string; reason: 'CUSTOMER_REQUEST' | 'DEFAULT' | 'ADMIN'; requireEligible: boolean; requesterId?: string },
    events: NotifyEvent[],
  ) {
    await tx.$queryRaw`SELECT id FROM ss_orders WHERE id = ${p.orderId} FOR UPDATE`;
    const order = await tx.ssOrder.findUnique({
      where: { id: p.orderId },
      include: { product: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Plan not found');
    if (p.requesterId && order.customerId !== p.requesterId) throw new NotFoundException('Plan not found');
    if (order.status !== 'ACTIVE') throw new BadRequestException('This plan is not active, so it cannot be refunded.');
    if (order.payoutReleased) throw new BadRequestException('The vendor has already been paid, so this plan cannot be refunded.');

    if (p.requireEligible) {
      const rs = this.refundStatus(order);
      if (!rs.allowed) throw new BadRequestException(rs.reason || 'A refund is not available for this plan.');
    }

    const paid = order.amountPaid;
    // The money held for this plan must equal what the customer paid. If not, stop and alert.
    if (order.escrowBalance !== paid) {
      this.logger.error(`ACCOUNTING MISMATCH on ${order.orderNumber}: paid ${paid} but escrow ${order.escrowBalance}`);
      throw new ConflictException('This plan needs to be checked by our team before it can be refunded. Please contact support.');
    }

    const b = refundBreakdown(paid, order.refundFeePercent, order.refundVendorSharePercent);
    await this.escrow.refundFromEscrow(tx, {
      orderId: order.id, orderNumber: order.orderNumber, productName: order.product.name,
      customerId: order.customerId, vendorId: order.vendorId, breakdown: b,
    });

    await tx.ssRefund.create({
      data: {
        orderId: order.id, customerId: order.customerId, vendorId: order.vendorId, reason: p.reason,
        paidAmount: paid, paidPercentAtRequest: percentPaid(paid, order.totalPrice),
        feeTotal: b.feeTotal, vendorShare: b.vendorShare, companyShare: b.companyShare, customerRefund: b.customerRefund,
      },
    });
    await tx.ssOrder.update({
      where: { id: order.id },
      data: {
        status: p.reason === 'DEFAULT' ? 'DEFAULTED' : 'REFUNDED',
        escrowBalance: 0n, nextDueDate: null, graceExpiresAt: null,
        ...(p.reason === 'DEFAULT' ? { defaultedAt: new Date() } : { refundedAt: new Date() }),
      },
    });

    // Give the unit back to the shelf
    await tx.ssProduct.updateMany({ where: { id: order.productId, reservedCount: { gte: 1 } }, data: { reservedCount: { decrement: 1 } } });
    const prod = await tx.ssProduct.findUnique({ where: { id: order.productId } });
    if (prod && prod.status === 'OUT_OF_STOCK' && !prod.isFlagged && prod.totalStock - prod.reservedCount - prod.soldCount > 0) {
      await tx.ssProduct.update({ where: { id: order.productId }, data: { status: 'ACTIVE' } });
    }

    if (p.reason === 'DEFAULT') {
      events.push({
        userId: order.customerId, type: 'SS_ORDER_DEFAULTED', title: 'Plan cancelled',
        body: `Your plan for "${order.product.name}" was cancelled because payments were missed. ${naira(b.customerRefund)} was returned to your wallet (${naira(b.feeTotal)} cancellation fee).`,
        data: { orderId: order.id }, important: true,
      });
      events.push({
        userId: order.vendorId, type: 'SS_ORDER_DEFAULTED', title: 'Plan cancelled (missed payments)',
        body: `A customer missed payments on "${order.product.name}" and the plan was cancelled. ${naira(b.vendorShare)} was added to your wallet and the unit is back in stock.`,
        data: { orderId: order.id }, important: true,
      });
    } else {
      events.push({
        userId: order.customerId, type: 'SS_REFUND_PROCESSED', title: 'Refund processed',
        body: `${naira(b.customerRefund)} was returned to your wallet for "${order.product.name}" (${naira(b.feeTotal)} cancellation fee).`,
        data: { orderId: order.id }, important: true,
      });
      events.push({
        userId: order.vendorId, type: 'SS_REFUND_VENDOR', title: 'A customer cancelled',
        body: `A plan on "${order.product.name}" was cancelled. ${naira(b.vendorShare)} was added to your wallet and the unit is back in stock.`,
        data: { orderId: order.id }, important: true,
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  // SETTINGS ON A PLAN
  // ══════════════════════════════════════════════════════════

  async setPaymentMode(customerId: string, orderId: string, mode: 'MANUAL' | 'AUTO') {
    const cfg = await this.settings();
    if (mode === 'AUTO' && !cfg.autoDebitEnabled) throw new BadRequestException('Automatic payments are not available right now.');
    const res = await this.prisma.ssOrder.updateMany({
      where: { id: orderId, customerId, status: 'ACTIVE' }, data: { paymentMode: mode },
    });
    if (res.count === 0) throw new NotFoundException('Active plan not found');
    return this.getMyOrder(customerId, orderId);
  }

  // ══════════════════════════════════════════════════════════
  // DELIVERY: the vendor sends the goods, the customer confirms
  // ══════════════════════════════════════════════════════════

  async dispatchOrder(vendorId: string, orderId: string, dto: DispatchOrderDto, ip?: string) {
    const o: any = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, vendorId },
      include: { product: { select: { name: true } } },
    });
    if (!o) throw new NotFoundException('Order not found');
    if (o.status !== 'COMPLETED') throw new BadRequestException('You can dispatch once the customer has finished paying.');
    if (o.fulfillmentStatus === 'DELIVERED') throw new BadRequestException('The customer already confirmed they received this order.');
    if (o.gigWaybill) throw new BadRequestException('This order was booked with GIG, so the details cannot be edited here.');

    const courier = dto.courier.trim();
    const tracking = dto.trackingNumber?.trim() || null;
    const first = o.fulfillmentStatus === 'PENDING';

    await this.prisma.ssOrder.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus: 'DISPATCHED',
        dispatchedAt: first ? new Date() : o.dispatchedAt,
        courier, trackingNumber: tracking, dispatchNote: dto.note?.trim() || null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: vendorId, action: first ? 'SS_ORDER_DISPATCHED' : 'SS_ORDER_DISPATCH_UPDATED',
        entityType: 'SS_ORDER', entityId: orderId, metadata: { courier, trackingNumber: tracking }, ipAddress: ip,
      },
    });
    await this.sendNotifications([{
      userId: o.customerId, type: 'SS_ORDER_DISPATCHED',
      title: first ? 'Your goods are on the way' : 'Delivery details updated',
      body: `"${o.product.name}" was dispatched via ${courier}${tracking ? ` (tracking ${tracking})` : ''}.`,
      data: { orderId }, important: true,
    }]);
    return { message: first ? 'Marked as dispatched. The customer has been told.' : 'Delivery details updated.' };
  }

  async confirmDelivered(customerId: string, orderId: string) {
    const o: any = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, customerId },
      include: { product: { select: { name: true } } },
    });
    if (!o) throw new NotFoundException('Plan not found');
    if (o.status !== 'COMPLETED') throw new BadRequestException('You can confirm once you have finished paying.');
    if (o.fulfillmentStatus === 'DELIVERED') return this.getMyOrder(customerId, orderId);
    if (o.fulfillmentStatus !== 'DISPATCHED') throw new BadRequestException('The vendor has not marked this order as dispatched yet.');

    await this.prisma.ssOrder.update({ where: { id: orderId }, data: { fulfillmentStatus: 'DELIVERED', deliveredAt: new Date() } });
    await this.sendNotifications([{
      userId: o.vendorId, type: 'SS_ORDER_DELIVERED', title: 'Customer received the goods',
      body: `The customer confirmed they received "${o.product.name}".`, data: { orderId }, important: false,
    }]);
    return this.getMyOrder(customerId, orderId);
  }

  // ══════════════════════════════════════════════════════════
  // GIG LOGISTICS: where to deliver, the price, and booking a rider
  // ══════════════════════════════════════════════════════════

  // The customer says where the goods should go
  async setDeliveryAddress(customerId: string, orderId: string, dto: DeliveryAddressDto) {
    const o: any = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, customerId }, select: { status: true, fulfillmentStatus: true },
    });
    if (!o) throw new NotFoundException('Plan not found');
    if (o.status !== 'ACTIVE' && o.status !== 'COMPLETED') throw new BadRequestException('This plan is no longer active.');
    if (o.fulfillmentStatus !== 'PENDING') throw new BadRequestException('Your goods are already on the way, so the address cannot change.');
    await this.prisma.ssOrder.update({
      where: { id: orderId },
      data: {
        deliveryMethod: 'DELIVERY',
        deliveryOptionId: null, deliveryCarrier: null, // a new address means new prices: they choose again
        deliveryName: dto.name.trim(), deliveryPhone: dto.phone.trim(), deliveryAddress: dto.address.trim(),
        deliveryCity: dto.city.trim(), deliveryState: dto.state.trim(),
        deliveryLat: typeof dto.latitude === 'number' ? dto.latitude : null,
        deliveryLng: typeof dto.longitude === 'number' ? dto.longitude : null,
      },
    });
    return this.getMyOrder(customerId, orderId);
  }

  // The customer chooses: a GIG rider brings it, or they collect it from the vendor
  async setDeliveryMethod(customerId: string, orderId: string, method: 'DELIVERY' | 'PICKUP') {
    const o: any = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, customerId },
      select: { status: true, fulfillmentStatus: true, vendorId: true, deliveryMethod: true, product: { select: { name: true } } },
    });
    if (!o) throw new NotFoundException('Plan not found');
    if (o.status !== 'ACTIVE' && o.status !== 'COMPLETED') throw new BadRequestException('This plan is no longer active.');
    if (o.fulfillmentStatus !== 'PENDING') throw new BadRequestException('Your goods are already on the way, so this cannot change.');
    if (o.deliveryMethod !== method) {
      await this.prisma.ssOrder.update({ where: { id: orderId }, data: { deliveryMethod: method } });
      // only tell the vendor once there is something for them to do
      if (o.status === 'COMPLETED') {
        await this.sendNotifications([{
          userId: o.vendorId, type: 'SYSTEM',
          title: method === 'PICKUP' ? 'Customer will pick up in person' : 'Customer wants delivery',
          body: method === 'PICKUP'
            ? `The customer will collect "${o.product.name}" from you. Tell them when it is ready.`
            : `The customer wants "${o.product.name}" delivered. They will add their address.`,
          data: { orderId }, important: false,
        }]);
      }
    }
    return this.getMyOrder(customerId, orderId);
  }

  // The vendor says: it is ready, come and collect it
  async markReadyForPickup(vendorId: string, orderId: string, note: string | undefined, location: string | undefined, ip?: string) {
    const o = await this.loadForGig(vendorId, orderId);
    if (o.deliveryMethod !== 'PICKUP') throw new BadRequestException('This customer has not chosen to pick the goods up.');
    const vp: any = await this.prisma.vendorProfile.findUnique({ where: { userId: vendorId }, select: { address: true } });
    // the vendor can type where to come; if they leave it empty we use the address on their vendor profile
    const where = (location || '').trim() || vp?.address;
    if (!where) throw new BadRequestException('Tell the customer where to come and collect it.');

    const res = await this.prisma.ssOrder.updateMany({
      where: { id: orderId, vendorId, status: 'COMPLETED', fulfillmentStatus: 'PENDING' },
      data: {
        fulfillmentStatus: 'DISPATCHED', dispatchedAt: new Date(), courier: PICKUP_LABEL,
        trackingNumber: null, dispatchNote: note?.trim() || null, pickupLocation: where,
      },
    });
    if (res.count === 0) throw new ConflictException('This order was already updated.');
    await this.prisma.auditLog.create({
      data: { actorId: vendorId, action: 'SS_ORDER_READY_FOR_PICKUP', entityType: 'SS_ORDER', entityId: orderId, metadata: {}, ipAddress: ip },
    });
    await this.sendNotifications([{
      userId: o.customerId, type: 'SS_ORDER_DISPATCHED', title: 'Your goods are ready for pickup',
      body: `"${o.product.name}" is ready. Open your plan to see where to collect it.`,
      data: { orderId }, important: true,
    }]);
    return { message: 'The customer has been told their goods are ready for pickup.' };
  }

  private async loadForGig(vendorId: string, orderId: string) {
    const o: any = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, vendorId },
      include: { product: { select: { name: true } } },
    });
    if (!o) throw new NotFoundException('Order not found');
    if (o.status !== 'COMPLETED') throw new BadRequestException('You can send the goods once the customer has finished paying.');
    if (o.fulfillmentStatus !== 'PENDING') throw new BadRequestException('This order was already sent.');
    return o;
  }

  // Pickup = the vendor. Delivery = what the customer entered.
  private async gigAddresses(o: any): Promise<{ from: GigAddress; to: GigAddress }> {
    if (o.deliveryMethod === 'PICKUP') throw new BadRequestException('This customer will pick the goods up in person.');
    if (!o.deliveryAddress || !o.deliveryState || !o.deliveryPhone || !o.deliveryName) {
      throw new BadRequestException('The customer has not given a delivery address yet. Ask them to add it on their plan page.');
    }
    const v: any = await this.prisma.user.findUnique({
      where: { id: o.vendorId },
      select: {
        firstName: true, lastName: true, email: true, phone: true, streetAddress: true, city: true, state: true,
        vendorProfile: { select: { businessName: true, phone: true, address: true } },
      },
    });
    const pickupAddress = v?.vendorProfile?.address || v?.streetAddress;
    const pickupPhone = v?.vendorProfile?.phone || v?.phone;
    if (!pickupAddress || !v?.state || !pickupPhone) {
      throw new BadRequestException('Add your pickup address, state and phone number to your profile first, so the GIG rider knows where to collect.');
    }
    const cu: any = await this.prisma.user.findUnique({ where: { id: o.customerId }, select: { email: true } });
    return {
      from: {
        name: v.vendorProfile?.businessName || `${v.firstName} ${v.lastName}`.trim(),
        phone: pickupPhone, email: v.email || '', address: pickupAddress, city: v.city || v.state, state: v.state,
      },
      to: {
        name: o.deliveryName, phone: o.deliveryPhone, email: cu?.email || '', address: o.deliveryAddress,
        city: o.deliveryCity || o.deliveryState, state: o.deliveryState,
        latitude: typeof o.deliveryLat === 'number' ? o.deliveryLat : undefined,
        longitude: typeof o.deliveryLng === 'number' ? o.deliveryLng : undefined,
      },
    };
  }

  // The price the vendor sees before booking: GIG's price + our 2%
  // The couriers on offer for this order, each with its price and our service fee on top
  private async deliveryOptions(o: any) {
    const { from, to } = await this.gigAddresses(o);
    const list = await this.gig.quoteOptions(from, to, BigInt(o.totalPrice), o.product?.name);
    const options = list.map(x => ({ ...x, companyFeeKobo: companyFeeOn(x.feeKobo) }));
    return { from, to, options };
  }

  private presentOption(x: any) {
    return {
      id: x.id, carrier: x.carrier, service: x.service, eta: x.etaText, simulated: x.simulated,
      gigFee: toNaira(x.feeKobo), companyFee: toNaira(x.companyFeeKobo), total: toNaira(x.feeKobo + x.companyFeeKobo),
    };
  }

  // What the VENDOR sees before booking: where it is collected, where it goes, and the courier the customer chose
  async quoteDelivery(vendorId: string, orderId: string) {
    const o = await this.loadForGig(vendorId, orderId);
    if (!o.deliveryOptionId) throw new BadRequestException('The customer has not chosen a courier yet.');
    const { from, to, options } = await this.deliveryOptions(o);
    const opt = options.find(x => x.id === o.deliveryOptionId);
    if (!opt) throw new BadRequestException('The courier the customer chose is not available any more. Ask them to choose again.');
    return {
      from, to, itemName: o.product.name, companyFeePercent: Number(GIG_COMPANY_FEE_BPS) / 100,
      ...this.presentOption(opt),
    };
  }

  // What the CUSTOMER sees on their plan page: the couriers to choose from, with prices and arrival times.
  // The vendor's pickup address is never shown to the customer.
  async quoteMyDelivery(customerId: string, orderId: string) {
    const o: any = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, customerId },
      include: { product: { select: { name: true } } },
    });
    if (!o) throw new NotFoundException('Plan not found');
    if (o.status !== 'ACTIVE' && o.status !== 'COMPLETED') throw new BadRequestException('This plan is no longer active.');
    if (o.fulfillmentStatus !== 'PENDING') throw new BadRequestException('Your goods are already on the way.');
    if (o.deliveryMethod !== 'DELIVERY') throw new BadRequestException('Choose delivery first.');
    if (!o.deliveryAddress || !o.deliveryState) throw new BadRequestException('Save your delivery address to see the prices.');

    let res: { from: GigAddress; to: GigAddress; options: any[] };
    try { res = await this.deliveryOptions(o); }
    catch (e: any) {
      if (/pickup address/i.test(e?.message || '')) {
        throw new BadRequestException('The vendor has not finished adding their pickup address yet, so the prices are not ready.');
      }
      throw e;
    }
    const { from, to, options } = res;
    const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const kind = !eq(from.state, to.state) ? 'Interstate delivery' : eq(from.city, to.city) ? 'Local dispatch rider' : 'Delivery within the state';
    const sorted = options.slice().sort((a, b) => Number((a.feeKobo + a.companyFeeKobo) - (b.feeKobo + b.companyFeeKobo)));
    return { kind, companyFeePercent: Number(GIG_COMPANY_FEE_BPS) / 100, options: sorted.map(x => this.presentOption(x)) };
  }

  // The customer taps one of the couriers
  async setDeliveryOption(customerId: string, orderId: string, optionId: string) {
    const q = await this.quoteMyDelivery(customerId, orderId); // same checks: delivery chosen, address saved, not sent yet
    const opt = q.options.find(x => x.id === optionId);
    if (!opt) throw new BadRequestException('That courier is not available any more. Please choose again.');
    await this.prisma.ssOrder.update({ where: { id: orderId }, data: { deliveryOptionId: opt.id, deliveryCarrier: opt.carrier } });
    return this.getMyOrder(customerId, orderId);
  }

  // Book the courier the customer chose. The price is fetched again here, so the saved price is always fresh.
  async bookDelivery(vendorId: string, orderId: string, ip?: string) {
    const o = await this.loadForGig(vendorId, orderId);
    if (!o.deliveryOptionId) throw new BadRequestException('The customer has not chosen a courier yet.');
    const { from, to, options } = await this.deliveryOptions(o);
    const opt = options.find(x => x.id === o.deliveryOptionId);
    if (!opt) throw new BadRequestException('The courier the customer chose is not available any more. Ask them to choose again.');

    // Claim the order first, so a double tap can never book two riders
    const claim = await this.prisma.ssOrder.updateMany({
      where: { id: orderId, vendorId, status: 'COMPLETED', fulfillmentStatus: 'PENDING', gigWaybill: null, gigStatus: null },
      data: { gigStatus: 'BOOKING' },
    });
    if (claim.count === 0) throw new ConflictException('This order is already being booked.');

    let booking: any;
    try {
      booking = await this.gig.book({
        from, to, declaredValueKobo: BigInt(o.totalPrice), itemName: o.product.name, reference: o.orderNumber, optionId: opt.id, requestToken: opt.requestToken,
      });
    } catch (e) {
      await this.prisma.ssOrder.update({ where: { id: orderId }, data: { gigStatus: null } });
      throw e;
    }

    const carrier: string = booking.carrier || opt.carrier;
    await this.prisma.ssOrder.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus: 'DISPATCHED', dispatchedAt: new Date(), courier: carrier,
        trackingNumber: booking.waybill, dispatchNote: null,
        deliveryFee: opt.feeKobo, deliveryCompanyFee: opt.companyFeeKobo,
        gigWaybill: booking.waybill, gigStatus: booking.status, gigSimulated: booking.simulated,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: vendorId, action: 'SS_ORDER_GIG_BOOKED', entityType: 'SS_ORDER', entityId: orderId,
        metadata: {
          carrier, optionId: opt.id, waybill: booking.waybill, courierFeeKobo: opt.feeKobo.toString(),
          companyFeeKobo: opt.companyFeeKobo.toString(), simulated: booking.simulated,
        },
        ipAddress: ip,
      },
    });
    await this.sendNotifications([{
      userId: o.customerId, type: 'SS_ORDER_DISPATCHED', title: `A ${carrier} rider is coming for your goods`,
      body: `"${o.product.name}" is booked with ${carrier} (waybill ${booking.waybill}).`,
      data: { orderId }, important: true,
    }]);
    return {
      message: booking.simulated
        ? 'Test booking saved. No real rider was called (simulated mode).'
        : `${carrier} rider requested. They will come to collect the goods from your pickup address.`,
      waybill: booking.waybill,
    };
  }

  // ══════════════════════════════════════════════════════════
  // READS
  // ══════════════════════════════════════════════════════════

  async getMyOrder(customerId: string, orderId: string) {
    const o = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, customerId },
      include: {
        installments: { orderBy: { number: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' }, take: 20 },
        product: { select: { name: true, referenceNumber: true, images: true } },
        vendor: { select: { vendorProfile: { select: { businessName: true, address: true, phone: true } } } },
        refund: true,
        chatThread: { select: { id: true } },
        customer: { select: { firstName: true, lastName: true, phone: true, streetAddress: true, city: true, state: true } },
      },
    });
    if (!o) throw new NotFoundException('Plan not found');
    return this.presentOrder(this.withThumb(o), true);
  }

  async listMyOrders(customerId: string, status?: string, page = 1) {
    const where: any = { customerId };
    if (status && ['ACTIVE', 'COMPLETED', 'REFUNDED', 'DEFAULTED', 'CANCELLED', 'DISPUTED'].includes(status)) where.status = status;
    const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.ssOrder.count({ where }),
      this.prisma.ssOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE,
        include: {
          product: { select: { name: true, referenceNumber: true, images: true } },
          vendor: { select: { vendorProfile: { select: { businessName: true } } } },
          refund: true, chatThread: { select: { id: true } },
        },
      }),
    ]);
    return { total, page: Math.max(1, page), pageSize: PAGE_SIZE, items: rows.map((o: any) => this.presentOrder(this.withThumb(o), true)) };
  }

  // The vendor's orders. Optionally for ONE product, and for one stage of the journey:
  //   PAYING (still paying), TO_DISPATCH (paid up, goods not sent yet), DISPATCHED, DELIVERED, CANCELLED
  async listVendorOrders(vendorId: string, status?: string, page = 1, productId?: string, view?: string) {
    const where: any = { vendorId };
    if (productId && UUID_RE.test(productId)) where.productId = productId;
    switch (view) {
      case 'PAYING':      where.status = { in: ['ACTIVE', 'DISPUTED'] }; break;
      case 'TO_DISPATCH': where.status = 'COMPLETED'; where.fulfillmentStatus = 'PENDING'; break;
      case 'DISPATCHED':  where.status = 'COMPLETED'; where.fulfillmentStatus = 'DISPATCHED'; break;
      case 'DELIVERED':   where.status = 'COMPLETED'; where.fulfillmentStatus = 'DELIVERED'; break;
      case 'CANCELLED':   where.status = { in: ['REFUNDED', 'DEFAULTED', 'CANCELLED'] }; break;
      default:
        if (status && ['ACTIVE', 'COMPLETED', 'REFUNDED', 'DEFAULTED', 'CANCELLED', 'DISPUTED'].includes(status)) where.status = status;
    }
    const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.ssOrder.count({ where }),
      this.prisma.ssOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE,
        include: {
          product: { select: { name: true, referenceNumber: true, images: true } },
          customer: { select: { firstName: true, lastName: true } },
          chatThread: { select: { id: true } },
        },
      }),
    ]);
    return {
      total, page: Math.max(1, page), pageSize: PAGE_SIZE,
      items: rows.map((o: any) => ({
        ...this.presentOrder(this.withThumb(o), false),
        customer: this.shortName(o.customer),
        chatThreadId: o.chatThread?.id ?? null,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════
  // THE VENDOR'S PRODUCTS WITH THEIR ORDER COUNTS (the first screen of "Customer plans")
  // ══════════════════════════════════════════════════════════

  async listVendorOrderProducts(vendorId: string) {
    // (cast: Prisma's groupBy typing is strict about the result type, the shape below is what it returns)
    const groups = (await (this.prisma.ssOrder as any).groupBy({
      by: ['productId', 'status', 'fulfillmentStatus'],
      where: { vendorId },
      _count: { _all: true },
    })) as any[];
    const ids = Array.from(new Set(groups.map(g => g.productId)));
    if (ids.length === 0) return { items: [] };

    const products: any[] = await this.prisma.ssProduct.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, referenceNumber: true, images: true, price: true },
    });

    const items = products.map(p => {
      const c = { paying: 0, toDispatch: 0, dispatched: 0, delivered: 0, cancelled: 0, total: 0 };
      for (const g of groups.filter(x => x.productId === p.id)) {
        const n = g._count._all;
        c.total += n;
        if (g.status === 'ACTIVE' || g.status === 'DISPUTED') c.paying += n;
        else if (g.status === 'COMPLETED') {
          if (g.fulfillmentStatus === 'DISPATCHED') c.dispatched += n;
          else if (g.fulfillmentStatus === 'DELIVERED') c.delivered += n;
          else c.toDispatch += n;
        } else c.cancelled += n;
      }
      return {
        productId: p.id, name: p.name, referenceNumber: p.referenceNumber, price: toNaira(p.price),
        thumbnail: p.images?.[0] ? this.cloudinary.publicImageUrl(p.images[0], 240) : null,
        counts: c,
      };
    });
    // the ones that need action come first
    items.sort((a, b) => b.counts.toDispatch - a.counts.toDispatch || b.counts.paying - a.counts.paying || a.name.localeCompare(b.name));
    return { items };
  }

  // The vendor's "customers who asked for their money back" screen
  async listVendorRefunds(vendorId: string, page = 1) {
    const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
    const where = { vendorId };
    const [total, rows] = await Promise.all([
      this.prisma.ssRefund.count({ where }),
      this.prisma.ssRefund.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE,
        include: { order: { select: { orderNumber: true, totalPrice: true, product: { select: { name: true, referenceNumber: true } },
          customer: { select: { firstName: true, lastName: true } } } } },
      }),
    ]);
    return {
      total, page: Math.max(1, page), pageSize: PAGE_SIZE,
      items: rows.map((r: any) => ({
        id: r.id, date: r.createdAt, reason: r.reason,
        customer: this.shortName(r.order.customer),
        product: { name: r.order.product.name, referenceNumber: r.order.product.referenceNumber },
        orderNumber: r.order.orderNumber,
        amountPaid: toNaira(r.paidAmount), percentPaid: Number(r.paidPercentAtRequest),
        yourShare: toNaira(r.vendorShare),
      })),
    };
  }

  // Product images are stored as Cloudinary public_ids; turn the first one into a small thumbnail URL
  private withThumb(o: any) {
    if (o.product?.images) {
      const first = o.product.images[0];
      o.product.thumbnail = first ? this.cloudinary.publicImageUrl(first, 240) : null;
    }
    return o;
  }
}