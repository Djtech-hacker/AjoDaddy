// ============================================================
// MAIL SERVICE — Email sending via Resend (HTTPS API)
// ============================================================
// FIX: this used to send via raw SMTP (smtp.gmail.com:587) through
// Nodemailer. On Render, every single send timed out after exactly
// connectionTimeout (10s) — not intermittently, EVERY time, including
// with force-IPv4 (`family: 4`) already applied. That pattern (clean,
// consistent timeout, not a connection refusal or auth error) points
// to the hosting provider blocking or silently dropping outbound
// traffic on raw SMTP ports (25/465/587) — a common anti-spam measure
// on PaaS platforms, especially free/starter tiers. No amount of SMTP
// config tuning fixes a port that's blocked at the network level.
//
// FIX: switched to Resend's HTTP API. It sends over plain HTTPS
// (port 443), which is never blocked the way SMTP ports are — so this
// sidesteps the problem entirely instead of trying to work around it.
//
// All public method signatures are UNCHANGED
// (sendPasswordReset / sendEmailVerification / sendPinChangeOtp all
// take the same arguments and return the same Promise<boolean>), so
// nothing else in the codebase (auth.module.ts, etc.) needs to change.
//
// SETUP REQUIRED:
//   1. Sign up at https://resend.com (free tier: 100 emails/day,
//      3,000/month — plenty for dev/early production).
//   2. Get an API key from the Resend dashboard.
//   3. Add RESEND_API_KEY=re_xxxxxxxx to your environment variables
//      (both locally in .env and on Render's dashboard).
//   4. EMAIL_FROM can stay as the default 'onboarding@resend.dev' for
//      testing — Resend provides this shared sending address with no
//      setup. For production with your own domain, verify a domain in
//      the Resend dashboard and switch EMAIL_FROM to an address on it
//      (e.g. 'PayPaddy <noreply@yourdomain.com>').
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RESEND_API_URL = 'https://api.resend.com/emails';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly appName: string;
  private readonly frontendUrl: string;
  private readonly logoUrl = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('RESEND_API_KEY', '');
    this.fromEmail = this.configService.get<string>('EMAIL_FROM', 'PayPaddy <onboarding@resend.dev>');
    this.appName = this.configService.get<string>('APP_NAME', 'PayPaddy');
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
  }

  private async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn('No RESEND_API_KEY set — logging email instead');
      this.logger.log(`📧 TO: ${to} | SUBJECT: ${subject}`);
      return false;
    }

    try {
      // Resend's HTTP API — plain HTTPS POST, no SMTP ports involved
      // at all, so nothing here can be blocked the way port 587 was.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [to],
          subject,
          html,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '<unreadable body>');
        throw new Error(`Resend API returned ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      this.logger.log(`Email sent to ${to} (id: ${data?.id ?? 'unknown'})`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err);
      return false;
    }
  }

  private emailWrapper(content: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
         <img src="${this.logoUrl}" alt="${this.appName}" height="130" style="display: inline-block; height: 130px; width: auto;" />   
        </div>
        ${content}
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
          <p style="color: #999; font-size: 11px;">
            &copy; ${new Date().getFullYear()} ${this.appName}. Save Together. Grow Together.
          </p>
        </div>
      </div>
    `;
  }

  async sendPasswordReset(to: string, firstName: string, token: string): Promise<boolean> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${token}`;

    const html = this.emailWrapper(`
      <h2 style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">Reset your password</h2>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Hi ${firstName || 'there'},<br><br>
        We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}"
           style="display: inline-block; background: #1B5C3C; color: #fff; font-size: 14px; font-weight: 600;
                  padding: 12px 32px; border-radius: 8px; text-decoration: none;">
          Reset Password
        </a>
      </div>

      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        If you didn't request this, just ignore this email — your password won't change.<br><br>
        If the button doesn't work, copy and paste this URL into your browser:<br>
        <a href="${resetUrl}" style="color: #1B5C3C; word-break: break-all;">${resetUrl}</a>
      </p>
    `);

    return this.send(to, `Reset your ${this.appName} password`, html);
  }

  async sendEmailVerification(to: string, firstName: string, token: string): Promise<boolean> {
    const verifyUrl = `${this.frontendUrl}/verify-email?token=${token}`;

    const html = this.emailWrapper(`
      <h2 style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">Verify your email</h2>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Hi ${firstName},<br><br>
        Welcome to ${this.appName}! Please verify your email address to get started.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${verifyUrl}"
           style="display: inline-block; background: #1B5C3C; color: #fff; font-size: 14px; font-weight: 600;
                  padding: 12px 32px; border-radius: 8px; text-decoration: none;">
          Verify Email
        </a>
      </div>

      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        This link expires in 24 hours.<br><br>
        If the button doesn't work, copy and paste this URL:<br>
        <a href="${verifyUrl}" style="color: #1B5C3C; word-break: break-all;">${verifyUrl}</a>
      </p>
    `);

    return this.send(to, `Verify your ${this.appName} email`, html);
  }

  // Plain 6-digit code for the "change transaction PIN" flow. No
  // link/button here on purpose: this is a code the user types back
  // into the app, not something they click through.
  async sendPinChangeOtp(to: string, firstName: string, code: string): Promise<boolean> {
    const html = this.emailWrapper(`
      <h2 style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">Confirm your PIN change</h2>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Hi ${firstName || 'there'},<br><br>
        Use the code below to confirm changing your transaction PIN. This code expires in 10 minutes.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <span style="display: inline-block; background: #F3F4F6; color: #1a1a1a; font-size: 32px; font-weight: 700;
                     letter-spacing: 8px; padding: 16px 28px; border-radius: 12px;">
          ${code}
        </span>
      </div>

      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        If you didn't request this, you can safely ignore this email — your PIN won't change without this code.
      </p>
    `);

    return this.send(to, `Your ${this.appName} PIN change code`, html);
  }
}