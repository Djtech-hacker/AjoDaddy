// ============================================================
// VENDOR KYC CHECK
// ============================================================
//
// This does NOT run a second face scan. The applicant already did NIN, BVN and
// the face scan (with liveness) in your KYC module. Here we only CHECK that
// result and compare names:
//
//   identityComplete : IdentityRecord is VERIFIED, BVN matched, face scan on file
//   nameMatched      : the TAREVA account name matches the verified identity name
//   payoutNameMatched: the payout bank account name matches the verified identity name
//
// For the audit log we store a REFERENCE to the face, never a copy of it:
//   identityRecordId, faceScannedAt and facePhotoSha256 (a fingerprint of the
//   photo that was on file). The photo itself stays only in IdentityRecord.

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type VendorKycResult = {
  identityComplete: boolean;
  bankFound: boolean;
  mismatch: boolean;
  // set when something needs attention: NO_IDENTITY | KYC_INCOMPLETE | NO_BANK_ACCOUNT | KYC_MISMATCH
  flag: string | null;
  verifiedName: string | null;
  faceScannedAt: Date | null;
  nameMatched: boolean | null;
  payoutNameMatched: boolean | null;
  nameScore: number | null;
  payoutNameScore: number | null;
  identityRecordId: string | null;
  facePhotoSha256: string | null;
};

@Injectable()
export class VendorKycService {
  private readonly threshold = Number(process.env.KYC_NAME_MATCH_THRESHOLD || 80);

  constructor(private readonly prisma: PrismaService) {}

  private tokens(name: string): string[] {
    return (name || '')
      .toUpperCase()
      .replace(/[^A-Z\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  private similarity(a: string, b: string): number {
    if (a === b) return 100;
    if (!a || !b) return 0;
    const longer  = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    const dp = Array.from({ length: longer.length + 1 }, (_, i) =>
      Array.from({ length: shorter.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= longer.length; i++) {
      for (let j = 1; j <= shorter.length; j++) {
        dp[i][j] = longer[i - 1] === shorter[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return Math.round(((longer.length - dp[longer.length][shorter.length]) / longer.length) * 100);
  }

  // Order-independent: every part of the verified name (first, last) must be found
  // somewhere in the other name. Extra parts (middle names) are fine.
  // "ADEBAYO JOHN OLUWASEUN" matches verified name "Oluwaseun Adebayo".
  nameMatchScore(verifiedFull: string, otherFull: string): number {
    const want = this.tokens(verifiedFull);
    const have = this.tokens(otherFull);
    if (want.length === 0 || have.length === 0) return 0;
    let lowest = 100;
    for (const w of want) {
      let best = 0;
      for (const h of have) best = Math.max(best, this.similarity(w, h));
      lowest = Math.min(lowest, best);
    }
    return lowest;
  }

  async check(userId: string, bankAccountId?: string | null): Promise<VendorKycResult> {
    const identity = await this.prisma.identityRecord.findUnique({ where: { userId } });

    const result: VendorKycResult = {
      identityComplete: false, bankFound: false, mismatch: false, flag: null,
      verifiedName: null, faceScannedAt: null,
      nameMatched: null, payoutNameMatched: null, nameScore: null, payoutNameScore: null,
      identityRecordId: null, facePhotoSha256: null,
    };

    if (!identity) { result.flag = 'NO_IDENTITY'; return result; }

    result.identityRecordId = identity.id;
    result.faceScannedAt    = identity.faceScannedAt ?? null;
    result.verifiedName     = `${identity.firstName || ''} ${identity.lastName || ''}`.trim() || null;
    result.identityComplete =
      identity.status === 'VERIFIED' &&
      identity.bvnVerified &&
      identity.identityMatched &&
      !!identity.faceScannedAt &&
      !!identity.facePhotoUrl &&
      !!result.verifiedName;

    if (identity.facePhotoUrl) {
      result.facePhotoSha256 = crypto.createHash('sha256').update(identity.facePhotoUrl).digest('hex');
    }

    if (!result.identityComplete) { result.flag = 'KYC_INCOMPLETE'; return result; }

    // TAREVA account name vs verified identity name
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    result.nameScore   = this.nameMatchScore(result.verifiedName!, `${user?.firstName || ''} ${user?.lastName || ''}`);
    result.nameMatched = result.nameScore >= this.threshold;

    // Payout bank account name vs verified identity name
    if (bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, userId } });
      if (bank) {
        result.bankFound         = true;
        result.payoutNameScore   = this.nameMatchScore(result.verifiedName!, bank.accountName);
        result.payoutNameMatched = result.payoutNameScore >= this.threshold;
      }
    }

    if (!result.bankFound) { result.flag = 'NO_BANK_ACCOUNT'; return result; }

    result.mismatch = !result.nameMatched || !result.payoutNameMatched;
    if (result.mismatch) result.flag = 'KYC_MISMATCH';
    return result;
  }

  // What goes into AuditLog.metadata (a reference to the face, not the face)
  auditSnapshot(r: VendorKycResult) {
    return {
      verifiedName:      r.verifiedName,
      identityRecordId:  r.identityRecordId,
      faceScannedAt:     r.faceScannedAt,
      facePhotoSha256:   r.facePhotoSha256,
      identityComplete:  r.identityComplete,
      nameMatched:       r.nameMatched,
      nameScore:         r.nameScore,
      payoutNameMatched: r.payoutNameMatched,
      payoutNameScore:   r.payoutNameScore,
      flag:              r.flag,
    };
  }
}
