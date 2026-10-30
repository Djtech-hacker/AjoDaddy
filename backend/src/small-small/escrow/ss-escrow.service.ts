// ============================================================
// PAY SMALL SMALL: ESCROW SERVICE
// ============================================================
//
// THE ONLY PLACE WHERE PAY SMALL SMALL MONEY MOVES. Every method takes the
// database transaction (`tx`) from the caller, so a payment, its escrow hold,
// its ledger entries and the order update either ALL happen or NONE do.
//
// Where the money physically sits
//   Customer wallet  : wallets.balance (as always)
//   Escrow           : the SYSTEM wallet. Escrow adds to BOTH its balance and its
//                      lockedBalance, so (balance - lockedBalance) is still only
//                      the company's own revenue, and
//                      SYSTEM.lockedBalance == sum(SsOrder.escrowBalance).
//   Vendor wallet    : wallets.balance (withdrawn through your normal flow, 1% fee)
//   Company revenue  : SYSTEM wallet balance (refund fee share, optional sale fee)
//
// Why raw SQL for wallet balances
//   WalletService.creditWallet()/debitWallet() read the balance, calculate in
//   code, then write the absolute number back. Two requests at the same moment can
//   both read the same balance and one overwrites the other. Here every change is a
//   single UPDATE ... balance = balance - X WHERE balance - locked >= X, which the
//   database applies one at a time, so a wallet can never be overdrawn.
//
// Wallet history rows (Transaction table), using your existing types:
//   customer pays         -> CONTRIBUTION  (counts as "spent" in wallet stats)
//   vendor is paid        -> PAYOUT        (counts as "received")
//   refund to customer    -> REFUND
//   company revenue       -> WALLET_FUNDING on SYSTEM (same as your withdrawal fee)
//   escrow in / out       -> ADJUSTMENT on SYSTEM
// Each row has metadata.source = 'pay_small_small' so screens can label them properly.

import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { RefundBreakdown } from '../utils/ss-money.util';

const SYSTEM_USER_ID = 'SYSTEM';

type WalletMove = { walletId: string; before: bigint; after: bigint };

export type LedgerLine = {
  orderId: string | null;
  account: 'CUSTOMER_WALLET' | 'VENDOR_WALLET' | 'ESCROW' | 'COMPANY_REVENUE';
  direction: 'CREDIT' | 'DEBIT';
  type: 'ESCROW_HOLD' | 'ESCROW_RELEASE' | 'ESCROW_REFUND' | 'REFUND_FEE_VENDOR' | 'REFUND_FEE_PLATFORM' | 'VENDOR_PAYOUT' | 'SALE_FEE';
  userId?: string | null;
  amount: bigint;
  reference: string;
  metadata?: any;
};

type TxRow = {
  userId: string; walletId: string;
  type: 'CONTRIBUTION' | 'PAYOUT' | 'REFUND' | 'WALLET_FUNDING' | 'ADJUSTMENT';
  amount: bigint; before: bigint; after: bigint;
  reference: string; description: string; metadata?: any;
};

@Injectable()
export class SsEscrowService {
  private readonly logger = new Logger('SsEscrowService');

  // ══════════════════════════════════════════════════════════
  // LOW LEVEL: wallet balances (atomic) and history rows
  // ══════════════════════════════════════════════════════════

  // Take money out of a customer's AVAILABLE balance (balance - lockedBalance).
  // Returns null when there is not enough: nothing is changed in that case.
  async debitAvailable(tx: any, userId: string, amount: bigint): Promise<WalletMove | null> {
    const rows = (await tx.$queryRaw`
      UPDATE wallets
         SET balance = balance - ${amount}, "updatedAt" = NOW()
       WHERE "userId" = ${userId}
         AND "isActive" = true
         AND balance - "lockedBalance" >= ${amount}
      RETURNING id, balance
    `) as Array<{ id: string; balance: bigint }>;
    if (rows.length === 0) return null;
    const after = BigInt(rows[0].balance);
    return { walletId: rows[0].id, before: after + amount, after };
  }

  // Add money to a wallet. Crediting is never blocked by "isActive": we never refuse
  // to pay someone because their wallet was frozen, the money just waits there.
  async credit(tx: any, userId: string, amount: bigint): Promise<WalletMove> {
    const rows = (await tx.$queryRaw`
      UPDATE wallets
         SET balance = balance + ${amount}, "updatedAt" = NOW()
       WHERE "userId" = ${userId}
      RETURNING id, balance
    `) as Array<{ id: string; balance: bigint }>;
    if (rows.length === 0) throw new InternalServerErrorException('A wallet needed for this payment was not found.');
    const after = BigInt(rows[0].balance);
    return { walletId: rows[0].id, before: after - amount, after };
  }

  // Put money into escrow: SYSTEM balance AND lockedBalance both go up
  private async escrowAdd(tx: any, amount: bigint): Promise<WalletMove> {
    const rows = (await tx.$queryRaw`
      UPDATE wallets
         SET balance = balance + ${amount}, "lockedBalance" = "lockedBalance" + ${amount}, "updatedAt" = NOW()
       WHERE "userId" = ${SYSTEM_USER_ID}
      RETURNING id, balance
    `) as Array<{ id: string; balance: bigint }>;
    if (rows.length === 0) throw new InternalServerErrorException('The escrow account is not set up.');
    const after = BigInt(rows[0].balance);
    return { walletId: rows[0].id, before: after - amount, after };
  }

  // Take money out of escrow. Refuses (and changes nothing) if escrow would go negative,
  // which would mean the books are out of sync.
  private async escrowRemove(tx: any, amount: bigint): Promise<WalletMove> {
    const rows = (await tx.$queryRaw`
      UPDATE wallets
         SET balance = balance - ${amount}, "lockedBalance" = "lockedBalance" - ${amount}, "updatedAt" = NOW()
       WHERE "userId" = ${SYSTEM_USER_ID}
         AND "lockedBalance" >= ${amount}
         AND balance >= ${amount}
      RETURNING id, balance
    `) as Array<{ id: string; balance: bigint }>;
    if (rows.length === 0) {
      this.logger.error(`ESCROW OUT OF SYNC: tried to release ${amount} kobo but the escrow account does not hold it`);
      throw new InternalServerErrorException('Payment could not be completed. Our team has been alerted.');
    }
    const after = BigInt(rows[0].balance);
    return { walletId: rows[0].id, before: after + amount, after };
  }

  // Company revenue goes into the SYSTEM wallet's free balance (not locked)
  private async revenueAdd(tx: any, amount: bigint): Promise<WalletMove> {
    const rows = (await tx.$queryRaw`
      UPDATE wallets
         SET balance = balance + ${amount}, "updatedAt" = NOW()
       WHERE "userId" = ${SYSTEM_USER_ID}
      RETURNING id, balance
    `) as Array<{ id: string; balance: bigint }>;
    if (rows.length === 0) throw new InternalServerErrorException('The company wallet is not set up.');
    const after = BigInt(rows[0].balance);
    return { walletId: rows[0].id, before: after - amount, after };
  }

  async recordTx(tx: any, r: TxRow) {
    return tx.transaction.create({
      data: {
        userId: r.userId, walletId: r.walletId, type: r.type, status: 'COMPLETED',
        amount: r.amount, balanceBefore: r.before, balanceAfter: r.after,
        reference: r.reference, description: r.description,
        metadata: { source: 'pay_small_small', ...(r.metadata || {}) },
      },
    });
  }

  async ledger(tx: any, lines: LedgerLine[]) {
    const rows = lines.filter(l => l.amount > 0n);
    if (rows.length === 0) return;
    await tx.ssLedgerEntry.createMany({
      data: rows.map(l => ({
        orderId: l.orderId, account: l.account, direction: l.direction, type: l.type,
        userId: l.userId ?? null, amount: l.amount, reference: l.reference, metadata: l.metadata ?? undefined,
      })),
    });
  }

  // ══════════════════════════════════════════════════════════
  // HIGH LEVEL: the money events of a plan
  // ══════════════════════════════════════════════════════════

  // 1) Customer pays and the vendor has NOT been paid yet: customer wallet -> escrow
  async chargeCustomerIntoEscrow(tx: any, o: {
    orderId: string; orderNumber: string; productName: string; customerId: string;
    amount: bigint; key: string; kind: 'DEPOSIT' | 'PAYMENT';
  }) {
    const debit = await this.debitAvailable(tx, o.customerId, o.amount);
    if (!debit) throw new BadRequestException('Insufficient wallet balance. Fund your wallet and try again.');

    const base = `${o.orderNumber}:${o.key}`;
    await this.recordTx(tx, {
      userId: o.customerId, walletId: debit.walletId, type: 'CONTRIBUTION', amount: o.amount,
      before: debit.before, after: debit.after, reference: `SSP-${base}`,
      description: `Pay Small Small: ${o.productName}`,
      metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: o.kind },
    });

    const esc = await this.escrowAdd(tx, o.amount);
    await this.recordTx(tx, {
      userId: SYSTEM_USER_ID, walletId: esc.walletId, type: 'ADJUSTMENT', amount: o.amount,
      before: esc.before, after: esc.after, reference: `SSE-IN-${base}`,
      description: `Escrow hold for plan ${o.orderNumber}`,
      metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'ESCROW_HOLD', fromUserId: o.customerId },
    });

    await this.ledger(tx, [
      { orderId: o.orderId, account: 'CUSTOMER_WALLET', direction: 'DEBIT',  type: 'ESCROW_HOLD', userId: o.customerId, amount: o.amount, reference: `${base}:hold:cust` },
      { orderId: o.orderId, account: 'ESCROW',          direction: 'CREDIT', type: 'ESCROW_HOLD', userId: null,         amount: o.amount, reference: `${base}:hold:escrow` },
    ]);
  }

  // 2) Customer pays AFTER the vendor was already paid (AT_PERCENT plans):
  //    customer wallet -> vendor wallet straight away (minus the optional sale fee)
  async chargeCustomerToVendor(tx: any, o: {
    orderId: string; orderNumber: string; productName: string; customerId: string; vendorId: string;
    amount: bigint; key: string; saleFeeBps: bigint;
  }) {
    const debit = await this.debitAvailable(tx, o.customerId, o.amount);
    if (!debit) throw new BadRequestException('Insufficient wallet balance. Fund your wallet and try again.');

    const base = `${o.orderNumber}:${o.key}`;
    await this.recordTx(tx, {
      userId: o.customerId, walletId: debit.walletId, type: 'CONTRIBUTION', amount: o.amount,
      before: debit.before, after: debit.after, reference: `SSP-${base}`,
      description: `Pay Small Small: ${o.productName}`,
      metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'PAYMENT_DIRECT' },
    });

    const { net, fee } = this.splitSaleFee(o.amount, o.saleFeeBps);
    await this.payVendorAndFee(tx, {
      orderId: o.orderId, orderNumber: o.orderNumber, productName: o.productName,
      vendorId: o.vendorId, net, fee, base, ledgerType: 'VENDOR_PAYOUT',
    });
    await this.ledger(tx, [
      { orderId: o.orderId, account: 'CUSTOMER_WALLET', direction: 'DEBIT', type: 'VENDOR_PAYOUT', userId: o.customerId, amount: o.amount, reference: `${base}:direct:cust` },
    ]);
    return { net, fee };
  }

  // 3) Release everything held in escrow for an order to the vendor
  async releaseEscrowToVendor(tx: any, o: {
    orderId: string; orderNumber: string; productName: string; vendorId: string;
    amount: bigint; saleFeeBps: bigint;
  }) {
    if (o.amount <= 0n) return { net: 0n, fee: 0n };
    const base = `${o.orderNumber}:release`;

    const esc = await this.escrowRemove(tx, o.amount);
    await this.recordTx(tx, {
      userId: SYSTEM_USER_ID, walletId: esc.walletId, type: 'ADJUSTMENT', amount: o.amount,
      before: esc.before, after: esc.after, reference: `SSE-OUT-${base}`,
      description: `Escrow released for plan ${o.orderNumber}`,
      metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'ESCROW_RELEASE', toUserId: o.vendorId },
    });

    const { net, fee } = this.splitSaleFee(o.amount, o.saleFeeBps);
    await this.payVendorAndFee(tx, {
      orderId: o.orderId, orderNumber: o.orderNumber, productName: o.productName,
      vendorId: o.vendorId, net, fee, base, ledgerType: 'ESCROW_RELEASE',
    });
    await this.ledger(tx, [
      { orderId: o.orderId, account: 'ESCROW', direction: 'DEBIT', type: 'ESCROW_RELEASE', userId: null, amount: o.amount, reference: `${base}:escrow` },
    ]);
    return { net, fee };
  }

  // 4) Refund: take the customer's money out of escrow and split it three ways
  async refundFromEscrow(tx: any, o: {
    orderId: string; orderNumber: string; productName: string;
    customerId: string; vendorId: string; breakdown: RefundBreakdown;
  }) {
    const b = o.breakdown;
    if (b.paid <= 0n) return;
    const base = `${o.orderNumber}:refund`;

    const esc = await this.escrowRemove(tx, b.paid);
    await this.recordTx(tx, {
      userId: SYSTEM_USER_ID, walletId: esc.walletId, type: 'ADJUSTMENT', amount: b.paid,
      before: esc.before, after: esc.after, reference: `SSE-OUT-${base}`,
      description: `Escrow refunded for plan ${o.orderNumber}`,
      metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'ESCROW_REFUND' },
    });

    // Customer gets the rest back in their normal wallet
    if (b.customerRefund > 0n) {
      const c = await this.credit(tx, o.customerId, b.customerRefund);
      await this.recordTx(tx, {
        userId: o.customerId, walletId: c.walletId, type: 'REFUND', amount: b.customerRefund,
        before: c.before, after: c.after, reference: `SSR-${base}`,
        description: `Refund: ${o.productName}`,
        metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'ESCROW_REFUND', feeTotal: Number(b.feeTotal) },
      });
    }

    // Vendor's share of the fee
    if (b.vendorShare > 0n) {
      const v = await this.credit(tx, o.vendorId, b.vendorShare);
      await this.recordTx(tx, {
        userId: o.vendorId, walletId: v.walletId, type: 'PAYOUT', amount: b.vendorShare,
        before: v.before, after: v.after, reference: `SSV-${base}`,
        description: `Cancellation share: ${o.productName}`,
        metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'REFUND_FEE_VENDOR' },
      });
    }

    // Company's share of the fee: revenue
    if (b.companyShare > 0n) {
      const r = await this.revenueAdd(tx, b.companyShare);
      await this.recordTx(tx, {
        userId: SYSTEM_USER_ID, walletId: r.walletId, type: 'WALLET_FUNDING', amount: b.companyShare,
        before: r.before, after: r.after, reference: `SSREFUNDFEE-${o.orderNumber}`,
        description: `Refund fee from plan ${o.orderNumber}`,
        metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'REFUND_FEE_PLATFORM', fromUserId: o.customerId },
      });
    }

    await this.ledger(tx, [
      { orderId: o.orderId, account: 'ESCROW',          direction: 'DEBIT',  type: 'ESCROW_REFUND',       userId: null,         amount: b.paid,           reference: `${base}:escrow` },
      { orderId: o.orderId, account: 'CUSTOMER_WALLET', direction: 'CREDIT', type: 'ESCROW_REFUND',       userId: o.customerId, amount: b.customerRefund, reference: `${base}:cust` },
      { orderId: o.orderId, account: 'VENDOR_WALLET',   direction: 'CREDIT', type: 'REFUND_FEE_VENDOR',   userId: o.vendorId,   amount: b.vendorShare,    reference: `${base}:vendor` },
      { orderId: o.orderId, account: 'COMPANY_REVENUE', direction: 'CREDIT', type: 'REFUND_FEE_PLATFORM', userId: null,         amount: b.companyShare,   reference: `${base}:company` },
    ]);
  }

  // ══════════════════════════════════════════════════════════
  // INTERNAL
  // ══════════════════════════════════════════════════════════

  // sale fee in basis points (0 by default): fee rounds DOWN, so the vendor never loses a kobo to rounding
  private splitSaleFee(gross: bigint, saleFeeBps: bigint): { net: bigint; fee: bigint } {
    const fee = (gross * saleFeeBps) / 10_000n;
    return { net: gross - fee, fee };
  }

  private async payVendorAndFee(tx: any, o: {
    orderId: string; orderNumber: string; productName: string; vendorId: string;
    net: bigint; fee: bigint; base: string; ledgerType: 'ESCROW_RELEASE' | 'VENDOR_PAYOUT';
  }) {
    if (o.net > 0n) {
      const v = await this.credit(tx, o.vendorId, o.net);
      await this.recordTx(tx, {
        userId: o.vendorId, walletId: v.walletId, type: 'PAYOUT', amount: o.net,
        before: v.before, after: v.after, reference: `SSV-${o.base}`,
        description: `Pay Small Small sale: ${o.productName}`,
        metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: o.ledgerType },
      });
    }
    if (o.fee > 0n) {
      const r = await this.revenueAdd(tx, o.fee);
      await this.recordTx(tx, {
        userId: SYSTEM_USER_ID, walletId: r.walletId, type: 'WALLET_FUNDING', amount: o.fee,
        before: r.before, after: r.after, reference: `SSSALEFEE-${o.base}`,
        description: `Sale fee from plan ${o.orderNumber}`,
        metadata: { orderId: o.orderId, orderNumber: o.orderNumber, kind: 'SALE_FEE', toVendorId: o.vendorId },
      });
    }
    await this.ledger(tx, [
      { orderId: o.orderId, account: 'VENDOR_WALLET',   direction: 'CREDIT', type: o.ledgerType, userId: o.vendorId, amount: o.net, reference: `${o.base}:vendor` },
      { orderId: o.orderId, account: 'COMPANY_REVENUE', direction: 'CREDIT', type: 'SALE_FEE',   userId: null,       amount: o.fee, reference: `${o.base}:salefee` },
    ]);
  }
}