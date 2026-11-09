// ============================================================
// RECEIPTS: verification codes so a printed receipt can be checked against the real record
// ============================================================
// A receipt carries a code: "<transactionId>.<signature>". The signature can only be made by this server
// (HMAC with RECEIPT_SECRET), so nobody can invent a code for a transaction, and nobody can guess codes.
// Opening the code shows the REAL amount, status, date and purpose from the database.
// A forged or edited receipt will not match what the check page shows.

import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  private secret(): string {
    const s = process.env.RECEIPT_SECRET || '';
    if (s.length < 16) {
      throw new InternalServerErrorException('Receipts are not set up yet. Add RECEIPT_SECRET (a long random text) to the backend .env file.');
    }
    return s;
  }

  private sign(txId: string): string {
    return createHmac('sha256', this.secret()).update('tareva-receipt:' + txId).digest('hex').slice(0, 20);
  }

  // The owner of a transaction asks for its code (to print on the receipt)
  async getCode(userId: string, txId: string) {
    if (!UUID_RE.test(txId || '')) throw new NotFoundException('Transaction not found');
    const tx = await this.prisma.transaction.findFirst({ where: { id: txId, userId }, select: { id: true } });
    if (!tx) throw new NotFoundException('Transaction not found');
    return { code: `${tx.id}.${this.sign(tx.id)}` };
  }

  private purposeOf(tx: any): string {
    const meta = (tx.metadata || {}) as any;
    if (meta.groupName) return (tx.type === 'PAYOUT' ? 'Payout from group: ' : 'Contribution to group: ') + meta.groupName;
    if (tx.type === 'WITHDRAWAL' && meta.bankName) return 'Withdrawal to ' + meta.bankName;
    if (tx.description) return String(tx.description);
    return String(tx.type || '').replace(/_/g, ' ').toLowerCase();
  }

  // Anyone with the code can check it. Only safe details are returned (no account numbers, no email).
  async verify(code: string) {
    const invalid = { valid: false };
    const [id, sig] = String(code || '').split('.');
    if (!id || !sig || !UUID_RE.test(id)) return invalid;

    const expected = Buffer.from(this.sign(id));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return invalid;

    const tx: any = await this.prisma.transaction.findUnique({
      where: { id },
      select: {
        id: true, type: true, status: true, amount: true, reference: true, description: true, metadata: true, createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!tx) return invalid;

    const last = (tx.user?.lastName || '').trim();
    const meta = (tx.metadata || {}) as any;
    return {
      valid: true,
      type: tx.type,
      status: tx.status,
      amount: Number(tx.amount) / 100, // stored in kobo
      currency: 'NGN',
      date: tx.createdAt,
      purpose: this.purposeOf(tx),
      planNumber: meta.orderNumber ?? null,
      reference: tx.reference,
      name: `${(tx.user?.firstName || '').trim()}${last ? ' ' + last[0].toUpperCase() + '.' : ''}`.trim(),
    };
  }
}