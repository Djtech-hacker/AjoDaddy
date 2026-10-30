// ============================================================
// PAY SMALL SMALL: MONEY RULES
// ============================================================
//
// The rules that decide who gets money, as pure functions (no database).
// Every comparison uses whole-number BigInt math in kobo, never decimals,
// so "29.99% paid" and "30% paid" can never be confused by rounding.

import { BadRequestException } from '@nestjs/common';

// Percent with two decimals, rounded DOWN (for display only: never use it for decisions)
export function percentPaid(paid: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((paid * 10_000n) / total) / 100;
}

// Prisma Decimal, number or string -> basis points (10.00% = 1000 bps)
function toBps(percent: number | string | { toString(): string }): bigint {
  const n = Number(String(percent));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException('Invalid percentage setting.');
  return BigInt(Math.round(n * 100));
}

export type RefundBreakdown = {
  paid: bigint;
  feeTotal: bigint;       // taken from the customer
  vendorShare: bigint;    // part of the fee that goes to the vendor
  companyShare: bigint;   // the rest of the fee, kept by the company
  customerRefund: bigint; // what goes back to the customer's wallet
};

// Example: paid ₦50,000, fee 10%, vendor share 3%
//   fee ₦5,000 -> vendor ₦1,500, company ₦3,500, customer gets ₦45,000
// Rounding is always against the fee (rounded down), and the company gets whatever is left
// of the fee, so the four numbers always add up exactly: vendor + company + customer = paid.
export function refundBreakdown(
  paid: bigint,
  feePercent: number | string | { toString(): string },
  vendorSharePercent: number | string | { toString(): string },
): RefundBreakdown {
  if (paid < 0n) throw new BadRequestException('Invalid amount.');
  const feeBps = toBps(feePercent);
  const vendorBps = toBps(vendorSharePercent);
  if (vendorBps > feeBps) throw new BadRequestException('The vendor share cannot be bigger than the refund fee.');

  const feeTotal = (paid * feeBps) / 10_000n;
  const vendorShare = (paid * vendorBps) / 10_000n;
  const companyShare = feeTotal - vendorShare;
  const customerRefund = paid - feeTotal;
  return { paid, feeTotal, vendorShare, companyShare, customerRefund };
}

// A customer may refund only while ALL of these are true:
//   - the plan is still ACTIVE
//   - the vendor has not been paid yet
//   - the vendor allows refunds (threshold above 0)
//   - the customer has paid LESS than the threshold (exactly at the threshold = locked)
export function refundAllowed(o: {
  status: string;
  payoutReleased: boolean;
  thresholdPercent: number;
  amountPaid: bigint;
  totalPrice: bigint;
}): boolean {
  if (o.status !== 'ACTIVE') return false;
  if (o.payoutReleased) return false;
  if (o.thresholdPercent <= 0) return false;
  // paid / total < threshold / 100   <=>   paid * 100 < threshold * total
  return o.amountPaid * 100n < BigInt(o.thresholdPercent) * o.totalPrice;
}

// Is it time to pay the vendor?
//   ON_FULL_PAYMENT : once the customer has paid everything
//   AT_PERCENT      : once the customer has paid at least payoutPercent (exactly at it counts)
// Never pays twice (payoutReleased).
export function payoutDue(o: {
  payoutMode: string;
  payoutPercent: number | null;
  payoutReleased: boolean;
  amountPaid: bigint;
  totalPrice: bigint;
}): boolean {
  if (o.payoutReleased) return false;
  if (o.payoutMode === 'ON_FULL_PAYMENT') return o.amountPaid >= o.totalPrice;
  if (o.payoutMode === 'AT_PERCENT' && o.payoutPercent != null) {
    return o.amountPaid * 100n >= BigInt(o.payoutPercent) * o.totalPrice;
  }
  return false;
}