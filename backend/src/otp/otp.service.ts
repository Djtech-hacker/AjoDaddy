import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service'; // adjust path

const PURPOSE = 'REGISTER';
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000; // matches the 30s cooldown in RegisterPage
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  /** 0803xxxxxxx | +234803xxxxxxx | 234803xxxxxxx -> 234803xxxxxxx */
  normalizePhone(input: string): string {
    let p = input.replace(/\D/g, '');
    if (p.startsWith('0')) p = '234' + p.slice(1);
    else if (p.length === 10) p = '234' + p;
    if (!/^234[789]\d{9}$/.test(p)) {
      throw new BadRequestException('Enter a valid Nigerian phone number');
    }
    return p;
  }

  private hash(phone: string, code: string) {
    return createHmac('sha256', process.env.OTP_SECRET!)
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  // POST /auth/send-phone-otp  ->  { otpToken }
  async sendRegisterOtp(rawPhone: string) {
    const phone = this.normalizePhone(rawPhone);
    const now = Date.now();

    // already registered? (checks common stored formats)
    const taken = await this.prisma.user.findFirst({
      where: { phone: { in: [phone, `+${phone}`, `0${phone.slice(3)}`] } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('This phone number is already registered');

    const last = await this.prisma.otpCode.findFirst({
      where: { phone, purpose: PURPOSE },
      orderBy: { createdAt: 'desc' },
    });
    if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last.createdAt.getTime())) / 1000);
      throw new HttpException(`Wait ${wait}s before requesting another code`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const sentLastHour = await this.prisma.otpCode.count({
      where: { phone, purpose: PURPOSE, createdAt: { gte: new Date(now - 3600_000) } },
    });
    if (sentLastHour >= MAX_SENDS_PER_HOUR) {
      throw new HttpException('Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.prisma.otpCode.updateMany({
      where: { phone, purpose: PURPOSE, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const record = await this.prisma.otpCode.create({
      data: {
        phone,
        purpose: PURPOSE,
        codeHash: this.hash(phone, code),
        expiresAt: new Date(now + OTP_TTL_MS),
      },
    });

    try {
      await this.sendSms(
        phone,
        `Your AjoDaddy verification code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
      );
    } catch (e) {
      await this.prisma.otpCode.delete({ where: { id: record.id } });
      this.logger.error(`SMS failed for ${phone}: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Could not send SMS right now. Try again shortly.');
    }

    return { otpToken: record.id };
  }

  // POST /auth/verify-phone-otp  ->  { phoneVerifiedToken }
  async verifyRegisterOtp(otpToken: string, code: string) {
    const record = await this.prisma.otpCode.findUnique({ where: { id: otpToken } });

    if (!record || record.purpose !== PURPOSE || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Code expired. Request a new one.');
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many wrong attempts. Request a new code.');
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });

    const a = Buffer.from(record.codeHash);
    const b = Buffer.from(this.hash(record.phone, code));
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Incorrect code');
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const phoneVerifiedToken = this.jwt.sign(
      { phone: record.phone, purpose: 'phone-verified' },
      { secret: process.env.OTP_SECRET!, expiresIn: '30m' },
    );
    return { phoneVerifiedToken };
  }

  /** Call inside register(). Throws if token is bad or phone doesn't match. Returns normalized phone. */
  assertPhoneVerified(token: string | undefined, rawPhone: string): string {
    const phone = this.normalizePhone(rawPhone);
    try {
      const p: any = this.jwt.verify(token ?? '', { secret: process.env.OTP_SECRET! });
      if (p.purpose !== 'phone-verified' || p.phone !== phone) throw new Error('mismatch');
    } catch {
      throw new UnauthorizedException('Phone verification expired. Please verify again.');
    }
    return phone;
  }

  // ---- Termii ----
  private async sendSms(to: string, message: string) {
    const apiKey = process.env.TERMII_API_KEY;
    const sender = process.env.TERMII_SENDER_ID;
    if (!apiKey || !sender) {
      throw new Error('TERMII_API_KEY or TERMII_SENDER_ID is missing in .env');
    }
    const baseUrl = process.env.TERMII_BASE_URL || 'https://api.ng.termii.com';

    const res = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,                // 234XXXXXXXXXX, no +
        from: sender,
        sms: message,
        type: 'plain',
        channel: process.env.TERMII_CHANNEL || 'generic', // 'dnd' reaches DND numbers
        api_key: apiKey,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || (data.code && data.code !== 'ok')) {
      throw new Error(`Termii ${res.status}: ${JSON.stringify(data)}`);
    }
  }
}