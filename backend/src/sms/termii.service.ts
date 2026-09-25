import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TermiiService {
  private readonly logger = new Logger(TermiiService.name);
  private readonly apiKey = process.env.TERMII_API_KEY || '';
  private readonly senderId = process.env.TERMII_SENDER_ID || 'N-Alert';
  private readonly baseUrl = 'https://api.ng.termii.com/api/sms/send';

  async sendOtp(phone: string, code: string, appName = 'AjoDaddy'): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn('No TERMII_API_KEY set — logging OTP instead of sending');
      this.logger.log(`📱 OTP for ${phone}: ${code}`);
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
          channel: 'generic',
          api_key: this.apiKey,
        }),
      });
      const data = await res.json().catch(() => null);
      const ok = res.ok && !!data?.message_id;
      if (!ok) {
        this.logger.error(`Termii send failed: ${res.status} ${JSON.stringify(data)}`);
        return false;
      }
      this.logger.log(`OTP sent to ${normalized} (message_id: ${data?.message_id})`);
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