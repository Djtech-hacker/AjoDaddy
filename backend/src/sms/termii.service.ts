// import { Injectable, Logger } from '@nestjs/common';

// @Injectable()
// export class TermiiService {
//   private readonly logger = new Logger(TermiiService.name);
//   private readonly apiKey = process.env.TERMII_API_KEY || '';
//   private readonly senderId = process.env.TERMII_SENDER_ID || 'N-Alert';
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
//           channel: 'generic',
//           api_key: this.apiKey,
//         }),
//       });
//       const data = await res.json().catch(() => null);
//       const ok = res.ok && !!data?.message_id;
//       if (!ok) {
//         this.logger.error(`Termii send failed: ${res.status} ${JSON.stringify(data)}`);
//         return false;
//       }
//       this.logger.log(`OTP sent to ${normalized} (message_id: ${data?.message_id})`);
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


// src/sms/termii.service.ts
// REPLACE the whole file with this. Class name stays TermiiService on purpose
// so auth.module.ts and sms.module.ts need NO changes. It now sends via Arkesel.

// src/sms/termii.service.ts
// REPLACE the whole file with this. Class name stays TermiiService on purpose
// so auth.module.ts and sms.module.ts need NO changes. Sends via Arkesel.
//
// DEV FALLBACK: when NODE_ENV is not "production" and the SMS fails,
// the OTP is printed in the backend terminal instead of failing, so you can
// keep building/testing the register flow. In production it still throws.

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TermiiService {
  private readonly logger = new Logger('SmsService');

  /** 0803xxxxxxx | +234803xxxxxxx | 234803xxxxxxx -> 234803xxxxxxx */
  private normalize(phone: string): string {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('0')) p = '234' + p.slice(1);
    else if (p.length === 10) p = '234' + p;
    return p;
  }

  async sendSms(phone: string, message: string): Promise<void> {
    const sender = (process.env.ARKESEL_SENDER_ID || '').trim();
    const apiKey = (process.env.ARKESEL_API_KEY || '').trim();

    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender,
        message,
        recipients: [this.normalize(phone)],
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') {
      this.logger.error(`Arkesel failed (${res.status}) sender="${sender}": ${JSON.stringify(data)}`);
      throw new Error(`Arkesel SMS failed: ${data.message || res.status}`);
    }
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    try {
      await this.sendSms(
        phone,
        `Your AjoDaddy verification code is ${code}. It expires in 10 minutes. Do not share it with anyone.`,
      );
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`[DEV ONLY] SMS failed. OTP for ${phone} is ${code}`);
        return;
      }
      throw err;
    }
  }
}