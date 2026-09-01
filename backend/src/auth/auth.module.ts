// ============================================================
// AUTH MODULE — Full production authentication
// ============================================================
// ADDED (previous pass): verifyPassword() + POST /auth/verify-password.
//
// ADDED (this pass): the real OTP-for-PIN-change flow.
//   - POST /auth/send-pin-otp   — generates a 6-digit code, stores it in
//     the existing verificationToken table (type: 'pin_change_otp',
//     10 min expiry), emails it via MailService.sendPinChangeOtp().
//   - POST /auth/change-pin     — checks the code matches, isn't expired,
//     isn't already used, then updates the transaction PIN hash — same
//     bcrypt path setTransactionPin() already uses.
//
// NOTE: MailService needs a new sendPinChangeOtp(email, firstName, code)
// method — it doesn't exist yet. See the comment above the call site
// below for what it needs to do; it's the same shape as
// sendEmailVerification/sendPasswordReset, just a numeric code instead
// of a link.
// ============================================================

import {
  Module, Controller, Post, Get, Body, Req, Res,
  UseGuards, HttpCode, HttpStatus, UnauthorizedException,
  BadRequestException, ConflictException, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Request, Response } from 'express';
import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { nanoid } from 'nanoid';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

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

  @IsOptional()
  @IsString()
  referralCode?: string;
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

// NEW — body for POST /auth/change-pin
export class ChangePinDto {
  @IsString()
  @MinLength(4, { message: 'Enter the code sent to your email' })
  otp: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  newPin: string;
}

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
  ) {}

  async register(dto: RegisterDto, ipAddress: string) {
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existingEmail) throw new ConflictException('Email already registered');

    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username.toLowerCase() } });
    if (existingUsername) throw new ConflictException('Username already taken');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });

    let referredById: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.prisma.user.findUnique({ where: { referralCode: dto.referralCode } });
      if (referrer) referredById = referrer.id;
    }

    const user = await this.prisma.executeTransaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username.toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
          referredById,
          status: 'PENDING_VERIFICATION',
        },
      });
      await tx.wallet.create({ data: { userId: newUser.id } });
      return newUser;
    });

    await this.sendVerificationEmail(user.id, user.email, user.firstName);

    await this.prisma.auditLog.create({
      data: { actorId: user.id, action: 'USER_REGISTERED', entityType: 'User', entityId: user.id, ipAddress },
    });

    return { message: 'Registration successful. Please check your email to verify your account.' };
  }

  async login(dto: LoginDto, ipAddress: string, userAgent: string, res: Response) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, email: true, passwordHash: true, status: true, firstName: true, role: true, isEmailVerified: true, deletedAt: true },
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

    if (user.deletedAt)              { await logAttempt(false, 'ACCOUNT_DELETED');   throw new UnauthorizedException('This account no longer exists.'); }
    if (user.status === 'SUSPENDED') { await logAttempt(false, 'ACCOUNT_SUSPENDED'); throw new UnauthorizedException('Account suspended. Contact support.'); }
    if (user.status === 'BANNED')    { await logAttempt(false, 'ACCOUNT_BANNED');    throw new UnauthorizedException('Account banned.'); }

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

  // ── Verify current password — used to re-confirm identity before a
  // sensitive action (e.g. changing the transaction PIN) without
  // creating a brand new session the way calling login() again would.
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) return false;
    return argon2.verify(user.passwordHash, password);
  }

  // ── Transaction PIN — uses bcrypt to match the contribution/withdrawal check ──
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

  // ── NEW: PIN-change OTP ────────────────────────────────────
  // Called only after verifyPassword() has already succeeded on the
  // frontend, so we don't re-check the password here — this step's job
  // is just "prove you own this inbox right now."
  async sendPinChangeOtp(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // 6-digit numeric code, zero-padded, 10 minute expiry.
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Reuses verificationToken — `token` column holds the code here,
    // `type` distinguishes it from email verification tokens.
    await this.prisma.verificationToken.create({
      data: { userId, token: code, type: 'pin_change_otp', expiresAt },
    });

    // NOTE: sendPinChangeOtp doesn't exist on MailService yet — add it
    // alongside sendEmailVerification/sendPasswordReset. Signature:
    //   sendPinChangeOtp(email: string, firstName: string, code: string)
    // Body just needs to show the 6-digit code plainly (no link/button),
    // and should mention it expires in 10 minutes.
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
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.login(dto, req.ip || '', req.headers['user-agent'] || '', res);
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

  // NEW
  @Post('send-pin-otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Email a one-time code to confirm a transaction PIN change' })
  sendPinOtp(@Req() req: any) {
    return this.authService.sendPinChangeOtp(req.user.id);
  }

  // NEW
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
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy, JwtAuthGuard, JwtRefreshGuard],
  exports: [AuthService, JwtAuthGuard, JwtRefreshGuard],
})
export class AuthModule {}