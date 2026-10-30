import * as crypto from 'crypto';

// Product reference numbers look like  SS-2026-482913
// Customer care searches by this number. The 6 digits are random (not 1, 2, 3...)
// so nobody can guess other products' numbers. The service retries if two collide.
export function generateReferenceNumber(prefix = 'SS'): string {
  const year = new Date().getFullYear();
  const digits = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return `${prefix}-${year}-${digits}`;
}

// SS-2026-482913 (case and spaces forgiven)
export function looksLikeReferenceNumber(value: string): boolean {
  return /^SS-\d{4}-\d{6}$/i.test((value || '').trim());
}