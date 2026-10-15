// ============================================================
// KYC MODULE — NIN + BVN + Face Scan with server-verified liveness
// ============================================================
//
// Face step, how it works now (the browser is NEVER trusted):
//   1. POST /kyc/liveness/start   -> server picks a random challenge order and
//                                    returns a signed, single-use, 3-minute session token
//   2. Browser runs LivenessCapture with THOSE challenges, captures a JPEG
//   3. POST /kyc/submit-face      -> { image (data URL), sessionToken }
//        server: verifies token (signature, user, expiry, minimum duration, single use)
//                validates the JPEG itself (no server-side fetch of user URLs = no SSRF)
//                runs Prembly liveness (presentation-attack check)
//                matches the face to the photo on the user's BVN
//                FAIL CLOSED: anything uncertain -> MANUAL_REVIEW, never auto-approve
//
// New / changed env vars:
//   PREMBLY_API_KEY, PREMBLY_APP_ID        required (move the keys out of the code)
//   KYC_ENCRYPT_KEY                        required in production, 32+ chars
//   KYC_SESSION_SECRET                     required in production, 32+ random chars
//   KYC_FACE_MATCH_THRESHOLD               default 80
//   PREMBLY_FACE_BVN_PATH                  default /biometrics/face/bvn (confirm in Prembly docs)
//   KYC_MOCK_MODE=true                     dev only, ignored when NODE_ENV=production

import {
  Module, Controller, Post, Get, Body, Req, Param,
  UseGuards, Injectable, BadRequestException,
  ConflictException, ForbiddenException, Logger,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';

const IS_PROD = process.env.NODE_ENV === 'production';
const MOCK_MODE = process.env.KYC_MOCK_MODE === 'true' && !IS_PROD;

const SESSION_TTL_MS      = 3 * 60 * 1000; // liveness session lifetime
const MIN_SESSION_AGE_MS  = 5 * 1000;      // a real person can't finish 3 challenges faster
const MAX_FAILED_ATTEMPTS = 5;             // failed face attempts per 24h
const MIN_IMAGE_BYTES     = 10 * 1024;
const MAX_IMAGE_BYTES     = 2.5 * 1024 * 1024;

export class VerifyNinDto {
  @IsString() @MinLength(11) @MaxLength(11) nin: string;
}

export class VerifyBvnDto {
  @IsString() @MinLength(11) @MaxLength(11) bvn: string;
}

export class SubmitFacePhotoDto {
  // JPEG data URL produced by LivenessCapture (data:image/jpeg;base64,....)
  @IsString() @MinLength(100) @MaxLength(3_500_000) image: string;
  @IsString() @MaxLength(2000) sessionToken: string;
  @IsOptional() @IsString() @MaxLength(200) deviceLabel?: string;
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
  private readonly apiKey  = process.env.PREMBLY_API_KEY;
  private readonly appId   = process.env.PREMBLY_APP_ID;

  constructor() {
    if (!this.apiKey || !this.appId) {
      const msg = 'PREMBLY_API_KEY and PREMBLY_APP_ID are not set. Put them in your .env file.';
      if (IS_PROD) throw new Error(msg);
      this.logger.error(msg);
    }
    if (MOCK_MODE) this.logger.warn('KYC_MOCK_MODE is ON — liveness and face match are faked. Never use in production.');
  }

  private headers() {
    return {
      'x-api-key':    this.apiKey || '',
      'app-id':       this.appId  || '',
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

  // ── Liveness / presentation-attack check (server side) ────
  async checkLiveliness(base64Image: string): Promise<{ isLive: boolean; confidence: number; detail: string }> {
    if (MOCK_MODE) return { isLive: true, confidence: 99, detail: 'mock' };
    try {
      const res  = await fetch(`${this.baseUrl}/biometrics/face/liveliness_check`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ image: base64Image }),
      });
      const data = await res.json();
      this.logger.log(`Liveliness: ${res.status} — ${data?.detail}`);
      const confidence = Number(data?.data?.confidence_in_percentage ?? 0);
      const isLive     = data?.status === true && confidence >= 70;
      return { isLive, confidence, detail: data?.detail || 'No response' };
    } catch (err: any) {
      this.logger.error(`Liveliness check failed: ${err.message}`);
      // FAIL CLOSED: a provider outage must never let someone through.
      return { isLive: false, confidence: 0, detail: 'Liveliness service error' };
    }
  }

  // ── Face match: selfie vs the photo held on the user's BVN ─
  // NOTE: confirm the exact path and response shape in your Prembly dashboard docs.
  // The path can be changed with PREMBLY_FACE_BVN_PATH. If the response shape differs,
  // matched stays false and the user goes to MANUAL_REVIEW (never auto-approved).
  async matchFaceToBvn(bvn: string, base64Image: string): Promise<{ matched: boolean; confidence: number; detail: string }> {
    if (MOCK_MODE) return { matched: true, confidence: 99, detail: 'mock' };
    const threshold = Number(process.env.KYC_FACE_MATCH_THRESHOLD || 80);
    try {
      const path = process.env.PREMBLY_FACE_BVN_PATH || '/biometrics/face/bvn';
      const res  = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ number: bvn, image: base64Image }),
      });
      const data: any = await res.json();
      this.logger.log(`Face match: ${res.status} — ${data?.detail || data?.message}`);
      const candidates = [
        data?.face_data?.confidence,
        data?.face_verification?.confidence,
        data?.data?.confidence_in_percentage,
        data?.data?.confidence,
        data?.confidence,
      ];
      const confidence = Number(candidates.find(c => c !== undefined && c !== null && !isNaN(Number(c))) ?? 0);
      const flagged    = data?.face_data?.match ?? data?.face_verification?.match ?? data?.data?.match;
      const matched    = data?.status === true && flagged !== false && confidence >= threshold;
      return { matched, confidence, detail: data?.detail || data?.message || 'No response' };
    } catch (err: any) {
      this.logger.error(`Face match failed: ${err.message}`);
      return { matched: false, confidence: 0, detail: 'Face match service error' };
    }
  }
}

// ══════════════════════════════════════════════════════════════
// KYC SERVICE
// ══════════════════════════════════════════════════════════════

@Injectable()
export class KycService {
  private readonly logger        = new Logger('KycService');
  private readonly nameThreshold = Number(process.env.KYC_NAME_MATCH_THRESHOLD || 80);
  private readonly encryptKey: string;
  private readonly sessionSecret: string;

  constructor(
    private readonly prisma:        PrismaService,
    private readonly dojah:         DojahProvider,
    private readonly notifications: NotificationsService,
  ) {
    const envKey = process.env.KYC_ENCRYPT_KEY;
    if (envKey && envKey.length >= 32) {
      this.encryptKey = envKey.slice(0, 32);
    } else if (IS_PROD) {
      throw new Error('KYC_ENCRYPT_KEY must be set (32+ characters) in production.');
    } else {
      // Dev only: old fallback so records you already encrypted still decrypt.
      this.logger.warn('KYC_ENCRYPT_KEY missing — using the insecure dev fallback key. Set it in .env.');
      this.encryptKey = 'paypaddy-kyc-key-32-chars-exact!!'.slice(0, 32);
    }

    const envSecret = process.env.KYC_SESSION_SECRET;
    if (envSecret && envSecret.length >= 32) {
      this.sessionSecret = envSecret;
    } else if (IS_PROD) {
      throw new Error('KYC_SESSION_SECRET must be set (32+ characters) in production.');
    } else {
      this.logger.warn('KYC_SESSION_SECRET missing — deriving a dev secret. Set it in .env.');
      this.sessionSecret = 'dev-session-' + this.encryptKey;
    }
  }

  // AES-256-GCM (authenticated). Old CBC values ("iv:data") still decrypt.
  private encrypt(text: string): string {
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.encryptKey), iv);
    const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return `v2:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  private decrypt(text: string): string {
    if (text.startsWith('v2:')) {
      const [, ivHex, tagHex, encHex] = text.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(this.encryptKey), Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
    }
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

  private dobsMatch(a: string, b: string): boolean {
    if (!a || !b) return true;
    const parse = (s: string) => {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      const digits = s.replace(/\D/g, '');
      return digits.length === 8 ? digits : s.trim();
    };
    return parse(a) === parse(b);
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

  // ── Liveness session helpers (stateless, HMAC-signed) ─────
  private signSession(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig  = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifySession(token: string): any | null {
    const [body, sig] = (token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private async assertFaceAttemptsLeft(userId: string) {
    const since  = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failed = await this.prisma.kycAttempt.count({
      where: { userId, type: { in: ['FACE_LIVENESS', 'FACE_MATCH'] }, status: 'FAILED', createdAt: { gte: since } },
    });
    if (failed >= MAX_FAILED_ATTEMPTS) {
      throw new HttpException('Too many failed face scans today. Please try again tomorrow or contact support.', HttpStatus.TOO_MANY_REQUESTS);
    }
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
      // The photo is a biometric: it is no longer sent back to the browser on every status poll.
      facePhotoUrl:    null,
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
        throw new ConflictException('This NIN is already linked to another AjoDaddy account.');
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
        throw new ConflictException('This BVN is already linked to another AjoDaddy account.');
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
    const dobMatch        = skipMatch ? true : this.dobsMatch(ninDob, bvnDob);
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

    // NOTE: user.status = ACTIVE is set in submitFacePhoto after face liveness + match.

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

  // ── Step 3a: start a liveness session ─────────────────────
  // The SERVER chooses the challenges and their order. The browser only follows them.
  async startLiveness(userId: string) {
    const record = await this.prisma.identityRecord.findUnique({ where: { userId } });
    if (!record?.bvnVerified) throw new BadRequestException('Please complete NIN and BVN verification before the face scan.');
    if ((record as any).facePhotoUrl) throw new BadRequestException('Face scan already submitted.');
    await this.assertFaceAttemptsLeft(userId);

    const now        = Date.now();
    const challenges = this.shuffle(['blink', 'smile', 'turn']);
    const sessionToken = this.signSession({
      uid: userId,
      sid: crypto.randomUUID(),
      ch:  challenges,
      iat: now,
      exp: now + SESSION_TTL_MS,
    });

    return { sessionToken, challenges, expiresInSec: Math.floor(SESSION_TTL_MS / 1000) };
  }

  // ── Step 3b: submit the captured face ─────────────────────
  async submitFacePhoto(userId: string, image: string, sessionToken: string, deviceLabel?: string, ipAddress?: string) {
    const record = await this.prisma.identityRecord.findUnique({ where: { userId } });
    if (!record) throw new BadRequestException('Please complete NIN and BVN verification first.');
    if (!record.bvnVerified) throw new BadRequestException('Please complete BVN verification before face scan.');
    if ((record as any).facePhotoUrl) throw new BadRequestException('Face photo already submitted.');
    await this.assertFaceAttemptsLeft(userId);

    // 1) Session: signed by us, belongs to this user, not expired, not too fast
    const session = this.verifySession(sessionToken);
    if (!session || session.uid !== userId) throw new ForbiddenException('Invalid liveness session. Please start the face scan again.');
    const now = Date.now();
    if (now > session.exp) throw new BadRequestException('Liveness session expired. Please start the face scan again.');
    if (now - session.iat < MIN_SESSION_AGE_MS) {
      await this.prisma.auditLog.create({ data: { actorId: userId, action: 'KYC_FACE_TOO_FAST', entityType: 'USER', entityId: userId, metadata: { ms: now - session.iat, ipAddress, deviceLabel: deviceLabel || null } } }).catch(() => {});
      throw new BadRequestException('Face scan was completed too quickly. Please try again.');
    }

    // 2) Single use: the unique key makes a second attempt with the same session fail
    try {
      await this.prisma.idempotencyKey.create({
        data: { key: `kyc-live-${session.sid}`, response: 'used', expiresAt: new Date(session.exp + 60 * 60 * 1000) },
      });
    } catch {
      throw new ForbiddenException('This liveness session was already used. Please start the face scan again.');
    }

    // 3) The image itself: must be a real JPEG of sane size. We never fetch a user-supplied URL.
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(image || '');
    if (!m) throw new BadRequestException('Invalid image. Please retake your photo.');
    const base64 = m[1];
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < MIN_IMAGE_BYTES || buffer.length > MAX_IMAGE_BYTES) throw new BadRequestException('Image size is not valid. Please retake your photo.');
    if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) throw new BadRequestException('Image is not a valid JPEG. Please retake your photo.');

    // 4) Presentation-attack / liveness check by the provider (server side, always on)
    const liveliness = await this.dojah.checkLiveliness(base64);
    await this.prisma.kycAttempt.create({
      data: {
        userId, type: 'FACE_LIVENESS', provider: 'prembly',
        status: liveliness.isLive ? 'SUCCESS' : 'FAILED',
        responseData: { confidence: liveliness.confidence, detail: liveliness.detail, challenges: session.ch, deviceLabel: deviceLabel || null },
        errorMessage: liveliness.isLive ? undefined : liveliness.detail, ipAddress,
      },
    }).catch(() => {});

    if (!liveliness.isLive) {
      throw new BadRequestException(
        `Face liveness check failed (${liveliness.detail}). Please retake your photo in good lighting, looking directly at the camera with no filters.`
      );
    }

    // 5) Face match against the photo on the BVN. Uncertain = manual review, never auto-approve.
    let bvnPlain: string | null = null;
    try { if (record.bvnEncrypted) bvnPlain = this.decrypt(record.bvnEncrypted); } catch { bvnPlain = null; }
    const match = bvnPlain
      ? await this.dojah.matchFaceToBvn(bvnPlain, base64)
      : { matched: false, confidence: 0, detail: 'BVN unavailable for face match' };

    await this.prisma.kycAttempt.create({
      data: {
        userId, type: 'FACE_MATCH', provider: 'prembly',
        status: match.matched ? 'SUCCESS' : 'FAILED',
        responseData: { confidence: match.confidence, detail: match.detail },
        errorMessage: match.matched ? undefined : match.detail, ipAddress,
      },
    }).catch(() => {});

    const approved = match.matched && record.identityMatched && record.status === 'VERIFIED';
    const newStatus = approved ? 'VERIFIED' : 'MANUAL_REVIEW';
    const reviewReason = !match.matched
      ? `Face did not match BVN photo (${match.detail})`
      : (record.rejectionReason || null);

    await this.prisma.identityRecord.update({
      where: { userId },
      data: {
        facePhotoUrl:    image, // JPEG data URL (see note about moving to private storage)
        faceScannedAt:   new Date(),
        status:          newStatus,
        rejectionReason: approved ? null : reviewReason,
      } as any,
    });

    if (approved) {
      await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', isEmailVerified: true } });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: userId, action: 'KYC_FACE_SUBMITTED', entityType: 'USER', entityId: userId,
        metadata: {
          approved, livenessConfidence: liveliness.confidence, faceMatchConfidence: match.confidence,
          sessionId: session.sid, challenges: session.ch, deviceLabel: deviceLabel || null, ipAddress,
        },
      },
    });

    await this.notifications.create({
      userId, type: 'SYSTEM',
      title: approved ? 'Identity fully verified! 🎉' : 'Face scan received',
      body: approved
        ? 'Your identity is fully verified. Your AjoDaddy account is now active!'
        : 'Your face scan has been received. Your account is under manual review.',
      data: { step: 'FACE_SUBMITTED' },
    }).catch(() => {});

    return {
      message: approved
        ? 'Face scan submitted and liveness confirmed. Your account is now active!'
        : 'Face scan submitted. Your account is under manual review.',
      status: newStatus,
      nextStep: approved ? 'COMPLETE' : 'MANUAL_REVIEW',
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
  // Routes the full settled amount (original contribution + late fee) into the
  // SYSTEM/company revenue wallet, with a proper Transaction audit trail on both sides.
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

  @Post('liveness/start')
  @ApiOperation({ summary: 'Step 3a: Start a liveness session (server picks the challenges)' })
  startLiveness(@Req() req: any) { return this.kycService.startLiveness(req.user.id); }

  @Post('submit-face')
  @ApiOperation({ summary: 'Step 3b: Submit the captured face (JPEG data URL + session token)' })
  submitFace(@Req() req: any, @Body() dto: SubmitFacePhotoDto) {
    return this.kycService.submitFacePhoto(req.user.id, dto.image, dto.sessionToken, dto.deviceLabel, req.ip);
  }

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