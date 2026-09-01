// ============================================================
// KYC MODULE — NIN + BVN + Face Scan with Prembly Liveliness
// ============================================================

import {
  Module, Controller, Post, Get, Body, Req, Param,
  UseGuards, Injectable, BadRequestException,
  ConflictException, ForbiddenException, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';

export class VerifyNinDto {
  @IsString() @MinLength(11) @MaxLength(11) nin: string;
}

export class VerifyBvnDto {
  @IsString() @MinLength(11) @MaxLength(11) bvn: string;
}

export class SubmitFacePhotoDto {
  @IsString() facePhotoUrl: string;
}

export class RevealIdentityDto {
  @IsString() password: string;
  @IsOptional() @IsString() facePhotoUrl?: string;
}

// ══════════════════════════════════════════════════════════════
// PREMBLY PROVIDER
// ══════════════════════════════════════════════════════════════

@Injectable()
export class DojahProvider {
  private readonly logger  = new Logger('PremblyProvider');
  private readonly baseUrl = 'https://api.prembly.com/identitypass/verification';
  private readonly apiKey  = process.env.PREMBLY_API_KEY  || 'test_sk_14990dc0893448119d9cc9b88d7b06fb';
  private readonly appId   = process.env.PREMBLY_APP_ID   || 'test_pk_196a23d87ffb4ae6af0faa2869b9cc10';

  private headers() {
    return {
      'x-api-key':    this.apiKey,
      'app-id':       this.appId,
      'Content-Type': 'application/json',
    };
  }

  async lookupNin(nin: string): Promise<any> {
    const res  = await fetch(`${this.baseUrl}/nin`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number_nin: nin }),
    });
    const data = await res.json();
    this.logger.log(`NIN lookup: ${res.status} — ${data?.message}`);
    if (!data?.status) throw new Error(data?.message || 'NIN lookup failed');
    return data?.data;
  }

  async lookupBvn(bvn: string): Promise<any> {
    const res  = await fetch(`${this.baseUrl}/bvn`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number: bvn }),
    });
    const data = await res.json();
    this.logger.log(`BVN lookup: ${res.status} — ${data?.message}`);
    if (!data?.status) throw new Error(data?.message || 'BVN lookup failed');
    return data?.data;
  }

  // ── Face liveliness: is this a real, live human face? ─────
  async checkLiveliness(base64Image: string): Promise<{ isLive: boolean; confidence: number; detail: string }> {
    try {
      const res  = await fetch(`${this.baseUrl}/biometrics/face/liveliness_check`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ image: base64Image }),
      });
      const data = await res.json();
      this.logger.log(`Liveliness: ${res.status} — ${data?.detail}`);
      const confidence = data?.data?.confidence_in_percentage ?? 0;
      const isLive     = data?.status === true && confidence >= 70;
      return { isLive, confidence, detail: data?.detail || 'No response' };
    } catch (err: any) {
      this.logger.error(`Liveliness check failed: ${err.message}`);
      // Fail open only in mock mode; otherwise treat as not-live
      return { isLive: process.env.KYC_MOCK_MODE === 'true', confidence: 0, detail: 'Liveliness service error' };
    }
  }
}

// ══════════════════════════════════════════════════════════════
// KYC SERVICE
// ══════════════════════════════════════════════════════════════

@Injectable()
export class KycService {
  private readonly logger        = new Logger('KycService');
  private readonly encryptKey    = (process.env.KYC_ENCRYPT_KEY || 'paypaddy-kyc-key-32-chars-exact!!').slice(0, 32);
  private readonly nameThreshold = Number(process.env.KYC_NAME_MATCH_THRESHOLD || 80);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly dojah:         DojahProvider,
    private readonly notifications: NotificationsService,
  ) {}

  private encrypt(text: string): string {
    const iv     = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptKey), iv);
    const enc    = Buffer.concat([cipher.update(text), cipher.final()]);
    return iv.toString('hex') + ':' + enc.toString('hex');
  }

  private decrypt(text: string): string {
    const [ivHex, encHex] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptKey), Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString();
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  }

  private mask(value: string, show = 4): string {
    if (!value) return '****';
    const v = value.replace(/\s/g, '');
    if (v.length <= show) return '*'.repeat(v.length);
    return '*'.repeat(v.length - show) + v.slice(-show);
  }

  private nameSimilarity(a: string, b: string): number {
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();
    if (s1 === s2) return 100;
    if (!s1 || !s2) return 0;
    const longer  = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const dp = Array.from({ length: longer.length + 1 }, (_, i) =>
      Array.from({ length: shorter.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= longer.length; i++)
      for (let j = 1; j <= shorter.length; j++)
        dp[i][j] = longer[i-1] === shorter[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return Math.round(((longer.length - dp[longer.length][shorter.length]) / longer.length) * 100);
  }

  private async verifyAdminPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) return false;
    const hash = user.passwordHash;
    if (hash.startsWith('$argon2')) {
      try {
        const argon2 = await import('argon2');
        return await argon2.verify(hash, password);
      } catch { return false; }
    }
    try {
      const bcrypt = await import('bcrypt');
      return await bcrypt.compare(password, hash);
    } catch { return false; }
  }

  // ── Status ────────────────────────────────────────────────
  async getKycStatus(userId: string) {
    const record = await this.prisma.identityRecord.findUnique({ where: { userId } });
    if (!record) return {
      status: 'NOT_STARTED', ninVerified: false, bvnVerified: false,
      identityMatched: false, ninMasked: null, bvnMasked: null,
      faceSubmitted: false, facePhotoUrl: null,
      nextStep: 'VERIFY_NIN',
    };

    const faceSubmitted = !!(record as any).facePhotoUrl;
    const nextStep = !record.ninVerified ? 'VERIFY_NIN'
      : !record.bvnVerified ? 'VERIFY_BVN'
      : !faceSubmitted ? 'FACE_SCAN'
      : 'COMPLETE';

    return {
      status:          record.status,
      ninVerified:     record.ninVerified,
      bvnVerified:     record.bvnVerified,
      identityMatched: record.identityMatched,
      ninMasked:       record.ninMasked,
      bvnMasked:       record.bvnMasked,
      faceSubmitted,
      facePhotoUrl:    (record as any).facePhotoUrl || null,
      rejectionReason: record.rejectionReason || null,
      nextStep,
    };
  }

  // ── Step 1: NIN ───────────────────────────────────────────
  async verifyNin(userId: string, nin: string, ipAddress?: string) {
    nin = nin.trim();
    if (!/^\d{11}$/.test(nin)) throw new BadRequestException('NIN must be exactly 11 digits');
    const ninHash = this.hash(nin);

    if (process.env.KYC_ENFORCE_UNIQUE_NIN === 'true') {
      const dup = await this.prisma.identityRecord.findFirst({ where: { ninHash, NOT: { userId } } });
      if (dup) {
        await this.prisma.auditLog.create({ data: { actorId: userId, action: 'KYC_DUPLICATE_NIN_ATTEMPT', entityType: 'USER', entityId: userId, metadata: { ipAddress } } });
        throw new ConflictException('This NIN is already linked to another PayPaddy account.');
      }
    }

    const existing = await this.prisma.identityRecord.findUnique({ where: { userId } });
    // Allow re-verification if previously rejected — only block if verified AND not rejected
    if (existing?.ninVerified && existing.status !== 'REJECTED') {
      throw new BadRequestException('NIN already verified');
    }

    let ninData: any;
    let attemptStatus = 'SUCCESS';
    let errorMsg: string | undefined;
    try {
      ninData = await this.dojah.lookupNin(nin);
    } catch (err: any) {
      attemptStatus = 'FAILED';
      errorMsg = err.message;
    }

    await this.prisma.kycAttempt.create({
      data: {
        userId, type: 'NIN', provider: 'prembly', status: attemptStatus,
        requestData: { nin: this.mask(nin) },
        responseData: ninData ? { firstName: ninData.firstname, lastName: ninData.surname, dob: ninData.birthdate } : null,
        errorMessage: errorMsg, ipAddress,
      },
    });

    if (attemptStatus === 'FAILED') throw new BadRequestException(errorMsg || 'NIN verification failed. Please check your NIN and try again.');

    await this.prisma.identityRecord.upsert({
      where: { userId },
      create: {
        userId, ninHash,
        ninEncrypted:  this.encrypt(nin),
        ninMasked:     this.mask(nin),
        ninVerified:   true,
        ninVerifiedAt: new Date(),
        firstName:     ninData?.firstname  || '',
        lastName:      ninData?.surname    || '',
        dateOfBirth:   ninData?.birthdate  || '',
        phone:         ninData?.telephoneno || '',
        status:        'PENDING',
      },
     update: {
        ninHash,
        ninEncrypted:  this.encrypt(nin),
        ninMasked:     this.mask(nin),
        ninVerified:   true,
        ninVerifiedAt: new Date(),
        firstName:     ninData?.firstname  || '',
        lastName:      ninData?.surname    || '',
        dateOfBirth:   ninData?.birthdate  || '',
        phone:         ninData?.telephoneno || '',
        // Full restart when re-verifying: clear BVN + face too
        bvnVerified:     false,
        bvnEncrypted:    null,
        bvnMasked:       null,
        bvnHash:         null,
        facePhotoUrl:    null,
        faceScannedAt:   null,
        identityMatched: false,
        status:          'PENDING',
        rejectionReason: null,
      },
    });

    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'KYC_NIN_VERIFIED', entityType: 'USER', entityId: userId, metadata: { ninMasked: this.mask(nin), ipAddress } } });
    await this.notifications.create({ userId, type: 'SYSTEM', title: 'NIN verified ✅', body: 'Your NIN has been verified. Please complete BVN verification next.', data: { step: 'NIN_VERIFIED' } }).catch(() => {});
    return { message: 'NIN verified successfully', nextStep: 'VERIFY_BVN', ninMasked: this.mask(nin) };
  }

  // ── Step 2: BVN ───────────────────────────────────────────
  async verifyBvn(userId: string, bvn: string, ipAddress?: string) {
    bvn = bvn.trim();
    if (!/^\d{11}$/.test(bvn)) throw new BadRequestException('BVN must be exactly 11 digits');
    const bvnHash = this.hash(bvn);

    if (process.env.KYC_ENFORCE_UNIQUE_BVN === 'true') {
      const dup = await this.prisma.identityRecord.findFirst({ where: { bvnHash, NOT: { userId } } });
      if (dup) {
        await this.prisma.auditLog.create({ data: { actorId: userId, action: 'KYC_DUPLICATE_BVN_ATTEMPT', entityType: 'USER', entityId: userId, metadata: { ipAddress } } });
        throw new ConflictException('This BVN is already linked to another PayPaddy account.');
      }
    }

    const identityRecord = await this.prisma.identityRecord.findUnique({ where: { userId } });
    if (process.env.KYC_REQUIRE_NIN === 'true' && !identityRecord?.ninVerified) throw new BadRequestException('Please complete NIN verification first.');
    // Allow re-verification if previously rejected
    if (identityRecord?.bvnVerified && identityRecord.status !== 'REJECTED') {
      throw new BadRequestException('BVN already verified.');
    }

    let bvnData: any;
    let attemptStatus = 'SUCCESS';
    let errorMsg: string | undefined;
    try {
      bvnData = await this.dojah.lookupBvn(bvn);
    } catch (err: any) {
      attemptStatus = 'FAILED';
      errorMsg = err.message;
    }

    await this.prisma.kycAttempt.create({
      data: {
        userId, type: 'BVN', provider: 'prembly', status: attemptStatus,
        requestData: { bvn: this.mask(bvn) },
        responseData: bvnData ? { firstName: bvnData.firstName, lastName: bvnData.lastName, dob: bvnData.dateOfBirth } : null,
        errorMessage: errorMsg, ipAddress,
      },
    });

    if (attemptStatus === 'FAILED') throw new BadRequestException(errorMsg || 'BVN verification failed. Please check your BVN and try again.');

    const ninFirst  = identityRecord?.firstName || '';
    const ninLast   = identityRecord?.lastName  || '';
    const bvnFirst  = bvnData?.firstName || '';
    const bvnLast   = bvnData?.lastName  || '';
    const ninDob    = identityRecord?.dateOfBirth || '';
    const bvnDob    = bvnData?.dateOfBirth || '';

    const skipMatch       = process.env.KYC_REQUIRE_NIN !== 'true' && !ninFirst;
    const firstMatch      = skipMatch ? 100 : this.nameSimilarity(ninFirst, bvnFirst);
    const lastMatch       = skipMatch ? 100 : this.nameSimilarity(ninLast,  bvnLast);
    const dobMatch        = skipMatch ? true : (ninDob && bvnDob ? ninDob === bvnDob : true);
    const identityMatched = firstMatch >= this.nameThreshold && lastMatch >= this.nameThreshold && dobMatch;
    const finalStatus     = identityMatched ? 'VERIFIED' : 'MANUAL_REVIEW';
    const rejectionReason = identityMatched ? null : `Name/DOB mismatch: first ${firstMatch}%, last ${lastMatch}%, dob ${dobMatch ? 'match' : 'mismatch'}`;

    await this.prisma.kycAttempt.create({
      data: {
        userId, type: 'IDENTITY_MATCH', provider: 'internal',
        status: identityMatched ? 'SUCCESS' : 'FAILED',
        responseData: { firstMatch, lastMatch, dobMatch, identityMatched },
        errorMessage: rejectionReason || undefined, ipAddress,
      },
    });

    await this.prisma.identityRecord.upsert({
      where: { userId },
      create: {
        userId, bvnHash,
        bvnEncrypted:    this.encrypt(bvn),
        bvnMasked:       this.mask(bvn),
        bvnVerified:     true,
        bvnVerifiedAt:   new Date(),
        identityMatched,
        status:          finalStatus,
        rejectionReason: rejectionReason || null,
        firstName:       bvnFirst,
        lastName:        bvnLast,
        dateOfBirth:     bvnDob,
      },
      update: {
        bvnHash,
        bvnEncrypted:    this.encrypt(bvn),
        bvnMasked:       this.mask(bvn),
        bvnVerified:     true,
        bvnVerifiedAt:   new Date(),
        identityMatched,
        status:          finalStatus,
        rejectionReason: rejectionReason || null,
      },
    });

    // NOTE: user.status = ACTIVE is set in submitFacePhoto after face liveness.

    await this.prisma.auditLog.create({
      data: {
        actorId: userId, action: identityMatched ? 'KYC_COMPLETED' : 'KYC_MANUAL_REVIEW',
        entityType: 'USER', entityId: userId,
        metadata: { firstMatch, lastMatch, dobMatch, status: finalStatus, ipAddress },
      },
    });

    await this.notifications.create({
      userId, type: 'SYSTEM',
      title: identityMatched ? 'BVN verified ✅ — One more step!' : 'Verification under review',
      body: identityMatched
        ? 'Your NIN and BVN match. Please complete the face scan to activate your account.'
        : 'Your identity is under manual review. We\'ll notify you within 24 hours.',
      data: { step: 'BVN_VERIFIED', status: finalStatus },
    }).catch(() => {});

    if (!identityMatched && process.env.KYC_ALLOW_MANUAL_REVIEW !== 'true') {
      throw new ForbiddenException('Identity verification failed: your NIN and BVN details do not match. Please contact support.');
    }

    return {
      message:         identityMatched ? 'BVN verified. Please complete your face scan to activate your account.' : 'BVN verified. Your identity is under manual review.',
      status:          finalStatus,
      identityMatched,
      bvnMasked:       this.mask(bvn),
      nextStep:        identityMatched ? 'FACE_SCAN' : 'MANUAL_REVIEW',
    };
  }

  // ── Step 3: Face scan with Prembly liveliness ─────────────
  async submitFacePhoto(userId: string, facePhotoUrl: string, ipAddress?: string) {
    if (!facePhotoUrl || !facePhotoUrl.startsWith('http')) {
      throw new BadRequestException('Invalid face photo URL');
    }

    const record = await this.prisma.identityRecord.findUnique({ where: { userId } });
    if (!record) throw new BadRequestException('Please complete NIN and BVN verification first.');
    if (!record.bvnVerified) throw new BadRequestException('Please complete BVN verification before face scan.');
    if ((record as any).facePhotoUrl) throw new BadRequestException('Face photo already submitted.');

    // Download the uploaded photo and run Prembly liveliness check
    let liveliness = { isLive: true, confidence: 0, detail: 'skipped' };
    if (process.env.KYC_REQUIRE_LIVENESS !== 'false') {
      try {
        const imgRes = await fetch(facePhotoUrl);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const base64 = buffer.toString('base64');
        liveliness   = await this.dojah.checkLiveliness(base64);
      } catch (err: any) {
        this.logger.error(`Could not fetch face image: ${err.message}`);
        liveliness = { isLive: process.env.KYC_MOCK_MODE === 'true', confidence: 0, detail: 'Image fetch failed' };
      }

      await this.prisma.kycAttempt.create({
        data: {
          userId, type: 'FACE_LIVENESS', provider: 'prembly',
          status: liveliness.isLive ? 'SUCCESS' : 'FAILED',
          responseData: { confidence: liveliness.confidence, detail: liveliness.detail },
          errorMessage: liveliness.isLive ? undefined : liveliness.detail, ipAddress,
        },
      }).catch(() => {});

      if (!liveliness.isLive) {
        throw new BadRequestException(
          `Face liveness check failed (${liveliness.detail}). Please retake your photo in good lighting, looking directly at the camera with no filters.`
        );
      }
    }

    await this.prisma.identityRecord.update({
      where: { userId },
      data: {
        facePhotoUrl,
        faceScannedAt: new Date(),
      } as any,
    });

    // If identity already matched, activate user now
    if (record.identityMatched && record.status === 'VERIFIED') {
      await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', isEmailVerified: true } });
    }

    await this.prisma.auditLog.create({
      data: { actorId: userId, action: 'KYC_FACE_SUBMITTED', entityType: 'USER', entityId: userId, metadata: { facePhotoUrl, livenessConfidence: liveliness.confidence, ipAddress } },
    });

    await this.notifications.create({
      userId, type: 'SYSTEM',
      title: record.identityMatched ? 'Identity fully verified! 🎉' : 'Face scan received',
      body: record.identityMatched
        ? 'Your identity is fully verified. Your PayPaddy account is now active!'
        : 'Your face scan has been received. Your account is under manual review.',
      data: { step: 'FACE_SUBMITTED' },
    }).catch(() => {});

    return {
      message: record.identityMatched
        ? 'Face scan submitted and liveness confirmed. Your account is now active!'
        : 'Face scan submitted. Your account is under manual review.',
      status: record.status,
      nextStep: 'COMPLETE',
    };
  }

  // ── Reveal (Admin + Super Admin) ─────────────────────────
  async revealIdentity(actorId: string, targetUserId: string, password: string, facePhotoUrl?: string, ipAddress?: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true, username: true } });
    if (!actor || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Admin access required to reveal identity');
    }

    const passwordValid = await this.verifyAdminPassword(actorId, password);
    if (!passwordValid) throw new ForbiddenException('Invalid password. Access denied.');

    const record = await this.prisma.identityRecord.findUnique({ where: { userId: targetUserId } });
    if (!record) throw new BadRequestException('No identity record found for this user');

    let ninDecrypted: string | null = null;
    let bvnDecrypted: string | null = null;
    try { if (record.ninEncrypted) ninDecrypted = this.decrypt(record.ninEncrypted); } catch { ninDecrypted = null; }
    try { if (record.bvnEncrypted) bvnDecrypted = this.decrypt(record.bvnEncrypted); } catch { bvnDecrypted = null; }

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'KYC_IDENTITY_REVEALED', entityType: 'USER', entityId: targetUserId,
        metadata: { reason: 'Admin reveal', ipAddress, actorId, targetUserId, facePhotoUrl: facePhotoUrl || null, adminRole: actor.role },
        ipAddress,
      },
    });

    return {
      nin:             ninDecrypted,
      bvn:             bvnDecrypted,
      ninMasked:       record.ninMasked,
      bvnMasked:       record.bvnMasked,
      userFacePhotoUrl:(record as any).facePhotoUrl || null,
      warning:         'This access has been logged with your face photo.',
    };
  }

  // ── Debts ─────────────────────────────────────────────────
  async getMyDebts(userId: string) {
    const debts = await this.prisma.debt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return debts.map(d => ({ id: d.id, type: d.type, amount: Number(d.amount)/100, lateFee: Number(d.lateFee)/100, totalOwed: Number(d.totalOwed)/100, status: d.status, description: d.description, settledAt: d.settledAt, createdAt: d.createdAt }));
  }

  async checkOutstandingDebts(userId: string) {
    const debts = await this.prisma.debt.findMany({ where: { userId, status: 'OUTSTANDING' } });
    return { hasDebts: debts.length > 0, totalOwed: debts.reduce((s, d) => s + Number(d.totalOwed), 0) / 100, debts: debts.map(d => ({ id: d.id, type: d.type, totalOwed: Number(d.totalOwed)/100, description: d.description })) };
  }

  // ── Settle a debt ─────────────────────────────────────────
  // FIX: this previously just decremented the debtor's wallet balance via
  // a raw SQL UPDATE with no destination — no Transaction row, no credit
  // to any other wallet, no audit trail of where the money went. It
  // simply vanished. There's no clean way to retroactively credit the
  // specific historical group cycle a debt originated from (that cycle
  // has usually already moved on or the group has completed/archived by
  // the time someone settles), so this now routes the full settled
  // amount — original contribution + late fee — into the SYSTEM/company
  // revenue wallet, the same destination every other penalty in this
  // platform already uses. Now shows up in Super Admin → Company
  // Revenue and has a proper Transaction/WalletTransaction audit trail.
  async settleDebt(userId: string, debtId: string) {
    const debt = await this.prisma.debt.findFirst({ where: { id: debtId, userId, status: 'OUTSTANDING' } });
    if (!debt) throw new BadRequestException('Debt not found or already settled');

    const reference = `DEBT-SETTLE-${debtId}-${Date.now()}`;

    await this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException('Wallet not found');
      if (wallet.balance < debt.totalOwed) {
        throw new BadRequestException(`Insufficient wallet balance. You need ₦${(Number(debt.totalOwed) / 100).toLocaleString()} to settle this debt.`);
      }

      // Deduct from the debtor's wallet, with a real transaction record.
      const newBalance = wallet.balance - debt.totalOwed;
      await tx.wallet.update({ where: { userId }, data: { balance: newBalance } });
      await tx.transaction.create({
        data: {
          userId, walletId: wallet.id, type: 'ADJUSTMENT', status: 'COMPLETED',
          amount: debt.totalOwed, balanceBefore: wallet.balance, balanceAfter: newBalance,
          reference, description: `Debt settled: ${debt.description || 'Missed contribution'}`,
          metadata: { debtId, direction: 'DEBIT', originalAmount: Number(debt.amount), lateFee: Number(debt.lateFee) },
        },
      });

      // Credit the SYSTEM/company revenue wallet.
      const systemWallet = await tx.wallet.findUnique({ where: { userId: 'SYSTEM' } });
      if (systemWallet) {
        await tx.wallet.update({ where: { userId: 'SYSTEM' }, data: { balance: { increment: debt.totalOwed } } });
        await tx.transaction.create({
          data: {
            userId: 'SYSTEM', walletId: systemWallet.id, type: 'WALLET_FUNDING', status: 'COMPLETED',
            amount: debt.totalOwed, balanceBefore: systemWallet.balance, balanceAfter: systemWallet.balance + debt.totalOwed,
            reference: `${reference}-REVENUE`,
            description: `Debt settlement from user ${userId}: ${debt.description || 'Missed contribution'}`,
            metadata: { source: 'debt_settlement', fromUserId: userId, debtId, originalAmount: Number(debt.amount), lateFee: Number(debt.lateFee) },
          },
        });
      }

      await tx.debt.update({ where: { id: debtId }, data: { status: 'SETTLED', settledAt: new Date() } });
      await tx.user.update({ where: { id: userId }, data: { reputationScore: { increment: 10 } } });
      await tx.auditLog.create({ data: { actorId: userId, action: 'DEBT_SETTLED', entityType: 'USER', entityId: userId, metadata: { debtId, amount: Number(debt.totalOwed), reference } } });
    });

    await this.notifications.create({ userId, type: 'SYSTEM', title: 'Debt settled ✅', body: `Your debt of ₦${(Number(debt.totalOwed)/100).toLocaleString()} has been settled.`, data: { debtId } }).catch(() => {});
    return { message: 'Debt settled successfully' };
  }

  async createDebt(userId: string, groupId: string, amount: bigint, lateFeePercent = 10, description?: string) {
    const lateFee   = BigInt(Math.round(Number(amount) * lateFeePercent / 100));
    const totalOwed = amount + lateFee;
    const debt = await this.prisma.debt.create({ data: { userId, groupId, type: 'MISSED_CONTRIBUTION', amount, lateFee, totalOwed, status: 'OUTSTANDING', description: description || 'Missed contribution' } });
    await this.prisma.user.update({ where: { id: userId }, data: { reputationScore: { decrement: 25 } } });
    await this.prisma.auditLog.create({ data: { actorId: 'SYSTEM', action: 'DEBT_CREATED', entityType: 'USER', entityId: userId, metadata: { debtId: debt.id, amount: Number(amount), lateFee: Number(lateFee), groupId } } });
    await this.notifications.create({ userId, type: 'SYSTEM', title: 'Outstanding debt created', body: `You have an outstanding debt of ₦${(Number(totalOwed)/100).toLocaleString()}. Settle this before joining new groups.`, data: { debtId: debt.id } }).catch(() => {});
    return debt;
  }
}

// ══════════════════════════════════════════════════════════════
// CONTROLLER
// ══════════════════════════════════════════════════════════════

@ApiTags('KYC')
@Controller('kyc')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get my KYC verification status' })
  getStatus(@Req() req: any) { return this.kycService.getKycStatus(req.user.id); }

  @Post('verify-nin')
  @ApiOperation({ summary: 'Step 1: Verify NIN' })
  verifyNin(@Req() req: any, @Body() dto: VerifyNinDto) { return this.kycService.verifyNin(req.user.id, dto.nin, req.ip); }

  @Post('verify-bvn')
  @ApiOperation({ summary: 'Step 2: Verify BVN + identity match' })
  verifyBvn(@Req() req: any, @Body() dto: VerifyBvnDto) { return this.kycService.verifyBvn(req.user.id, dto.bvn, req.ip); }

  @Post('submit-face')
  @ApiOperation({ summary: 'Step 3: Submit face photo URL (uploaded to Cloudinary by frontend)' })
  submitFace(@Req() req: any, @Body() dto: SubmitFacePhotoDto) { return this.kycService.submitFacePhoto(req.user.id, dto.facePhotoUrl, req.ip); }

  @Get('debts')
  @ApiOperation({ summary: 'Get my debts' })
  getDebts(@Req() req: any) { return this.kycService.getMyDebts(req.user.id); }

  @Get('check-debts')
  @ApiOperation({ summary: 'Check outstanding debts before joining group' })
  checkDebts(@Req() req: any) { return this.kycService.checkOutstandingDebts(req.user.id); }

  @Post('debts/:debtId/settle')
  @ApiOperation({ summary: 'Settle a debt from wallet' })
  settleDebt(@Req() req: any, @Param('debtId') debtId: string) { return this.kycService.settleDebt(req.user.id, debtId); }

  @Post('admin/reveal/:userId')
  @ApiOperation({ summary: 'Admin/Super Admin: reveal full NIN/BVN with password + face audit' })
  revealIdentity(@Req() req: any, @Param('userId') userId: string, @Body() dto: RevealIdentityDto) {
    return this.kycService.revealIdentity(req.user.id, userId, dto.password, dto.facePhotoUrl, req.ip);
  }
}

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [KycController],
  providers: [KycService, DojahProvider],
  exports: [KycService],
})
export class KycModule {}