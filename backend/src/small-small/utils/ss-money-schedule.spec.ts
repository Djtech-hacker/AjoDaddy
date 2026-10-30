import {
  buildSchedule, resolveIntervalDays, minDepositKobo, expectedPaidBy, MIN_INSTALLMENT_KOBO,
} from './ss-schedule.util';
import { refundBreakdown, refundAllowed, payoutDue, percentPaid } from './ss-money.util';

const NAIRA = (n: number) => BigInt(Math.round(n * 100));
const START = new Date('2026-11-01T00:00:00.000Z');

describe('resolveIntervalDays', () => {
  it('maps the fixed frequencies', () => {
    const allowed = ['DAILY', 'WEEKLY', 'MONTHLY'];
    expect(resolveIntervalDays('DAILY', allowed, [])).toBe(1);
    expect(resolveIntervalDays('WEEKLY', allowed, [])).toBe(7);
    expect(resolveIntervalDays('MONTHLY', allowed, [])).toBe(30);
  });
  it('rejects a frequency the vendor did not allow', () => {
    expect(() => resolveIntervalDays('DAILY', ['WEEKLY'], [])).toThrow();
  });
  it('only accepts the vendor custom days', () => {
    expect(resolveIntervalDays('CUSTOM', ['CUSTOM'], [2, 14], 14)).toBe(14);
    expect(() => resolveIntervalDays('CUSTOM', ['CUSTOM'], [2, 14], 5)).toThrow();
    expect(() => resolveIntervalDays('CUSTOM', ['CUSTOM'], [2, 14])).toThrow();
  });
});

describe('buildSchedule', () => {
  const base = {
    priceKobo: NAIRA(100000), minDepositPercent: 10, maxDurationDays: 90, startAt: START,
  };

  it('weekly for 90 days: 12 installments that add up exactly', () => {
    const s = buildSchedule({ ...base, depositKobo: NAIRA(10000), intervalDays: 7, durationDays: 90 });
    expect(s.remaining).toBe(NAIRA(90000));
    expect(s.installmentCount).toBe(12);
    expect(s.installments.reduce((t, i) => t + i.amount, 0n)).toBe(s.remaining);
    expect(s.installments[0].dueDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(s.installments[11].dueDate.toISOString()).toBe('2027-01-24T00:00:00.000Z');
    expect(s.deadlineAt.toISOString()).toBe('2027-01-30T00:00:00.000Z');
    expect(s.firstDueDate).toEqual(s.installments[0].dueDate);
  });

  it('custom 14 days over 90 days gives 6 installments', () => {
    const s = buildSchedule({ ...base, depositKobo: NAIRA(10000), intervalDays: 14, durationDays: 90 });
    expect(s.installmentCount).toBe(6);
  });

  it('the last installment takes the leftover kobo', () => {
    // 100,000.01 naira price, no deposit beyond the minimum
    const s = buildSchedule({
      ...base, priceKobo: 10_000_001n, depositKobo: 1_000_001n, intervalDays: 7, durationDays: 28,
    });
    const total = s.installments.reduce((t, i) => t + i.amount, 0n);
    expect(total).toBe(s.remaining);
    expect(s.installments.every(i => i.amount > 0n)).toBe(true);
  });

  it('does not make installments smaller than the minimum', () => {
    // ₦500 left to pay over 90 days daily would be 90 payments of about ₦5
    const s = buildSchedule({
      priceKobo: NAIRA(5500), depositKobo: NAIRA(5000), minDepositPercent: 10,
      intervalDays: 1, durationDays: 90, maxDurationDays: 90, startAt: START,
    });
    expect(s.installmentCount).toBe(5);
    expect(s.installments.every(i => i.amount >= MIN_INSTALLMENT_KOBO)).toBe(true);
  });

  it('a very small balance becomes one installment', () => {
    const s = buildSchedule({
      priceKobo: NAIRA(1000), depositKobo: NAIRA(950), minDepositPercent: 10,
      intervalDays: 7, durationDays: 28, maxDurationDays: 90, startAt: START,
    });
    expect(s.installmentCount).toBe(1);
    expect(s.installments[0].amount).toBe(NAIRA(50));
  });

  it('paying everything upfront leaves nothing to schedule', () => {
    const s = buildSchedule({ ...base, depositKobo: NAIRA(100000), intervalDays: 7, durationDays: 30 });
    expect(s.installmentCount).toBe(0);
    expect(s.installments).toEqual([]);
    expect(s.firstDueDate).toBeNull();
  });

  it('rejects a deposit below the vendor minimum, above the price, or a bad duration', () => {
    expect(() => buildSchedule({ ...base, depositKobo: NAIRA(9999), intervalDays: 7, durationDays: 30 })).toThrow();
    expect(() => buildSchedule({ ...base, depositKobo: NAIRA(100001), intervalDays: 7, durationDays: 30 })).toThrow();
    expect(() => buildSchedule({ ...base, depositKobo: NAIRA(10000), intervalDays: 7, durationDays: 91 })).toThrow();
    expect(() => buildSchedule({ ...base, depositKobo: NAIRA(10000), intervalDays: 14, durationDays: 10 })).toThrow();
    expect(() => buildSchedule({ ...base, depositKobo: NAIRA(10000), intervalDays: 7, durationDays: 0 })).toThrow();
  });

  it('minimum deposit rounds up', () => {
    expect(minDepositKobo(NAIRA(100000), 10)).toBe(NAIRA(10000));
    expect(minDepositKobo(1001n, 10)).toBe(101n); // 100.1 rounds up to 101
  });

  it('randomized: installments always add up to the remaining balance', () => {
    for (let i = 0; i < 2000; i++) {
      const price = BigInt(50_000 + Math.floor(Math.random() * 500_000_000));
      const minPct = 1 + Math.floor(Math.random() * 50);
      const deposit = minDepositKobo(price, minPct) + BigInt(Math.floor(Math.random() * 1000));
      if (deposit > price) continue;
      const interval = [1, 2, 7, 14, 30][Math.floor(Math.random() * 5)];
      const duration = interval + Math.floor(Math.random() * 300);
      const s = buildSchedule({
        priceKobo: price, depositKobo: deposit, minDepositPercent: minPct,
        intervalDays: interval, durationDays: duration, maxDurationDays: 730, startAt: START,
      });
      const sum = s.installments.reduce((t, x) => t + x.amount, 0n);
      expect(sum).toBe(s.remaining);
      expect(s.installments.every(x => x.amount > 0n)).toBe(true);
      expect(s.installments.every(x => x.dueDate.getTime() <= s.deadlineAt.getTime())).toBe(true);
    }
  });
});

describe('expectedPaidBy', () => {
  it('counts the deposit plus every installment due on or before the date', () => {
    const s = buildSchedule({
      priceKobo: NAIRA(100000), depositKobo: NAIRA(10000), minDepositPercent: 10,
      intervalDays: 7, durationDays: 28, maxDurationDays: 90, startAt: START,
    });
    const each = s.installmentAmount;
    expect(expectedPaidBy(NAIRA(10000), s.installments, START)).toBe(NAIRA(10000));
    expect(expectedPaidBy(NAIRA(10000), s.installments, new Date('2026-11-08T00:00:00.000Z'))).toBe(NAIRA(10000) + each);
    expect(expectedPaidBy(NAIRA(10000), s.installments, new Date('2026-12-31T00:00:00.000Z'))).toBe(NAIRA(100000));
  });
});

describe('refundBreakdown (10% fee, 3% to vendor)', () => {
  it('₦50,000 paid: customer ₦45,000, vendor ₦1,500, company ₦3,500', () => {
    const r = refundBreakdown(NAIRA(50000), 10, 3);
    expect(r.feeTotal).toBe(NAIRA(5000));
    expect(r.vendorShare).toBe(NAIRA(1500));
    expect(r.companyShare).toBe(NAIRA(3500));
    expect(r.customerRefund).toBe(NAIRA(45000));
  });

  it('odd kobo amount never loses or creates a kobo', () => {
    const r = refundBreakdown(12345n, 10, 3);
    expect(r.feeTotal).toBe(1234n);
    expect(r.vendorShare).toBe(370n);
    expect(r.companyShare).toBe(864n);
    expect(r.customerRefund).toBe(11111n);
    expect(r.vendorShare + r.companyShare + r.customerRefund).toBe(12345n);
  });

  it('accepts Prisma Decimal-like values and strings', () => {
    const decimalLike = { toString: () => '10.00' };
    const r = refundBreakdown(NAIRA(1000), decimalLike, '3.00');
    expect(r.feeTotal).toBe(NAIRA(100));
    expect(r.vendorShare).toBe(NAIRA(30));
  });

  it('rejects a vendor share bigger than the fee, and nonsense percentages', () => {
    expect(() => refundBreakdown(1000n, 10, 11)).toThrow();
    expect(() => refundBreakdown(1000n, 120, 3)).toThrow();
    expect(() => refundBreakdown(1000n, -1, 0)).toThrow();
  });

  it('randomized: the three parts always add up to the amount paid', () => {
    for (let i = 0; i < 5000; i++) {
      const paid = BigInt(Math.floor(Math.random() * 1_000_000_000));
      const fee = Math.round(Math.random() * 3000) / 100;        // 0 to 30%
      const vendor = Math.round(Math.random() * fee * 100) / 100; // 0 to fee
      const r = refundBreakdown(paid, fee, vendor);
      expect(r.vendorShare + r.companyShare + r.customerRefund).toBe(paid);
      expect(r.customerRefund >= 0n && r.vendorShare >= 0n && r.companyShare >= 0n).toBe(true);
    }
  });
});

describe('refundAllowed', () => {
  const open = { status: 'ACTIVE', payoutReleased: false, thresholdPercent: 30, totalPrice: NAIRA(100000) };

  it('allowed below the threshold', () => {
    expect(refundAllowed({ ...open, amountPaid: NAIRA(10000) })).toBe(true);
    expect(refundAllowed({ ...open, amountPaid: NAIRA(29999.99) })).toBe(true);
  });
  it('locked exactly at the threshold and above it', () => {
    expect(refundAllowed({ ...open, amountPaid: NAIRA(30000) })).toBe(false);
    expect(refundAllowed({ ...open, amountPaid: NAIRA(60000) })).toBe(false);
  });
  it('no refunds when the vendor set the threshold to 0', () => {
    expect(refundAllowed({ ...open, thresholdPercent: 0, amountPaid: NAIRA(1) })).toBe(false);
  });
  it('never after the vendor was paid, and never on a plan that is not active', () => {
    expect(refundAllowed({ ...open, payoutReleased: true, amountPaid: NAIRA(10000) })).toBe(false);
    for (const status of ['COMPLETED', 'REFUNDED', 'DEFAULTED', 'CANCELLED', 'DISPUTED']) {
      expect(refundAllowed({ ...open, status, amountPaid: NAIRA(10000) })).toBe(false);
    }
  });
});

describe('payoutDue', () => {
  const total = NAIRA(100000);

  it('ON_FULL_PAYMENT: only when everything is paid', () => {
    const o = { payoutMode: 'ON_FULL_PAYMENT', payoutPercent: null, payoutReleased: false, totalPrice: total };
    expect(payoutDue({ ...o, amountPaid: NAIRA(99999.99) })).toBe(false);
    expect(payoutDue({ ...o, amountPaid: total })).toBe(true);
  });

  it('AT_PERCENT: exactly at the percent counts', () => {
    const o = { payoutMode: 'AT_PERCENT', payoutPercent: 50, payoutReleased: false, totalPrice: total };
    expect(payoutDue({ ...o, amountPaid: NAIRA(49999.99) })).toBe(false);
    expect(payoutDue({ ...o, amountPaid: NAIRA(50000) })).toBe(true);
    expect(payoutDue({ ...o, amountPaid: total })).toBe(true);
  });

  it('never pays the vendor twice', () => {
    expect(payoutDue({
      payoutMode: 'ON_FULL_PAYMENT', payoutPercent: null, payoutReleased: true, totalPrice: total, amountPaid: total,
    })).toBe(false);
  });

  it('AT_PERCENT without a percent never pays out (safe default)', () => {
    expect(payoutDue({
      payoutMode: 'AT_PERCENT', payoutPercent: null, payoutReleased: false, totalPrice: total, amountPaid: total,
    })).toBe(false);
  });

  it('a refund and a payout can never both be possible at the same time', () => {
    // payoutPercent >= refund threshold is enforced when the product is saved.
    // Check the rule holds for every paid amount across a range.
    for (const threshold of [10, 30, 50, 80]) {
      for (const payoutPercent of [threshold, threshold + 10, 100].filter(p => p <= 100)) {
        for (let pct = 0; pct <= 100; pct++) {
          const amountPaid = (total * BigInt(pct)) / 100n;
          const refundable = refundAllowed({
            status: 'ACTIVE', payoutReleased: false, thresholdPercent: threshold, amountPaid, totalPrice: total,
          });
          const due = payoutDue({
            payoutMode: 'AT_PERCENT', payoutPercent, payoutReleased: false, amountPaid, totalPrice: total,
          });
          expect(refundable && due).toBe(false);
        }
      }
    }
  });
});

describe('percentPaid', () => {
  it('rounds down to two decimals', () => {
    expect(percentPaid(NAIRA(30000), NAIRA(100000))).toBe(30);
    expect(percentPaid(1n, 3n)).toBe(33.33);
    expect(percentPaid(0n, 0n)).toBe(0);
  });
});