// ============================================================
// MAIL SERVICE — Email sending via Gmail SMTP (Nodemailer)
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromEmail: string;
  private readonly appName: string;
  private readonly frontendUrl: string;
  private readonly logoUrl = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png';

  constructor(private readonly configService: ConfigService) {
    this.fromEmail = this.configService.get<string>('EMAIL_FROM', 'PayPaddy <onboarding@resend.dev>');
    this.appName = this.configService.get<string>('APP_NAME', 'PayPaddy');
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');

    const transportOptions: SMTPTransport.Options = {
      host: this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: false,
      family: 4, // force IPv4 — fixes ENETUNREACH on Render (IPv6 route missing)
      connectionTimeout: 10000, // fail fast instead of hanging ~120s
      greetingTimeout: 10000,
      socketTimeout: 10000,
      auth: {
        user: this.configService.get<string>('SMTP_USER', ''),
        pass: this.configService.get<string>('SMTP_PASS', ''),
      },
    };

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  private async send(to: string, subject: string, html: string): Promise<boolean> {
    const user = this.configService.get<string>('SMTP_USER', '');
    if (!user) {
      this.logger.warn('No SMTP_USER set — logging email instead');
      this.logger.log(`📧 TO: ${to} | SUBJECT: ${subject}`);
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      this.logger.log(`Email sent to ${to} (messageId: ${info.messageId})`);
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

  // NEW — plain 6-digit code for the "change transaction PIN" flow.
  // No link/button here on purpose: this is a code the user types back
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
