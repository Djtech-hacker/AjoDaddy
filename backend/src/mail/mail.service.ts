// ============================================================
// MAIL SERVICE — Email sending via Mailjet (HTTPS API)
// ============================================================
// Mailjet's API uses HTTP Basic Auth (API key : secret key).
// Free tier: 200 emails/day; only the SENDER address must be verified.
//
// Public methods: sendPasswordReset / sendEmailVerification /
// sendPinChangeOtp / sendTwoFactorOtp / sendBankAccountAlert /
// sendNewChatMessage.
// All return true/false (they never throw).
//
// NEW (this pass): sendNewChatMessage(to, firstName, senderName,
// productName, text, path) — "you have a new message" email for the
// Small Small customer/vendor chat.
//
// Node's "fetch failed" hides the real reason in err.cause. We log it
// (ENOTFOUND = DNS, ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT = blocked or slow
// network, ECONNRESET = connection dropped).
//
// MAIL_DEV_MODE=true (development only, ignored in production): no email is
// sent. The link or code is printed in the backend terminal instead, and the
// call counts as sent.
//
// SETUP (for real sending):
//   MAILJET_API_KEY=...
//   MAILJET_SECRET_KEY=...
//   EMAIL_FROM=your-verified-sender@example.com   (bare address only)
//   APP_NAME=TAREVA                              (optional)
//   FRONTEND_URL=http://localhost:5173             (used to build the links)
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAILJET_API_URL = 'https://api.mailjet.com/v3.1/send';
const SEND_TIMEOUT_MS = 8000;

const IS_PROD = process.env.NODE_ENV === 'production';
// Dev only: print the link/code in the terminal instead of sending. Ignored in production.
const DEV_MODE = process.env.MAIL_DEV_MODE === 'true' && !IS_PROD;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly fromEmail: string;
  private readonly appName: string;
  private readonly frontendUrl: string;
  // e_trim = Cloudinary cuts off the empty transparent space around the logo,
  // so the visible logo sits exactly in the middle of the email.
  private readonly logoUrl = 'https://res.cloudinary.com/dmjakrnby/image/upload/e_trim/v1793386985/Tareva_Green_Leaf_Logo_mrzfsd.png';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('MAILJET_API_KEY', '');
    this.secretKey = this.configService.get<string>('MAILJET_SECRET_KEY', '');
    // NOTE: bare email only (e.g. 'you@gmail.com') — NOT the 'Name <email>' format.
    // The display name is sent separately via `Name` below, using APP_NAME.
    this.fromEmail = this.configService.get<string>('EMAIL_FROM', '');
    this.appName = this.configService.get<string>('APP_NAME', 'TAREVA');
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');

    if (DEV_MODE) {
      this.logger.warn('MAIL_DEV_MODE is ON — emails are printed here and NOTHING is sent. Never use in production.');
    }
  }

  // Makes user-typed text safe to put inside email HTML.
  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Turns Node's vague "fetch failed" into something useful.
  private describeError(err: any): string {
    const parts: string[] = [];
    if (err?.name === 'AbortError') {
      parts.push(`timed out after ${SEND_TIMEOUT_MS / 1000}s (could not reach api.mailjet.com)`);
    } else {
      if (err?.message) parts.push(String(err.message));
      const c = err?.cause;
      if (c) parts.push(`cause: ${[c.code, c.message].filter(Boolean).join(' ') || String(c)}`);
    }
    return parts.join(' | ');
  }

  private hintFor(err: any): string | null {
    const code = err?.cause?.code;
    if (err?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT')
      return 'Hint: the connection to api.mailjet.com is blocked or too slow (firewall, antivirus, VPN or ISP). Test it with: curl.exe -I https://api.mailjet.com';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return 'Hint: DNS could not resolve api.mailjet.com. Check your internet or DNS settings.';
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED')
      return 'Hint: the connection was dropped. A VPN, proxy or antivirus is likely interfering.';
    return null;
  }

  // devNote = the link or code, printed in the terminal when MAIL_DEV_MODE is on.
  private async send(to: string, subject: string, html: string, devNote?: string): Promise<boolean> {
    if (DEV_MODE) {
      this.logger.log(`📧 [DEV] TO: ${to} | SUBJECT: ${subject}${devNote ? ` | ${devNote}` : ''}`);
      return true;
    }

    if (!this.apiKey || !this.secretKey || !this.fromEmail) {
      this.logger.warn('No MAILJET_API_KEY/MAILJET_SECRET_KEY/EMAIL_FROM set — email not sent');
      this.logger.log(`📧 TO: ${to} | SUBJECT: ${subject}`);
      return false;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
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

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(`Mailjet API returned ${response.status}: ${JSON.stringify(data)}`);
      }

      // Even a 200 can carry an "error" status for that specific message (e.g. unverified sender).
      const messageStatus = data?.Messages?.[0]?.Status;
      if (messageStatus && messageStatus !== 'success') {
        throw new Error(`Mailjet message status "${messageStatus}": ${JSON.stringify(data)}`);
      }

      this.logger.log(`Email sent to ${to} (status: ${messageStatus ?? 'unknown'})`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${to}: ${this.describeError(err)}`);
      const hint = this.hintFor(err);
      if (hint) this.logger.warn(hint);
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private emailWrapper(content: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <img src="${this.logoUrl}" alt="${this.appName}" height="130" style="display: block; margin: 0 auto; height: 130px; width: auto;" />
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

    return this.send(to, `Reset your ${this.appName} password`, html, `RESET LINK: ${resetUrl}`);
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

    return this.send(to, `Verify your ${this.appName} email`, html, `VERIFY LINK: ${verifyUrl}`);
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

    return this.send(to, `Your ${this.appName} PIN change code`, html, `PIN CODE: ${code}`);
  }

  // 6-digit code for two-factor authentication.
  // type: '2fa_login' | '2fa_enable' | '2fa_disable'
  async sendTwoFactorOtp(to: string, firstName: string, code: string, type: string): Promise<boolean> {
    const isLogin = type === '2fa_login';
    const minutes = isLogin ? 5 : 10;

    const title =
      type === '2fa_enable'  ? 'Turn on two-factor authentication' :
      type === '2fa_disable' ? 'Turn off two-factor authentication' :
                               'Your login code';

    const intro =
      type === '2fa_enable'  ? 'Use the code below to turn on two-factor authentication for your account.' :
      type === '2fa_disable' ? 'Use the code below to turn off two-factor authentication for your account.' :
                               'Use the code below to finish signing in to your account.';

    const warning = isLogin
      ? `If this wasn't you, someone may know your password. Change it right away.`
      : `If you didn't request this, ignore this email — your security settings won't change without this code.`;

    const html = this.emailWrapper(`
      <h2 style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">${title}</h2>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Hi ${firstName || 'there'},<br><br>
        ${intro} This code expires in ${minutes} minutes.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <span style="display: inline-block; background: #F3F4F6; color: #1a1a1a; font-size: 32px; font-weight: 700;
                     letter-spacing: 8px; padding: 16px 28px; border-radius: 12px;">
          ${code}
        </span>
      </div>

      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        Never share this code with anyone. ${this.appName} will never ask for it.<br><br>
        ${warning}
      </p>
    `);

    return this.send(to, `Your ${this.appName} verification code`, html, `2FA CODE (${type}): ${code}`);
  }

  // Security alert when a bank account is added, removed, or set as default.
  async sendBankAccountAlert(
    to: string,
    firstName: string,
    action: 'added' | 'removed' | 'default',
    bankName: string,
    last4: string,
  ): Promise<boolean> {
    const what =
      action === 'added'   ? `A new bank account (${bankName} ••••${last4}) was added to your ${this.appName} account.` :
      action === 'removed' ? `The bank account ${bankName} ••••${last4} was removed from your ${this.appName} account.` :
                             `${bankName} ••••${last4} was set as your default withdrawal account.`;

    const html = this.emailWrapper(`
      <h2 style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">Bank account update</h2>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Hi ${firstName || 'there'},<br><br>
        ${what}
        ${action === 'added' ? '<br><br>For your security, new accounts can receive withdrawals after a short waiting period.' : ''}
      </p>

      <p style="color: #b91c1c; font-size: 13px; line-height: 1.6; background: #FEF2F2; padding: 12px 14px; border-radius: 8px;">
        Wasn't you? Change your password right away and contact ${this.appName} support.
      </p>
    `);

    return this.send(to, `${this.appName}: bank account ${action === 'default' ? 'default changed' : action}`, html);
  }

  // "You have a new message" email for the Small Small chat (customer <-> vendor).
  //   senderName  = who wrote the message
  //   productName = the product the chat is about
  //   text        = the message (shortened + made HTML-safe here)
  //   path        = the app page that opens the chat, e.g. '/shop/orders/123'
  async sendNewChatMessage(
    to: string,
    firstName: string,
    senderName: string,
    productName: string,
    text: string,
    path: string,
  ): Promise<boolean> {
    const safeSender = this.escapeHtml(senderName || 'Someone');
    const safeProduct = this.escapeHtml(productName || 'a product');
    const raw = String(text ?? '').trim();
    const shortText = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
    const safeText = this.escapeHtml(shortText || '(attachment)').replace(/\n/g, '<br>');

    const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '/';
    const chatUrl = `${this.frontendUrl}${cleanPath}`;

    const html = this.emailWrapper(`
      <h2 style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">New message</h2>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Hi ${this.escapeHtml(firstName) || 'there'},<br><br>
        <strong>${safeSender}</strong> sent you a message about <strong>${safeProduct}</strong>:
      </p>

      <div style="background: #F3F4F6; border-left: 4px solid #1B5C3C; border-radius: 8px; padding: 14px 16px; margin: 20px 0;
                  color: #1a1a1a; font-size: 14px; line-height: 1.6;">
        ${safeText}
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${chatUrl}"
           style="display: inline-block; background: #1B5C3C; color: #fff; font-size: 14px; font-weight: 600;
                  padding: 12px 32px; border-radius: 8px; text-decoration: none;">
          Open chat
        </a>
      </div>

      <p style="color: #999; font-size: 12px; line-height: 1.5;">
        Reply inside ${this.appName} so your conversation stays on the platform and protected.<br><br>
        If the button doesn't work, copy and paste this URL:<br>
        <a href="${chatUrl}" style="color: #1B5C3C; word-break: break-all;">${chatUrl}</a>
      </p>
    `);

    return this.send(
      to,
      `${this.appName}: new message from ${senderName || 'someone'}`,
      html,
      `CHAT LINK: ${chatUrl}`,
    );
  }
}