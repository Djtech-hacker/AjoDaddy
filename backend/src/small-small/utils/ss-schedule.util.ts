// ============================================================
// PAY SMALL SMALL: INSTALLMENT SCHEDULE
// ============================================================
//
// Pure functions: no database, no wallet. Everything is in KOBO as BigInt, so there
// are no floating point rounding errors with money.
//
// How a plan is built:
//   remaining      = price - first payment
//   installments   = floor(durationDays / intervalDays)   (at most one per ₦100 of remaining)
//   amount each    = floor(remaining / installments); the LAST one takes the leftover kobo
//   due dates      = start + interval, start + 2 x interval, ...
//   deadline       = start + durationDays
//
// There is NO percentage minimum on the first payment any more. The only floor is
// ₦100, the smallest payment the wallet accepts.

import { BadRequestException } from '@nestjs/common';

export type SsFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

// The smallest installment we create (₦100). Keeps tiny plans from becoming 90 payments of ₦3.
export const MIN_INSTALLMENT_KOBO = 10_000n;

// The smallest first payment (₦100), the same floor as every other payment
export const MIN_FIRST_PAYMENT_KOBO = 10_000n;

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };

export type ScheduledInstallment = { number: number; dueDate: Date; amount: bigint };

export type PlanSchedule = {
  remaining: bigint;
  installmentCount: number;
  installmentAmount: bigint; // the regular amount (the last one can be a few kobo more)
  installments: ScheduledInstallment[];
  firstDueDate: Date | null;
  deadlineAt: Date;
};

// The customer picks a frequency from what the vendor allowed.
// For CUSTOM they also pick one of the vendor's custom day options.
export function resolveIntervalDays(
  frequency: SsFrequency,
  allowedFrequencies: string[],
  allowedCustomDays: number[],
  chosenCustomDays?: number | null,
): number {
  if (!allowedFrequencies.includes(frequency)) {
    throw new BadRequestException('The vendor does not offer that payment frequency for this product.');
  }
  if (frequency !== 'CUSTOM') return FIXED_DAYS[frequency];

  if (!chosenCustomDays || !allowedCustomDays.includes(chosenCustomDays)) {
    throw new BadRequestException(`Choose one of the vendor's custom intervals: ${allowedCustomDays.join(', ')} days.`);
  }
  return chosenCustomDays;
}

// Kept only so older code and tests that import it still compile. Not used by plans any more.
export function minDepositKobo(priceKobo: bigint, minDepositPercent: number): bigint {
  return (priceKobo * BigInt(minDepositPercent) + 99n) / 100n;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function buildSchedule(input: {
  priceKobo: bigint;
  depositKobo: bigint;
  intervalDays: number;
  durationDays: number;
  maxDurationDays: number;
  startAt: Date;
  minDepositPercent?: number; // ignored: there is no percentage minimum any more
}): PlanSchedule {
  const { priceKobo, depositKobo, intervalDays, durationDays, maxDurationDays, startAt } = input;

  if (priceKobo <= 0n) throw new BadRequestException('Invalid product price.');
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new BadRequestException('Choose how many days you want to take to pay.');
  if (durationDays > maxDurationDays) {
    throw new BadRequestException(`The vendor allows at most ${maxDurationDays} days to finish paying.`);
  }
  if (durationDays < intervalDays) {
    throw new BadRequestException(`Your payment time (${durationDays} days) must be at least one payment interval (${intervalDays} days).`);
  }

  const floor = priceKobo < MIN_FIRST_PAYMENT_KOBO ? priceKobo : MIN_FIRST_PAYMENT_KOBO;
  if (depositKobo < floor) {
    throw new BadRequestException('Your first payment must be at least ₦100.');
  }
  if (depositKobo > priceKobo) throw new BadRequestException('The first payment cannot be more than the price.');

  const remaining = priceKobo - depositKobo;
  const deadlineAt = addDays(startAt, durationDays);

  // Paid in full on day one: nothing left to schedule
  if (remaining === 0n) {
    return { remaining, installmentCount: 0, installmentAmount: 0n, installments: [], firstDueDate: null, deadlineAt };
  }

  let count = Math.floor(durationDays / intervalDays);
  const maxByAmount = Number(remaining / MIN_INSTALLMENT_KOBO);
  count = Math.max(1, Math.min(count, maxByAmount));

  const base = remaining / BigInt(count);
  const last = remaining - base * BigInt(count - 1);

  const installments: ScheduledInstallment[] = [];
  for (let i = 1; i <= count; i++) {
    installments.push({
      number: i,
      dueDate: addDays(startAt, i * intervalDays),
      amount: i === count ? last : base,
    });
  }

  return {
    remaining,
    installmentCount: count,
    installmentAmount: base,
    installments,
    firstDueDate: installments[0].dueDate,
    deadlineAt,
  };
}

// How much the customer should have paid by a given moment (the first payment plus every
// installment due on or before that moment). The daily check compares this with
// what they actually paid to find missed payments.
export function expectedPaidBy(depositKobo: bigint, installments: ScheduledInstallment[], asOf: Date): bigint {
  let total = depositKobo;
  for (const i of installments) {
    if (i.dueDate.getTime() <= asOf.getTime()) total += i.amount;
  }
  return total;
}