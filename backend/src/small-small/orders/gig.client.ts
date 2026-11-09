// backend/src/small-small/orders/gig.client.ts
// ONE place that talks to the delivery companies.
//
// CARRIER_MODE in backend .env:
//   (not set) or "simulated"  -> prices are ESTIMATES and no real rider is booked. Safe for testing.
//   "shipbubble"              -> the real Shipbubble API (one API that carries GIG, DHL, FEZ and others).
//                                Needs SHIPBUBBLE_API_KEY. A key starting sb_sandbox is TEST mode, sb_prod is LIVE.
//
// The app asks for OPTIONS: a list of couriers, each with its own price and arrival time, so the customer can choose.
// Only this file knows which provider is behind them.

import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';

export type GigAddress = {
  name: string; phone: string; email: string; address: string; city: string; state: string
  latitude?: number; longitude?: number // exact spot from the customer's phone, when they shared it
};

// One courier choice the customer can pick
export type CarrierOption = {
  id: string;        // stable id of this choice (used when the customer picks it and when we book it)
  carrier: string;   // e.g. "GIG Logistics"
  service: string;   // e.g. "Standard", "Express"
  feeKobo: bigint;   // the courier's price
  etaText: string;   // e.g. "1 to 2 days"
  simulated: boolean;
  requestToken?: string; // provider data we need again when booking (never shown to users)
};

export type GigBooking = { waybill: string; status: string; simulated: boolean; carrier: string };

export interface GigClient {
  quoteOptions(from: GigAddress, to: GigAddress, declaredValueKobo: bigint, itemName?: string): Promise<CarrierOption[]>;
  book(args: {
    from: GigAddress; to: GigAddress; declaredValueKobo: bigint; itemName: string; reference: string;
    optionId: string; requestToken?: string;
  }): Promise<GigBooking>;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ── Simulated: lets the whole flow be tested before we have real access ──
const SIM_CARRIERS: Record<string, string> = {
  'sim-gig': 'GIG Logistics',
  'sim-fez': 'FEZ Delivery',
  'sim-dhl': 'DHL Express',
};

export class GigSimulatedClient implements GigClient {
  async quoteOptions(from: GigAddress, to: GigAddress): Promise<CarrierOption[]> {
    let base: bigint;
    let eta: [string, string, string];
    if (same(from.state, to.state)) {
      if (same(from.city, to.city)) { base = 250_000n; eta = ['Same day', 'Same day', 'Same day']; }
      else { base = 350_000n; eta = ['1 to 2 days', '2 to 3 days', 'Next day']; }
    } else { base = 750_000n; eta = ['3 to 5 days', '4 to 6 days', '1 to 2 days']; }

    const roundToFiftyNaira = (k: bigint) => k - (k % 5_000n);
    return [
      { id: 'sim-gig', carrier: SIM_CARRIERS['sim-gig'], service: 'Standard', feeKobo: base, etaText: eta[0], simulated: true },
      { id: 'sim-fez', carrier: SIM_CARRIERS['sim-fez'], service: 'Standard', feeKobo: roundToFiftyNaira((base * 90n) / 100n), etaText: eta[1], simulated: true },
      { id: 'sim-dhl', carrier: SIM_CARRIERS['sim-dhl'], service: 'Express', feeKobo: roundToFiftyNaira((base * 160n) / 100n), etaText: eta[2], simulated: true },
    ];
  }

  async book(args: { optionId: string }): Promise<GigBooking> {
    const carrier = SIM_CARRIERS[args.optionId];
    if (!carrier) throw new BadRequestException('That courier choice is not available.');
    const n = Math.floor(10_000_000 + Math.random() * 89_999_999);
    return { waybill: `SIM${n}`, status: 'BOOKED', simulated: true, carrier };
  }
}

// ── Shipbubble: one API that carries GIG, DHL, FEZ and more ──
// Docs: https://docs.shipbubble.com   Base: https://api.shipbubble.com/v1   Auth: "Authorization: Bearer <key>"
// Steps: validate both addresses -> fetch rates -> create shipment.
// The shipment price (the "total" of the chosen rate) is taken from OUR Shipbubble shipping wallet,
// so that wallet must hold enough money. (We collect the delivery cost from the customer's wallet.)
//
// Optional .env settings (sensible defaults are used when missing):
//   SHIPBUBBLE_BASE_URL, SHIPBUBBLE_CATEGORY_ID, SHIPBUBBLE_DEFAULT_WEIGHT_KG (1),
//   SHIPBUBBLE_DEFAULT_LENGTH_CM (25), SHIPBUBBLE_DEFAULT_WIDTH_CM (20), SHIPBUBBLE_DEFAULT_HEIGHT_CM (15)
// Products do not store a weight or size yet, so these defaults are used for every parcel.
export class ShipbubbleClient implements GigClient {
  private readonly logger = new Logger('ShipbubbleClient');
  private readonly addressCache = new Map<string, { code: number; at: number }>();
  private categoryId: number | null = null;

  private get base() { return (process.env.SHIPBUBBLE_BASE_URL || 'https://api.shipbubble.com/v1').replace(/\/+$/, ''); }
  private get key() { return process.env.SHIPBUBBLE_API_KEY || ''; }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    if (!this.key) throw new ServiceUnavailableException('Courier booking is not set up yet. Please try again later.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    let res: any;
    try {
      res = await (globalThis as any).fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e: any) {
      this.logger.warn(`Shipbubble ${method} ${path} failed: ${e?.message}`);
      throw new ServiceUnavailableException('We could not reach the courier service. Please try again.');
    } finally {
      clearTimeout(timer);
    }

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.status === 'failed') {
      const detail = [json?.message, ...(Array.isArray(json?.errors) ? json.errors : [])].filter(Boolean).join(' | ');
      this.logger.warn(`Shipbubble ${method} ${path} -> ${res.status}: ${detail}`);
      if (res.status === 401 || res.status === 403) throw new ServiceUnavailableException('The courier service login failed. Please contact support.');
      if (res.status === 429 || res.status >= 500) throw new ServiceUnavailableException('The courier service is busy. Please try again shortly.');
      throw new BadRequestException(detail || 'The courier service could not process this request.');
    }
    return json;
  }

  // Shipbubble wants phone numbers like +2348012345678
  private phone(p: string) {
    const d = (p || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) return d;
    if (d.startsWith('234')) return '+' + d;
    if (d.startsWith('0')) return '+234' + d.slice(1);
    return '+234' + d;
  }

  private today() {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10); // Lagos date (UTC+1), yyyy-mm-dd
  }

  // Step 1: Shipbubble turns an address into an "address code" it can price. Kept for an hour to save calls.
  private async addressCode(a: GigAddress): Promise<number> {
    const address = `${a.address}, ${a.city}, ${a.state}, Nigeria`;
    const hasGeo = typeof a.latitude === 'number' && typeof a.longitude === 'number';
    const k = `${a.name}|${a.phone}|${a.email}|${address}|${hasGeo ? a.latitude + ',' + a.longitude : ''}`.toLowerCase();
    const hit = this.addressCache.get(k);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.code;
    const r = await this.call('POST', '/shipping/address/validate', {
      name: a.name, email: a.email, phone: this.phone(a.phone), address,
      // when the exact spot is known, Shipbubble uses it instead of the typed address
      ...(hasGeo ? { latitude: a.latitude, longitude: a.longitude } : {}),
    });
    const code = Number(r?.data?.address_code);
    if (!code) throw new BadRequestException('We could not confirm one of the addresses. Please check it and try again.');
    this.addressCache.set(k, { code, at: Date.now() });
    return code;
  }

  private async category(): Promise<number> {
    const fromEnv = Number(process.env.SHIPBUBBLE_CATEGORY_ID);
    if (fromEnv) return fromEnv;
    if (this.categoryId) return this.categoryId;
    const r = await this.call('GET', '/shipping/labels/categories');
    const list: any[] = r?.data || [];
    const pick = list.find(c => /fashion|general|accessor/i.test(String(c.category))) || list[0];
    if (!pick) throw new ServiceUnavailableException('The courier service has no package categories available.');
    this.categoryId = Number(pick.category_id);
    return this.categoryId;
  }

  // Step 2: prices from every courier that will collect from the vendor's door
  async quoteOptions(from: GigAddress, to: GigAddress, declaredValueKobo: bigint, itemName = 'Goods'): Promise<CarrierOption[]> {
    const [sender, receiver, category] = await Promise.all([this.addressCode(from), this.addressCode(to), this.category()]);
    const name = (itemName || 'Goods').slice(0, 80);
    const r = await this.call('POST', '/shipping/fetch_rates', {
      sender_address_code: sender,
      reciever_address_code: receiver, // (sic) this is how Shipbubble spells it
      pickup_date: this.today(),
      category_id: category,
      service_type: 'pickup',
      package_items: [{
        name, description: name,
        unit_weight: String(Number(process.env.SHIPBUBBLE_DEFAULT_WEIGHT_KG) || 1),
        unit_amount: String(Math.round(Number(declaredValueKobo) / 100)),
        quantity: '1',
      }],
      package_dimension: {
        length: Number(process.env.SHIPBUBBLE_DEFAULT_LENGTH_CM) || 25,
        width: Number(process.env.SHIPBUBBLE_DEFAULT_WIDTH_CM) || 20,
        height: Number(process.env.SHIPBUBBLE_DEFAULT_HEIGHT_CM) || 15,
      },
    });
    const token: string | undefined = r?.data?.request_token;
    const couriers: any[] = (r?.data?.couriers || []).filter((c: any) => (c.service_type ?? 'pickup') === 'pickup');
    if (!token || couriers.length === 0) throw new BadRequestException('No courier is available for this route right now.');
    return couriers.map((c: any) => ({
      id: `${c.service_code}:${c.courier_id}`,
      carrier: String(c.courier_name),
      service: 'Door to door',
      feeKobo: BigInt(Math.round(Number(c.total) * 100)), // "total" = what is taken from our shipping wallet
      etaText: String(c.delivery_eta || 'Delivery time not given'),
      simulated: false,
      requestToken: token,
    }));
  }

  // Step 3: book the courier the customer chose (the price is taken from our Shipbubble wallet)
  async book(args: { optionId: string; requestToken?: string }): Promise<GigBooking> {
    const [serviceCode, ...rest] = args.optionId.split(':');
    const courierId = rest.join(':');
    if (!args.requestToken || !serviceCode || !courierId) throw new BadRequestException('That courier choice is not available.');
    const r = await this.call('POST', '/shipping/labels', {
      request_token: args.requestToken, service_code: serviceCode, courier_id: courierId,
    });
    const d = r?.data || {};
    if (!d.order_id) throw new ServiceUnavailableException('The booking did not go through. Please try again.');
    return {
      waybill: String(d.order_id),
      status: String(d.status || 'pending').toUpperCase(),
      simulated: false,
      carrier: String(d.courier?.name || 'Courier'),
    };
  }
}

export function createGigClient(): GigClient {
  return (process.env.CARRIER_MODE || '').toLowerCase() === 'shipbubble' ? new ShipbubbleClient() : new GigSimulatedClient();
}