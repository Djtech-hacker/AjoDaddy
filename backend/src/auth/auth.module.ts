// ============================================================
// AUTH MODULE — Full production authentication
// ============================================================
// ADDED (previous pass): verifyPassword() + POST /auth/verify-password.
// ADDED (previous pass): OTP-for-PIN-change flow (send-pin-otp / change-pin).
// FIX (previous pass): login() checks isEmailVerified.
// FIX (previous pass): register() sends the verification email fire-and-forget.
// ADDED (previous pass): register() accepts optional avatarUrl.
// FIX (previous pass): phone OTP security (HMAC-hashed code, randomInt,
//   constant-time compare, 503 when SMS fails).
//
// ADDED (this pass): real two-factor authentication (email OTP).
//   - POST /auth/2fa/send-otp       — emails a code to enable/disable 2FA
//   - POST /auth/2fa/enable         — confirm code -> twoFactorEnabled = true
//   - POST /auth/2fa/disable        — password + code -> twoFactorEnabled = false
//   - login() returns { twoFactorRequired, twoFactorToken, maskedEmail }
//     when the user has 2FA on (no session is issued yet)
//   - POST /auth/2fa/login/verify   — token + code -> real session
//   - POST /auth/2fa/login/resend   — new login code
//   Codes live in verificationToken as HMAC hashes (type 2fa_enable /
//   2fa_disable / 2fa_login). The twoFactorToken is signed with a separate
//   secret and uses `uid` (not `sub`) so it can never pass as an access token.
//   MailService.send() returns false on failure instead of throwing, so
//   issueTwoFactorCode() checks the return value and fails loudly.
// ============================================================

import {
  Module, Controller, Post, Get, Body, Req, Res,
  UseGuards, HttpCode, HttpStatus, UnauthorizedException,
  BadRequestException, ConflictException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Request, Response } from 'express';
import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches, IsIn } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { nanoid } from 'nanoid';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsModule } from '../sms/sms.module';
import { TermiiService } from '../sms/termii.service';

// ── DTOs ─────────────────────────────────────────────────────

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(2) @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(2) @MaxLength(50)
  lastName: string;

  @IsString()
  @MinLength(3) @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain letters, numbers, and underscores' })
  username: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    { message: 'Password must contain uppercase, lowercase, and a number' },
  )
  password: string;

  @IsString()
  @Matches(/^\+?\d{10,15}$/, { message: 'Enter a valid phone number' })
  phone: string;

  @IsString()
  phoneVerifiedToken: string;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  avatarUrl?: string;
}

export class SendPhoneOtpDto {
  @IsString()
  @Matches(/^\+?\d{10,15}$/, { message: 'Enter a valid phone number' })
  phone: string;
}

export class VerifyPhoneOtpDto {
  @IsString()
  otpToken: string;

  @IsString()
  @MinLength(6) @MaxLength(6)
  code: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, { message: 'Password must contain uppercase, lowercase, and a number' })
  newPassword: string;
}

export class SetTransactionPinDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;
}

export class VerifyEmailDto {
  @IsString()
  token: string;
}

export class VerifyPasswordDto {
  @IsString()
  @MinLength(1)
  password: string;
}

export class ChangePinDto {
  @IsString()
  @MinLength(4, { message: 'Enter the code sent to your email' })
  otp: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  newPin: string;
}

// ── 2FA DTOs ─────────────────────────────────────────────────

export class TwoFactorSendDto {
  @IsIn(['enable', 'disable'])
  purpose: 'enable' | 'disable';
}

export class TwoFactorCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  password: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class TwoFactorLoginDto {
  @IsString()
  twoFactorToken: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class TwoFactorResendDto {
  @IsString()
  twoFactorToken: string;
}

type TwoFactorType = '2fa_enable' | '2fa_disable' | '2fa_login';

// ── JWT Strategies ────────────────────────────────────────────

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(JwtStrategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        role: true, status: true, isEmailVerified: true, deletedAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.deletedAt) throw new UnauthorizedException('Account no longer exists');
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account suspended');
    if (user.status === 'BANNED') throw new UnauthorizedException('Account banned');
    return user;
  }
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(JwtStrategy, 'jwt-refresh') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.refresh_token,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const refreshToken = req?.cookies?.refresh_token;
    return { ...payload, refreshToken };
  }
}

// ── Guards ────────────────────────────────────────────────────

@Injectable()
export class JwtAuthGuard extends PassportAuthGuard('jwt') {}

@Injectable()
export class JwtRefreshGuard extends PassportAuthGuard('jwt-refresh') {}

// ── Auth Service ─────────────────────────────────────────────

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly termii: TermiiService,
  ) {}

  async register(dto: RegisterDto, ipAddress: string) {
    let phonePayload: any;
    try {
      phonePayload = this.jwtService.verify(dto.phoneVerifiedToken, { secret: this.configService.get('jwt.secret') });
    } catch {
      throw new BadRequestException('Phone verification expired. Please verify your phone number again.');
    }
    if (!phonePayload?.verified || phonePayload.phone !== dto.phone) {
      throw new BadRequestException('Phone verification does not match. Please verify your phone number again.');
    }

    const existingPhone = await this.prisma.user.findFirst({ where: { phone: dto.phone } });
    if (existingPhone) throw new ConflictException('Phone number already registered');

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existingEmail) throw new ConflictException('Email already registered');

    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username.toLowerCase() } });
    if (existingUsername) throw new ConflictException('Username already taken');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });

    const user = await this.prisma.executeTransaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username.toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
          phone: dto.phone,
          isPhoneVerified: true,
          status: 'PENDING_VERIFICATION',
        },
      });
      await tx.wallet.create({ data: { userId: newUser.id } });
      return newUser;
    });

    if (dto.avatarUrl) {
      await this.usersService.uploadAvatarFromDataUrl(user.id, dto.avatarUrl);
    }

    this.sendVerificationEmail(user.id, user.email, user.firstName).catch((err) => {
      console.error(`[register] sendVerificationEmail failed for ${user.email}:`, err);
    });

    await this.prisma.auditLog.create({
      data: { actorId: user.id, action: 'USER_REGISTERED', entityType: 'User', entityId: user.id, ipAddress },
    }).catch((err) => {
      console.error(`[register] auditLog failed for ${user.id}:`, err);
    });

    return { message: 'Registration successful. Please check your email to verify your account.' };
  }

  async login(dto: LoginDto, ipAddress: string, userAgent: string, res: Response) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true, email: true, passwordHash: true, status: true, firstName: true,
        role: true, isEmailVerified: true, deletedAt: true, twoFactorEnabled: true,
      },
    });

    const logAttempt = async (success: boolean, reason?: string) => {
      await this.prisma.loginAttempt.create({
        data: { userId: user?.id, email: dto.email.toLowerCase(), ipAddress, userAgent, success, reason },
      });
    };

    if (!user || !user.passwordHash) {
      await logAttempt(false, 'USER_NOT_FOUND');
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      await logAttempt(false, 'WRONG_PASSWORD');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isEmailVerified) {
      await logAttempt(false, 'EMAIL_NOT_VERIFIED');
      throw new UnauthorizedException('Please verify your email before logging in. Check your inbox for the verification link.');
    }

    if (user.deletedAt)              { await logAttempt(false, 'ACCOUNT_DELETED');   throw new UnauthorizedException('This account no longer exists.'); }
    if (user.status === 'SUSPENDED') { await logAttempt(false, 'ACCOUNT_SUSPENDED'); throw new UnauthorizedException('Account suspended. Contact support.'); }
    if (user.status === 'BANNED')    { await logAttempt(false, 'ACCOUNT_BANNED');    throw new UnauthorizedException('Account banned.'); }

    // 2FA: password was right, but no session until the emailed code is confirmed.
    if (user.twoFactorEnabled) {
      const email = await this.issueTwoFactorCode(user.id, '2fa_login', 5 * 60 * 1000);
      const twoFactorToken = this.jwtService.sign(
        { uid: user.id, purpose: '2fa-login' },
        { secret: this.tfaSecret(), expiresIn: '10m' },
      );
      return { twoFactorRequired: true, twoFactorToken, maskedEmail: this.maskEmail(email) };
    }

    await logAttempt(true);
    return this.generateTokensAndLogin(user, ipAddress, userAgent, res);
  }

  async generateTokensAndLogin(user: any, ipAddress: string, userAgent: string, res: Response) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.expiresIn'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.refreshSecret'),
      expiresIn: this.configService.get('jwt.refreshExpiresIn'),
    });

    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.executeTransaction(async (tx) => {
      await tx.refreshToken.upsert({
        where:  { token: refreshToken },
        update: { isRevoked: false, expiresAt: refreshExpiry },
        create: { userId: user.id, token: refreshToken, isRevoked: false, expiresAt: refreshExpiry },
      });
      await tx.session.create({
        data: { userId: user.id, ipAddress, userAgent, deviceInfo: userAgent, expiresAt: refreshExpiry },
      });
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN || 'localhost',
    });

    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, email: true, username: true, firstName: true, lastName: true,
        avatarUrl: true, role: true, status: true, isEmailVerified: true,
        hasTransactionPin: true, reputationScore: true, createdAt: true,
      },
    });

    return { accessToken, user: fullUser };
  }

  async refreshTokens(userId: string, oldToken: string, res: Response) {
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token: oldToken, userId, isRevoked: false },
      include: { user: { select: { id: true, email: true, role: true, status: true } } },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } });
    return this.generateTokensAndLogin(stored.user, '', '', res);
  }

  async logout(userId: string, refreshToken: string, res: Response) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, token: refreshToken },
      data: { isRevoked: true },
    });
    res.clearCookie('refresh_token');
    return { message: 'Logged out successfully' };
  }

  // ── Two-factor authentication (email OTP) ──────────────────

  private tfaSecret(): string {
    return `${this.configService.get<string>('jwt.secret')}:2fa`;
  }

  private tfaHash(userId: string, type: TwoFactorType, code: string): string {
    return createHmac('sha256', this.configService.get<string>('jwt.secret')!)
      .update(`2fa:${userId}:${type}:${code}`)
      .digest('hex');
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain) return email;
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
  }

  // Generates + emails a code. Older unused codes of the same type are
  // invalidated so only the newest one works. Returns the user's email.
  private async issueTwoFactorCode(userId: string, type: TwoFactorType, ttlMs: number): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const code = randomInt(100000, 1000000).toString();

    await this.prisma.verificationToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.verificationToken.create({
      data: { userId, token: this.tfaHash(userId, type, code), type, expiresAt: new Date(Date.now() + ttlMs) },
    });

    // MailService.send() returns false on failure instead of throwing.
    let sent = false;
    try {
      sent = await this.mailService.sendTwoFactorOtp(user.email, user.firstName, code, type);
    } catch (err) {
      console.error('[2fa] email send failed:', err);
    }
    if (!sent) {
      // mark the unusable code as used so it can't be guessed later
      await this.prisma.verificationToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      }).catch(() => {});
      throw new ServiceUnavailableException('Could not send the code right now. Please try again shortly.');
    }
    return user.email;
  }

  // Single-use: updateMany with usedAt:null guards against two requests
  // consuming the same code at once.
  private async consumeTwoFactorCode(userId: string, type: TwoFactorType, code: string): Promise<void> {
    const record = await this.prisma.verificationToken.findFirst({
      where: {
        userId, type, token: this.tfaHash(userId, type, code.trim()),
        usedAt: null, expiresAt: { gt: new Date() },
      },
    });
    if (!record) throw new BadRequestException('Incorrect or expired code');

    const claimed = await this.prisma.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BadRequestException('Incorrect or expired code');
  }

  async sendTwoFactorOtp(userId: string, purpose: 'enable' | 'disable') {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
    if (!user) throw new NotFoundException('User not found');
    if (purpose === 'enable' && user.twoFactorEnabled) throw new BadRequestException('Two-factor authentication is already on');
    if (purpose === 'disable' && !user.twoFactorEnabled) throw new BadRequestException('Two-factor authentication is already off');

    const email = await this.issueTwoFactorCode(userId, purpose === 'enable' ? '2fa_enable' : '2fa_disable', 10 * 60 * 1000);
    return { message: 'Code sent to your email', maskedEmail: this.maskEmail(email) };
  }

  async enableTwoFactor(userId: string, code: string) {
    await this.consumeTwoFactorCode(userId, '2fa_enable', code);
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: 'TWO_FACTOR_ENABLED', entityType: 'User', entityId: userId },
    }).catch(() => {});
    return { twoFactorEnabled: true };
  }

  async disableTwoFactor(userId: string, dto: DisableTwoFactorDto) {
    const pwOk = await this.verifyPassword(userId, dto.password);
    if (!pwOk) throw new UnauthorizedException('Incorrect password');
    await this.consumeTwoFactorCode(userId, '2fa_disable', dto.code);
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
    await this.prisma.auditLog.create({
      data: { actorId: userId, action: 'TWO_FACTOR_DISABLED', entityType: 'User', entityId: userId },
    }).catch(() => {});
    return { twoFactorEnabled: false };
  }

  private readTwoFactorToken(token: string): string {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, { secret: this.tfaSecret() });
    } catch {
      throw new UnauthorizedException('Your sign-in session expired. Please log in again.');
    }
    if (payload?.purpose !== '2fa-login' || !payload?.uid) {
      throw new UnauthorizedException('Invalid sign-in session. Please log in again.');
    }
    return payload.uid as string;
  }

  async resendTwoFactorLogin(token: string) {
    const userId = this.readTwoFactorToken(token);
    const email = await this.issueTwoFactorCode(userId, '2fa_login', 5 * 60 * 1000);
    return { message: 'A new code has been sent', maskedEmail: this.maskEmail(email) };
  }

  async verifyTwoFactorLogin(dto: TwoFactorLoginDto, ipAddress: string, userAgent: string, res: Response) {
    const userId = this.readTwoFactorToken(dto.twoFactorToken);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true, role: true, deletedAt: true, twoFactorEnabled: true },
    });
    if (!user || user.deletedAt || user.status === 'SUSPENDED' || user.status === 'BANNED') {
      throw new UnauthorizedException('Unable to sign in. Contact support.');
    }

    const logAttempt = (success: boolean, reason?: string) =>
      this.prisma.loginAttempt.create({
        data: { userId: user.id, email: user.email, ipAddress, userAgent, success, reason },
      }).catch(() => {});

    try {
      await this.consumeTwoFactorCode(user.id, '2fa_login', dto.code);
    } catch (err) {
      await logAttempt(false, 'TWO_FACTOR_FAILED');
      throw err;
    }

    await logAttempt(true);
    return this.generateTokensAndLogin(user, ipAddress, userAgent, res);
  }

  // ── Phone OTP (pre-registration) ───────────────────────────

  private otpHash(phone: string, code: string): string {
    return createHmac('sha256', this.configService.get<string>('jwt.secret')!)
      .update(`phone-otp:${phone}:${code}`)
      .digest('hex');
  }

  async sendPhoneOtp(phone: string) {
    const digits = phone.replace(/\D/g, '');
    const existing = await this.prisma.user.findFirst({ where: { phone: { contains: digits.slice(-10) } } });
    if (existing) throw new ConflictException('This phone number is already registered.');

    const code = randomInt(100000, 1000000).toString();

    const otpToken = this.jwtService.sign(
      { phone, h: this.otpHash(phone, code) },
      { secret: this.configService.get('jwt.secret'), expiresIn: '10m' },
    );

    try {
      await this.termii.sendOtp(phone, code);
    } catch (err) {
      console.error('[sendPhoneOtp] SMS send failed:', err);
      throw new ServiceUnavailableException('Could not send SMS right now. Please try again shortly.');
    }

    return { message: 'Code sent to your phone', otpToken };
  }

  async verifyPhoneOtp(dto: VerifyPhoneOtpDto) {
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.otpToken, { secret: this.configService.get('jwt.secret') });
    } catch {
      throw new BadRequestException('Code expired or invalid. Please request a new one.');
    }

    const expected = Buffer.from(String(payload.h || ''));
    const got = Buffer.from(this.otpHash(payload.phone, dto.code.trim()));
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      throw new BadRequestException('Incorrect code');
    }

    const phoneVerifiedToken = this.jwtService.sign(
      { phone: payload.phone, verified: true },
      { secret: this.configService.get('jwt.secret'), expiresIn: '15m' },
    );

    return { message: 'Phone verified', phoneVerifiedToken };
  }

  async sendVerificationEmail(userId: string, email: string, firstName: string) {
    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.verificationToken.create({
      data: { userId, token, type: 'email_verification', expiresAt },
    });

    await this.mailService.sendEmailVerification(email, firstName, token);
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const record = await this.prisma.verificationToken.findUnique({ where: { token: dto.token } });
    if (!record) throw new BadRequestException('Invalid verification token');
    if (record.expiresAt < new Date()) throw new BadRequestException('Verification token expired');
    if (record.usedAt) throw new BadRequestException('Token already used');

    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { isEmailVerified: true, status: 'ACTIVE' } });
      await tx.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordReset.create({ data: { userId: user.id, token, expiresAt } });

    await this.mailService.sendPasswordReset(user.email, user.firstName, token);

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordReset.findUnique({ where: { token: dto.token } });
    if (!record) throw new BadRequestException('Invalid reset token');
    if (record.expiresAt < new Date()) throw new BadRequestException('Reset token expired');
    if (record.usedAt) throw new BadRequestException('Token already used');

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });

    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.refreshToken.updateMany({ where: { userId: record.userId }, data: { isRevoked: true } });
    });

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) return false;
    return argon2.verify(user.passwordHash, password);
  }

  async setTransactionPin(userId: string, dto: SetTransactionPinDto) {
    const bcrypt = await import('bcrypt');
    const pinHash = await bcrypt.hash(dto.pin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { transactionPinHash: pinHash, hasTransactionPin: true },
    });
    return { message: 'Transaction PIN set successfully' };
  }

  async verifyTransactionPin(userId: string, pin: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { transactionPinHash: true },
    });
    if (!user?.transactionPinHash) return false;
    const bcrypt = await import('bcrypt');
    return bcrypt.compare(pin, user.transactionPinHash);
  }

  async sendPinChangeOtp(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.verificationToken.create({
      data: { userId, token: code, type: 'pin_change_otp', expiresAt },
    });

    await this.mailService.sendPinChangeOtp(user.email, user.firstName, code);

    return { message: 'Code sent to your email' };
  }

  async changePinWithOtp(userId: string, dto: ChangePinDto) {
    const record = await this.prisma.verificationToken.findFirst({
      where: { userId, type: 'pin_change_otp', token: dto.otp },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('Invalid or incorrect code');
    if (record.usedAt) throw new BadRequestException('This code has already been used');
    if (record.expiresAt < new Date()) throw new BadRequestException('This code has expired — request a new one');

    const bcrypt = await import('bcrypt');
    const pinHash = await bcrypt.hash(dto.newPin, 10);

    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { transactionPinHash: pinHash, hasTransactionPin: true },
      });
      await tx.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });

    return { message: 'Transaction PIN changed successfully' };
  }
}

// ── Auth Controller ───────────────────────────────────────────

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-phone-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Send OTP to a phone number before registration' })
  sendPhoneOtp(@Body() dto: SendPhoneOtpDto) {
    return this.authService.sendPhoneOtp(dto.phone);
  }

  @Post('verify-phone-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Verify the phone OTP before completing registration' })
  verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.authService.verifyPhoneOtp(dto);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip || '');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Login with email and password (returns twoFactorRequired when 2FA is on)' })
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.login(dto, req.ip || '', req.headers['user-agent'] || '', res);
  }

  @Post('2fa/login/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Finish login by confirming the emailed 2FA code' })
  verifyTwoFactorLogin(@Body() dto: TwoFactorLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.verifyTwoFactorLogin(dto, req.ip || '', req.headers['user-agent'] || '', res);
  }

  @Post('2fa/login/resend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Resend the login 2FA code' })
  resendTwoFactorLogin(@Body() dto: TwoFactorResendDto) {
    return this.authService.resendTwoFactorLogin(dto.twoFactorToken);
  }

  @Post('2fa/send-otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Email a code to enable or disable 2FA' })
  sendTwoFactorOtp(@Req() req: any, @Body() dto: TwoFactorSendDto) {
    return this.authService.sendTwoFactorOtp(req.user.id, dto.purpose);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Turn on 2FA after confirming the emailed code' })
  enableTwoFactor(@Req() req: any, @Body() dto: TwoFactorCodeDto) {
    return this.authService.enableTwoFactor(req.user.id, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Turn off 2FA with password + emailed code' })
  disableTwoFactor(@Req() req: any, @Body() dto: DisableTwoFactorDto) {
    return this.authService.disableTwoFactor(req.user.id, dto);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  refresh(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    return this.authService.refreshTokens(req.user.sub, req.user.refreshToken, res);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token;
    return this.authService.logout(req.user.id, refreshToken, res);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Request password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Verify current password (used before sensitive actions like changing the transaction PIN)' })
  async verifyPasswordRoute(@Req() req: any, @Body() dto: VerifyPasswordDto) {
    const valid = await this.authService.verifyPassword(req.user.id, dto.password);
    if (!valid) throw new UnauthorizedException('Incorrect password');
    return { verified: true };
  }

  @Post('send-pin-otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Email a one-time code to confirm a transaction PIN change' })
  sendPinOtp(@Req() req: any) {
    return this.authService.sendPinChangeOtp(req.user.id);
  }

  @Post('change-pin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Change transaction PIN using the emailed one-time code' })
  changePin(@Req() req: any, @Body() dto: ChangePinDto) {
    return this.authService.changePinWithOtp(req.user.id, dto);
  }

  @Post('transaction-pin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set or update transaction PIN' })
  setTransactionPin(@Req() req: any, @Body() dto: SetTransactionPinDto) {
    return this.authService.setTransactionPin(req.user.id, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@Req() req: any) {
    return { user: req.user };
  }
}

// ── Auth Module ───────────────────────────────────────────────

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: { expiresIn: configService.get<string>('jwt.expiresIn') },
      }),
    }),
    UsersModule,
    NotificationsModule,
    SmsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy, JwtAuthGuard, JwtRefreshGuard],
  exports: [AuthService, JwtAuthGuard, JwtRefreshGuard],
})
export class AuthModule {}