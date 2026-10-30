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

import {
  Injectable, BadRequestException, ConflictException, ForbiddenException,
  NotFoundException, ServiceUnavailableException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SsEscrowService } from '../escrow/ss-escrow.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { generateReferenceNumber, looksLikeReferenceNumber } from '../utils/reference-number.util';
import { buildSchedule, resolveIntervalDays, MIN_FIRST_PAYMENT_KOBO } from '../utils/ss-schedule.util';
import { refundAllowed, refundBreakdown, payoutDue, percentPaid } from '../utils/ss-money.util';
import { PreviewPlanDto, StartPlanDto, PayOrderDto } from './dto/orders.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
const MIN_PAYMENT_KOBO = 10_000n; // ₦100

// A database transaction that does ~15 queries over the internet needs more than
// Prisma's default 5 seconds.
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

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
    };
    if (forCustomer) {
      out.vendor = { businessName: o.vendor?.vendorProfile?.businessName ?? null };
      out.refundThresholdPercent = o.refundThresholdPercent;
      out.refund = this.refundStatus(o);
      out.chatThreadId = o.chatThread?.id ?? null;
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

  async startPlan(customerId: string, dto: StartPlanDto) {
    const cfg = await this.settings();
    if (cfg.frozen) throw new ServiceUnavailableException('Pay Small Small is temporarily unavailable. Please try again later.');
    if (dto.paymentMode === 'AUTO' && !cfg.autoDebitEnabled) {
      throw new BadRequestException('Automatic payments are not available right now. Choose manual payments.');
    }
    await this.assertKyc(customerId);

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
      await tx.ssChatThread.create({ data: { orderId, customerId, vendorId: p.vendorId } });

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

  async payOrder(customerId: string, orderId: string, dto: PayOrderDto) {
    const cfg = await this.settings();
    if (cfg.frozen) throw new ServiceUnavailableException('Pay Small Small is temporarily unavailable. Please try again later.');
    await this.assertKyc(customerId);

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
      for (const i of insts) {
        let status = i.status;
        if (status !== 'PAID' && left > 0n) {
          const need: bigint = BigInt(i.amount) - BigInt(i.paidAmount);
          const add: bigint = left < need ? left : need;
          const paidAmount: bigint = BigInt(i.paidAmount) + add;
          left -= add;
          const full = paidAmount >= BigInt(i.amount);
          await tx.ssInstallment.update({
            where: { id: i.id },
            data: { paidAmount, status: full ? 'PAID' : i.status, paidAt: full ? now : null },
          });
          if (full) status = 'PAID';
        }
        if (status !== 'PAID') {
          if (!nextDue) nextDue = i.dueDate;
          if (i.dueDate.getTime() <= now.getTime()) caughtUp = false;
        }
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
  // READS
  // ══════════════════════════════════════════════════════════

  async getMyOrder(customerId: string, orderId: string) {
    const o = await this.prisma.ssOrder.findFirst({
      where: { id: orderId, customerId },
      include: {
        installments: { orderBy: { number: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' }, take: 20 },
        product: { select: { name: true, referenceNumber: true, images: true } },
        vendor: { select: { vendorProfile: { select: { businessName: true } } } },
        refund: true,
        chatThread: { select: { id: true } },
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

  async listVendorOrders(vendorId: string, status?: string, page = 1) {
    const where: any = { vendorId };
    if (status && ['ACTIVE', 'COMPLETED', 'REFUNDED', 'DEFAULTED', 'CANCELLED', 'DISPUTED'].includes(status)) where.status = status;
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