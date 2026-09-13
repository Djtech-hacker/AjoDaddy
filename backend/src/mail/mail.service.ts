// ============================================================
// MAIL SERVICE — Email sending via Mailjet (HTTPS API)
// ============================================================
// Previously: raw SMTP (Gmail) — blocked at the network level on
// Render (every send timed out at exactly connectionTimeout).
// Then: Resend's HTTP API — works, but its free/sandbox tier only
// allows sending TO the exact email address the account was signed up
// with, until you verify a whole domain (costs money, needs a domain).
// Then: attempted Brevo — API key generation kept failing with a
// platform-side error unrelated to anything in this codebase.
//
// FIX: switched to Mailjet. Same core benefit (plain HTTPS API, so no
// SMTP port blocking) as Resend/Brevo, but Mailjet's free tier (200
// emails/day, no credit card) only requires verifying a single SENDER
// EMAIL ADDRESS — a 2-minute "click the link we emailed you" step —
// after which you can send to ANY recipient, not just yourself.
//
// Mailjet's API uses HTTP Basic Auth with API_KEY as the username and
// SECRET_KEY as the password (base64-encoded "key:secret" in the
// Authorization header) — different from Resend/Brevo's single
// Bearer-token style, but otherwise the same shape of integration.
//
// All public method signatures are UNCHANGED
// (sendPasswordReset / sendEmailVerification / sendPinChangeOtp all
// take the same arguments and return the same Promise<boolean>), so
// nothing else in the codebase (auth.module.ts, etc.) needs to change.
//
// SETUP REQUIRED:
//   1. Sign up free at https://mailjet.com (no credit card needed).
//   2. Account Settings → Sender addresses & domains → Add a sender
//      address → enter the email you want to send FROM → click the
//      confirmation link Mailjet emails you. No domain required.
//   3. Account Settings → REST API → Master API Key & Sub API Keys →
//      copy both the API Key and the Secret Key (shown once).
//   4. Add these two lines to env.validation.ts's schema (both
//      optional, since only one email provider needs to be active):
//        MAILJET_API_KEY:    Joi.string().optional(),
//        MAILJET_SECRET_KEY: Joi.string().optional(),
//   5. On Render (and locally in .env), set:
//        MAILJET_API_KEY=your_api_key_here
//        MAILJET_SECRET_KEY=your_secret_key_here
//        EMAIL_FROM=your-verified-sender@example.com   (bare address
//          only — env.validation.ts's Joi.string().email() check
//          rejects the "Name <email>" format; the display name is
//          sent separately via APP_NAME, see below)
//   6. Redeploy. Registration/reset/PIN emails should now deliver to
//      any recipient, not just your own inbox.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAILJET_API_URL = 'https://api.mailjet.com/v3.1/send';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly fromEmail: string;
  private readonly appName: string;
  private readonly frontendUrl: string;
  private readonly logoUrl = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('MAILJET_API_KEY', '');
    this.secretKey = this.configService.get<string>('MAILJET_SECRET_KEY', '');
    // NOTE: bare email only (e.g. 'you@gmail.com') — NOT the
    // 'Name <email>' format, which env.validation.ts's Joi email check
    // rejects. Display name is sent separately via `FromName` below,
    // using APP_NAME.
    this.fromEmail = this.configService.get<string>('EMAIL_FROM', '');
    this.appName = this.configService.get<string>('APP_NAME', 'AjoDaddy');
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
  }

  private async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.apiKey || !this.secretKey || !this.fromEmail) {
      this.logger.warn('No MAILJET_API_KEY/MAILJET_SECRET_KEY/EMAIL_FROM set — logging email instead');
      this.logger.log(`📧 TO: ${to} | SUBJECT: ${subject}`);
      return false;
    }

    try {
      // Mailjet's HTTP API — plain HTTPS POST, same as Resend/Brevo,
      // so this sidesteps Render's SMTP port blocking the same way.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      // Basic Auth: base64("API_KEY:SECRET_KEY")
      const basicAuth = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');

      const response = await fetch(MAILJET_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Messages: [
            {
              From: { Email: this.fromEmail, Name: this.appName },
              To: [{ Email: to }],
              Subject: subject,
              HTMLPart: html,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(`Mailjet API returned ${response.status}: ${JSON.stringify(data)}`);
      }

      // Mailjet returns per-message status inside Messages[0].Status —
      // even a 200 response can carry a "error" status for that
      // specific message (e.g. unverified sender), so check it too.
      const messageStatus = data?.Messages?.[0]?.Status;
      if (messageStatus && messageStatus !== 'success') {
        throw new Error(`Mailjet message status "${messageStatus}": ${JSON.stringify(data)}`);
      }

      this.logger.log(`Email sent to ${to} (status: ${messageStatus ?? 'unknown'})`);
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