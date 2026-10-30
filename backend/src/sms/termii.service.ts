// import { Injectable, Logger } from '@nestjs/common';

// @Injectable()
// export class TermiiService {
//   private readonly logger = new Logger(TermiiService.name);
//   private readonly apiKey = process.env.TERMII_API_KEY || '';
//   // Approved sender ID. Set TERMII_SENDER_ID in .env to override.
//   private readonly senderId = process.env.TERMII_SENDER_ID || 'OE Alert';
//   // Termii support: OTPs must go out on the "dnd" channel (generic gets blocked on DND numbers).
//   private readonly channel = process.env.TERMII_CHANNEL || 'dnd';
//   private readonly baseUrl = 'https://api.ng.termii.com/api/sms/send';

//   async sendOtp(phone: string, code: string, appName = 'AjoDaddy'): Promise<boolean> {
//     if (!this.apiKey) {
//       this.logger.warn('No TERMII_API_KEY set — logging OTP instead of sending');
//       this.logger.log(`📱 OTP for ${phone}: ${code}`);
//       return false;
//     }

//     const normalized = this.normalizePhone(phone);

//     try {
//       const res = await fetch(this.baseUrl, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           to: normalized,
//           from: this.senderId,
//           sms: `Your ${appName} verification code is ${code}. This code expires in 10 minutes. Do not share with anyone.`,
//           type: 'plain',
//           channel: this.channel,
//           api_key: this.apiKey,
//         }),
//       });
//       const data = await res.json().catch(() => null);
//       const ok = res.ok && !!data?.message_id;
//       if (!ok) {
//         this.logger.error(
//           `Termii send failed (channel=${this.channel}, sender="${this.senderId}"): ${res.status} ${JSON.stringify(data)}`,
//         );
//         return false;
//       }
//       this.logger.log(
//         `OTP sent to ${normalized} via ${this.channel} (message_id: ${data?.message_id}${data?.balance !== undefined ? `, balance: ${data.balance}` : ''})`,
//       );
//       return true;
//     } catch (err: any) {
//       this.logger.error(`Termii request failed: ${err.message}`);
//       return false;
//     }
//   }

//   // Normalizes Nigerian numbers (0803..., +234803..., 234803...) to the
//   // 234-prefixed format Termii expects.
//   private normalizePhone(phone: string): string {
//     let p = phone.replace(/\s|-/g, '');
//     if (p.startsWith('+')) p = p.slice(1);
//     if (p.startsWith('0')) p = '234' + p.slice(1);
//     if (!p.startsWith('234')) p = '234' + p;
//     return p;
//   }
// }


import { Injectable, Logger } from '@nestjs/common';

const IS_PROD = process.env.NODE_ENV === 'production';
// Dev only: print the OTP in the terminal instead of sending an SMS. Ignored in production.
const DEV_MODE = process.env.SMS_DEV_MODE === 'true' && !IS_PROD;

@Injectable()
export class TermiiService {
  private readonly logger = new Logger(TermiiService.name);
  private readonly apiKey = process.env.TERMII_API_KEY || '';
  // Approved sender ID. Set TERMII_SENDER_ID in .env to override.
  private readonly senderId = process.env.TERMII_SENDER_ID || 'OE Alert';
  // Termii support: OTPs must go out on the "dnd" channel (generic gets blocked on DND numbers).
  private readonly channel = process.env.TERMII_CHANNEL || 'dnd';
  private readonly baseUrl = 'https://api.ng.termii.com/api/sms/send';

  constructor() {
    if (DEV_MODE) {
      this.logger.warn('SMS_DEV_MODE is ON — OTPs are printed here and NO SMS is sent. Never use in production.');
    }
  }

  async sendOtp(phone: string, code: string, appName = 'AjoDaddy'): Promise<boolean> {
    // Dev mode: show the code in the terminal and carry on as if it was delivered.
    if (DEV_MODE) {
      this.logger.log(`📱 [DEV] OTP for ${phone}: ${code}`);
      return true;
    }

    if (!this.apiKey) {
      this.logger.warn('No TERMII_API_KEY set — SMS not sent');
      // Never print codes in production logs.
      if (!IS_PROD) this.logger.log(`📱 OTP for ${phone}: ${code}`);
      return false;
    }

    const normalized = this.normalizePhone(phone);

    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: normalized,
          from: this.senderId,
          sms: `Your ${appName} verification code is ${code}. This code expires in 10 minutes. Do not share with anyone.`,
          type: 'plain',
          channel: this.channel,
          api_key: this.apiKey,
        }),
      });
      const data = await res.json().catch(() => null);
      const ok = res.ok && !!data?.message_id;
      if (!ok) {
        this.logger.error(
          `Termii send failed (channel=${this.channel}, sender="${this.senderId}"): ${res.status} ${JSON.stringify(data)}`,
        );
        return false;
      }
      this.logger.log(
        `OTP sent to ${normalized} via ${this.channel} (message_id: ${data?.message_id}${data?.balance !== undefined ? `, balance: ${data.balance}` : ''})`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(`Termii request failed: ${err.message}`);
      return false;
    }
  }

  // Normalizes Nigerian numbers (0803..., +234803..., 234803...) to the
  // 234-prefixed format Termii expects.
  private normalizePhone(phone: string): string {
    let p = phone.replace(/\s|-/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    if (p.startsWith('0')) p = '234' + p.slice(1);
    if (!p.startsWith('234')) p = '234' + p;
    return p;
  }
}