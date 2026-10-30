// ============================================================
// PAY SMALL SMALL: THE DAILY CHECKS (runs every hour)
// ============================================================
//
// What it does, in this order, for every active plan that needs attention:
//
//  1. REMINDERS     An installment due within 24 hours gets ONE reminder.
//  2. DEADLINE      Plan deadline plus the same grace period passed and still not fully paid
//                   -> default (step 6). The last installment is due ON the deadline, so the
//                   customer gets the same grace period for it as for every other payment.
//  3. AUTO-DEBIT    Plans set to AUTO: if installments are due and unpaid, take the money
//                   from the customer's wallet. If the wallet is short, the 48-hour
//                   grace period starts and the customer is told.
//  4. GRACE         Manual plans (or failed auto-debits) with a due, unpaid installment
//                   get a grace period (default 48 hours) and a warning.
//  5. MISSED        When grace ends and it is still unpaid, each unpaid installment is
//                   marked OVERDUE and counts as ONE missed payment. It is never counted
//                   twice. Missed payments are counted per installment, not per day.
//  6. DEFAULT       Too many missed payments (default: more than 3), or the deadline passed:
//                   - paid LESS than the refund limit, vendor not paid yet
//                       -> plan cancelled, refunded WITH the normal 10% fee (7% company, 3% vendor)
//                   - otherwise (paid past the limit, or vendor already paid)
//                       -> plan goes to customer care as a dispute; money stays where it is
//
// Safety: every money action reuses applyPaymentInTx() / refundInTx() from the orders
// service (row locks, idempotency keys, one transaction). If the job runs twice, or two
// copies of the server run it, nobody is charged twice and nothing is counted twice.
// The admin kill switch (ssFrozen) stops all of it.

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SsOrdersService, NotifyEvent, SsSettings } from '../orders/ss-orders.service';
import { refundAllowed, percentPaid } from '../utils/ss-money.util';
import { addDays } from '../utils/ss-schedule.util';

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const MIN_PAYMENT_KOBO = 10_000n; // ₦100, same minimum as manual payments
const STAFF_ROLES = ['CUSTOMER_SERVICE', 'ADMIN', 'SUPER_ADMIN'];

const toNaira = (kobo: bigint | number) => Number(kobo) / 100;
const naira   = (kobo: bigint) => '₦' + toNaira(kobo).toLocaleString('en-NG', { maximumFractionDigits: 2 });

export type CheckSummary = {
  reminders: number; autoDebited: number; autoDebitFailed: number; graceStarted: number;
  missed: number; defaultedRefunded: number; escalated: number; errors: number; skipped?: string;
};

@Injectable()
export class SsCronService {
  private readonly logger = new Logger('SsCronService');
  private running = false;

  constructor(
    private readonly prisma:  PrismaService,
    private readonly orders:  SsOrdersService,
  ) {}

  // Every hour, on the hour
  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    try {
      await this.runChecks(new Date());
    } catch (err: any) {
      this.logger.error(`Daily checks crashed: ${err?.message}`, err?.stack);
    }
  }

  // Admins can run it by hand to test (see ss-cron.controller.ts)
  async runNowAs(actorId: string, ip?: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) throw new ForbiddenException('Admin access required');
    const summary = await this.runChecks(new Date());
    await this.prisma.auditLog.create({
      data: { actorId, action: 'SS_CHECKS_RUN_MANUALLY', entityType: 'SMALL_SMALL', metadata: (summary || { skipped: 'already running' }) as any, ipAddress: ip },
    });
    return summary || { message: 'The checks are already running. Try again in a minute.' };
  }

  // `now` can be passed in so the checks can be tested at any date
  async runChecks(now: Date): Promise<CheckSummary | null> {
    if (this.running) return null;
    this.running = true;
    const summary: CheckSummary = {
      reminders: 0, autoDebited: 0, autoDebitFailed: 0, graceStarted: 0,
      missed: 0, defaultedRefunded: 0, escalated: 0, errors: 0,
    };
    try {
      const cfg = await this.orders.settings();
      if (cfg.frozen) { summary.skipped = 'Pay Small Small is frozen by an admin'; return summary; }

      await this.sendReminders(now, cfg, summary);

      const candidates = await this.prisma.ssOrder.findMany({
        where: {
          status: 'ACTIVE',
          OR: [{ nextDueDate: { lte: now } }, { deadlineAt: { lt: now } }, { graceExpiresAt: { not: null } }],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });

      for (const c of candidates) {
        try {
          await this.processOrder(c.id, now, cfg, summary);
        } catch (err: any) {
          summary.errors++;
          this.logger.error(`Order ${c.id} failed in the daily checks: ${err?.message}`);
        }
      }
      this.logger.log(`Daily checks done: ${JSON.stringify(summary)}`);
      return summary;
    } finally {
      this.running = false;
    }
  }

  // ══════════════════════════════════════════════════════════
  // 1) REMINDERS
  // ══════════════════════════════════════════════════════════

  private async sendReminders(now: Date, cfg: SsSettings, summary: CheckSummary) {
    const soon = await this.prisma.ssInstallment.findMany({
      where: { status: 'PENDING', dueDate: { gt: now, lte: addDays(now, 1) }, order: { status: 'ACTIVE' } },
      include: { order: { select: { id: true, customerId: true, paymentMode: true, product: { select: { name: true } } } } },
      take: 500,
    });

    for (const i of soon as any[]) {
      // one reminder per installment, ever
      const already = await this.prisma.notification.findFirst({
        where: { userId: i.order.customerId, type: 'SS_PAYMENT_REMINDER', data: { path: ['installmentId'], equals: i.id } },
        select: { id: true },
      });
      if (already) continue;

      const due: bigint = BigInt(i.amount) - BigInt(i.paidAmount);
      const auto = i.order.paymentMode === 'AUTO' && cfg.autoDebitEnabled;
      await this.orders.sendNotifications([{
        userId: i.order.customerId, type: 'SS_PAYMENT_REMINDER',
        title: auto ? 'Payment tomorrow' : 'Payment due soon',
        body: auto
          ? `${naira(due)} for "${i.order.product.name}" will be taken from your wallet within 24 hours. Make sure your wallet has enough.`
          : `${naira(due)} for "${i.order.product.name}" is due within 24 hours.`,
        data: { orderId: i.order.id, installmentId: i.id },
      }]);
      summary.reminders++;
    }
  }

  // ══════════════════════════════════════════════════════════
  // 2-6) ONE PLAN
  // ══════════════════════════════════════════════════════════

  private async loadOrder(orderId: string) {
    return this.prisma.ssOrder.findUnique({
      where: { id: orderId },
      include: { installments: { orderBy: { number: 'asc' } }, product: { select: { name: true } } },
    });
  }

  private async processOrder(orderId: string, now: Date, cfg: SsSettings, summary: CheckSummary) {
    let order: any = await this.loadOrder(orderId);
    if (!order || order.status !== 'ACTIVE') return;

    // 2) deadline AND its grace period passed, still not fully paid.
    //    (The last installment is due exactly on the deadline, so we never cancel before the
    //    customer, or the automatic payment, has had the chance to pay it.)
    const graceMs = cfg.graceHours * 60 * 60 * 1000;
    if (order.deadlineAt.getTime() + graceMs <= now.getTime() && order.amountPaid < order.totalPrice) {
      await this.defaultOrder(orderId, 'DEADLINE', now, cfg, summary);
      return;
    }

    // 3) automatic payment from the wallet
    let graceAnnounced = false;
    if (order.paymentMode === 'AUTO' && cfg.autoDebitEnabled) {
      const shortfall = this.dueShortfall(order, now);
      if (shortfall > 0n) {
        const result = await this.autoDebit(order, shortfall, cfg);
        if (result === 'paid') {
          summary.autoDebited++;
          order = await this.loadOrder(orderId);
          if (!order || order.status !== 'ACTIVE') return;
        } else if (result === 'insufficient') {
          summary.autoDebitFailed++;
          if (!order.graceExpiresAt) {
            const started = await this.startGrace(order, now, cfg);
            if (started) {
              summary.graceStarted++;
              graceAnnounced = true;
              await this.orders.sendNotifications([{
                userId: order.customerId, type: 'SS_AUTO_DEBIT_FAILED', title: 'We could not take your payment',
                body: `We tried to take ${naira(shortfall)} from your wallet for "${order.product.name}" but it was not enough. Fund your wallet within ${cfg.graceHours} hours to avoid a missed payment.`,
                data: { orderId }, important: true,
              }]);
              order = await this.loadOrder(orderId);
            }
          }
        }
      }
    }

    await this.evaluateGrace(order, now, cfg, summary, graceAnnounced);
  }

  // What is due and unpaid right now (installments whose date has passed)
  private dueShortfall(order: any, now: Date): bigint {
    let total = 0n;
    for (const i of order.installments) {
      if (i.status !== 'PAID' && i.dueDate.getTime() <= now.getTime()) total += BigInt(i.amount) - BigInt(i.paidAmount);
    }
    return total;
  }

  private async autoDebit(order: any, shortfall: bigint, cfg: SsSettings): Promise<'paid' | 'insufficient'> {
    const owed: bigint = BigInt(order.totalPrice) - BigInt(order.amountPaid);
    let amount = shortfall < MIN_PAYMENT_KOBO ? MIN_PAYMENT_KOBO : shortfall;
    if (amount > owed) amount = owed;

    // Same key for the same state of the plan: if this exact payment already went through,
    // a repeat run is ignored. After it succeeds the amount paid changes, so the key changes.
    const key = `ss-auto:${order.id}:${order.amountPaid.toString()}`;
    const events: NotifyEvent[] = [];
    try {
      await this.prisma.$transaction(async (tx: any) => {
        await this.orders.applyPaymentInTx(tx, {
          orderId: order.id, amount, mode: 'AUTO', key, payerId: order.customerId, isDeposit: false, cfg,
        }, events);
      }, TX_OPTIONS);
      await this.orders.sendNotifications(events);
      return 'paid';
    } catch (err: any) {
      if (/Insufficient wallet balance/i.test(err?.message || '')) return 'insufficient';
      throw err;
    }
  }

  // Only starts a grace period if none is running. Returns true if THIS call started it.
  private async startGrace(order: any, now: Date, cfg: SsSettings): Promise<boolean> {
    const res = await this.prisma.ssOrder.updateMany({
      where: { id: order.id, status: 'ACTIVE', graceExpiresAt: null },
      data: { graceExpiresAt: new Date(now.getTime() + cfg.graceHours * 60 * 60 * 1000) },
    });
    return res.count > 0;
  }

  private async evaluateGrace(order: any, now: Date, cfg: SsSettings, summary: CheckSummary, graceAnnounced: boolean) {
    if (!order || order.status !== 'ACTIVE') return;

    const dueUnpaid = order.installments.filter((i: any) => i.status !== 'PAID' && i.dueDate.getTime() <= now.getTime());
    const newlyDue = dueUnpaid.filter((i: any) => i.status === 'PENDING');

    // Nothing new is late: clear any old grace period
    if (newlyDue.length === 0) {
      if (order.graceExpiresAt) {
        await this.prisma.ssOrder.updateMany({ where: { id: order.id, status: 'ACTIVE' }, data: { graceExpiresAt: null } });
      }
      return;
    }

    // Something just became late: start the grace period and warn
    if (!order.graceExpiresAt) {
      const started = await this.startGrace(order, now, cfg);
      if (started) {
        summary.graceStarted++;
        const owing: bigint = newlyDue.reduce((t: bigint, i: any) => t + (BigInt(i.amount) - BigInt(i.paidAmount)), 0n);
        await this.orders.sendNotifications([{
          userId: order.customerId, type: 'SS_GRACE_STARTED', title: 'Payment overdue',
          body: `${naira(owing)} for "${order.product.name}" is due. Pay within ${cfg.graceHours} hours to avoid a missed payment.`,
          data: { orderId: order.id }, important: true,
        }]);
      }
      return;
    }

    // Still inside the grace period
    if (order.graceExpiresAt.getTime() > now.getTime()) return;

    // Grace is over and it is still unpaid: count each late installment as ONE missed payment
    const ids = newlyDue.map((i: any) => i.id);
    let counted = false;
    await this.prisma.$transaction(async (tx: any) => {
      // the guard on graceExpiresAt means only ONE run can count these misses
      const claimed = await tx.ssOrder.updateMany({
        where: { id: order.id, status: 'ACTIVE', graceExpiresAt: order.graceExpiresAt },
        data: { missedCount: { increment: ids.length }, graceExpiresAt: null },
      });
      if (claimed.count === 0) return;
      await tx.ssInstallment.updateMany({ where: { orderId: order.id, id: { in: ids }, status: 'PENDING' }, data: { status: 'OVERDUE' } });
      counted = true;
    }, TX_OPTIONS);
    if (!counted) return;

    summary.missed += ids.length;
    const newMissed = order.missedCount + ids.length;
    await this.orders.sendNotifications([{
      userId: order.customerId, type: 'SS_PAYMENT_MISSED', title: 'Payment missed',
      body: `You missed ${ids.length === 1 ? 'a payment' : ids.length + ' payments'} on "${order.product.name}". ${
        newMissed > cfg.maxMissed
          ? 'Your plan is being cancelled.'
          : `After ${cfg.maxMissed + 1 - newMissed} more missed payment${cfg.maxMissed + 1 - newMissed === 1 ? '' : 's'} your plan will be cancelled.`
      }`,
      data: { orderId: order.id }, important: true,
    }]);

    if (newMissed > cfg.maxMissed) await this.defaultOrder(order.id, 'MISSED', now, cfg, summary);
  }

  // ══════════════════════════════════════════════════════════
  // 6) DEFAULT
  // ══════════════════════════════════════════════════════════

  private async defaultOrder(orderId: string, why: 'DEADLINE' | 'MISSED', now: Date, cfg: SsSettings, summary: CheckSummary) {
    const events: NotifyEvent[] = [];
    const result = { outcome: 'skipped' as 'skipped' | 'refunded' | 'escalated', staffNote: '' };

    await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM ss_orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await tx.ssOrder.findUnique({ where: { id: orderId }, include: { product: { select: { name: true } } } });

      // Re-check everything now that the order is locked (a payment may have just landed)
      if (!o || o.status !== 'ACTIVE') return;
      if (o.amountPaid >= o.totalPrice) return;
      if (why === 'DEADLINE' && o.deadlineAt.getTime() + cfg.graceHours * 60 * 60 * 1000 > now.getTime()) return;
      if (why === 'MISSED' && o.missedCount <= cfg.maxMissed) return;

      const canRefund = refundAllowed({
        status: o.status, payoutReleased: o.payoutReleased, thresholdPercent: o.refundThresholdPercent,
        amountPaid: o.amountPaid, totalPrice: o.totalPrice,
      });

      if (canRefund) {
        // Below the vendor's refund limit and vendor not paid: cancel and refund with the normal fee
        await this.orders.refundInTx(tx, { orderId, reason: 'DEFAULT', requireEligible: false }, events);
        result.outcome = 'refunded';
        return;
      }

      // Past the refund limit (or the vendor was already paid): a person decides
      const pct = percentPaid(o.amountPaid, o.totalPrice);
      result.staffNote = `${o.orderNumber} "${o.product.name}": ${why === 'DEADLINE' ? 'deadline passed' : 'too many missed payments'}, paid ${pct}% (${naira(o.amountPaid)} of ${naira(o.totalPrice)}), vendor ${o.payoutReleased ? 'already paid' : 'not paid yet'}.`;
      await tx.ssOrder.update({
        where: { id: orderId },
        data: { status: 'DISPUTED', defaultedAt: now, nextDueDate: null, graceExpiresAt: null },
      });
      await tx.dispute.create({
        data: {
          reporterId: o.vendorId, reportedUserId: o.customerId, ssOrderId: o.id, type: 'SS_DEFAULT',
          description: `Automatic: ${result.staffNote} Money is untouched. Customer care must decide (refund, extend, or release to the vendor).`,
          status: 'OPEN',
        },
      });
      events.push({
        userId: o.customerId, type: 'SS_ORDER_DEFAULTED', title: 'Plan under review',
        body: `Your plan for "${o.product.name}" has missed payments and is now with customer care. They will contact you.`,
        data: { orderId: o.id }, important: true,
      });
      events.push({
        userId: o.vendorId, type: 'SS_DISPUTE_OPENED', title: 'Plan under review',
        body: `A customer's plan on "${o.product.name}" missed payments and is now with customer care.`,
        data: { orderId: o.id }, important: true,
      });
      result.outcome = 'escalated';
    }, TX_OPTIONS);

    await this.orders.sendNotifications(events);

    if (result.outcome === 'refunded') summary.defaultedRefunded++;
    if (result.outcome === 'escalated') {
      summary.escalated++;
      const staff = await this.prisma.user.findMany({
        where: { role: { in: STAFF_ROLES as any }, status: 'ACTIVE' }, select: { id: true }, take: 100,
      });
      await this.orders.sendNotifications(staff.map((s: any) => ({
        userId: s.id, type: 'SS_DISPUTE_OPENED', title: 'Pay Small Small plan needs a decision',
        body: result.staffNote, data: { orderId }, important: true,
      })));
    }
  }
}