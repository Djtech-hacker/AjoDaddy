// backend/src/small-small/orders/gig.client.ts
// ONE place that talks to the delivery companies.
//
// CARRIER_MODE in backend .env:
//   (not set) or "simulated"  -> prices are ESTIMATES and no real rider is booked. Safe for testing.
//   "terminal"                -> Terminal Africa (T-Ship API): one API that carries GIG, DHL, FEZ, Kwik and others.
//                                Needs TERMINAL_SECRET_KEY. A key starting sk_test uses the SANDBOX, sk_live uses LIVE.
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

// ── Terminal Africa: one API that carries GIG, DHL, FEZ, Kwik and more ──
// Docs: https://docs.terminal.africa/tship   Auth: "Authorization: Bearer <secret key>"
// Base: https://sandbox.terminal.africa/v1 (test keys, sk_test...)  or  https://api.terminal.africa/v1 (live keys, sk_live...)
//
// How a quote and a booking work:
//   QUOTE  1) POST /shipments/quick   makes a DRAFT shipment from the two addresses and the parcel in ONE call
//          2) GET  /rates/shipment    returns the courier prices for that draft shipment
//   BOOK   3) POST /shipments/pickup  books the chosen rate (pickup_option "pickup" = the carrier collects from the vendor's door)
//
// The delivery price is taken from OUR Terminal wallet, so that wallet must hold enough money.
// (We collect the delivery cost from the customer's wallet.)
//
// Optional .env settings (sensible defaults are used when missing):
//   TERMINAL_BASE_URL            overrides the base URL (normally not needed)
//   TERMINAL_DEFAULT_WEIGHT_KG   weight of every parcel, default 1 (products do not store a weight yet)
//   TERMINAL_DEFAULT_ZIP         postal code used for every address, default 100001 (the app does not collect one yet)
//
// Notes:
//   - "amount" in Terminal rates is in NAIRA. The app works in KOBO, so it is converted here.
//   - Option ids stay the same between quotes (they use the carrier, not the one-off rate id),
//     so a customer's saved choice can still be found when the vendor books later.
class TerminalHttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export class TerminalClient implements GigClient {
  private readonly logger = new Logger('TerminalClient');

  private get key() { return process.env.TERMINAL_SECRET_KEY || ''; }
  private get base() {
    const custom = process.env.TERMINAL_BASE_URL;
    if (custom) return custom.replace(/\/+$/, '');
    return this.key.startsWith('sk_live') ? 'https://api.terminal.africa/v1' : 'https://sandbox.terminal.africa/v1';
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string>): Promise<any> {
    if (!this.key) throw new ServiceUnavailableException('Courier booking is not set up yet. Please try again later.');
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    let res: any;
    try {
      res = await (globalThis as any).fetch(`${this.base}${path}${qs}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e: any) {
      this.logger.warn(`Terminal ${method} ${path} failed: ${e?.message}`);
      throw new ServiceUnavailableException('We could not reach the courier service. Please try again.');
    } finally {
      clearTimeout(timer);
    }

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.status === false) {
      const detail = [json?.message, ...(Array.isArray(json?.errors) ? json.errors : [])].filter(Boolean).join(' | ');
      this.logger.warn(`Terminal ${method} ${path} -> ${res.status}: ${detail}`);
      if (res.status === 401 || res.status === 403) throw new ServiceUnavailableException('The courier service login failed. Please contact support.');
      if (res.status === 429 || res.status >= 500) throw new ServiceUnavailableException('The courier service is busy. Please try again shortly.');
      // a low Terminal wallet is OUR problem, never show it to the customer
      if (/insufficient|wallet|balance/i.test(detail)) throw new ServiceUnavailableException('Delivery booking is temporarily unavailable. Please try again later.');
      // the app swaps any error containing the words "pickup address" for a friendly message, which hides the real reason.
      // Say "pickup location" instead so Terminal's real message reaches the screen.
      throw new TerminalHttpError(res.status, (detail || 'The courier service could not process this request.').replace(/pickup address/gi, 'pickup location'));
    }
    return json;
  }

  // Terminal wants international numbers like +2348012345678
  private phone(p: string) {
    const d = (p || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) return d;
    if (d.startsWith('234')) return '+' + d;
    if (d.startsWith('0')) return '+234' + d.slice(1);
    return '+234' + d;
  }

  // Terminal allows at most 45 characters per address line, so a long address is split:
  // the first line is cut at a space or comma, and the rest goes to line 2 (also 45 characters at most).
  private lines(address: string): { line1: string; line2?: string } {
    const MAX = 45;
    const text = (address || '').replace(/\s+/g, ' ').trim();
    if (text.length <= MAX) return { line1: text };
    let cut = Math.max(text.lastIndexOf(' ', MAX), text.lastIndexOf(',', MAX - 1) + 1);
    if (cut < 20) cut = MAX; // no good break point found: cut hard
    const line1 = text.slice(0, cut).replace(/[\s,]+$/, '');
    const rest = text.slice(cut).replace(/^[\s,]+/, '').slice(0, MAX).replace(/[\s,]+$/, '');
    return rest ? { line1, line2: rest } : { line1 };
  }

  private address(a: GigAddress) {
    const parts = (a.name || '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0] || 'Customer';
    const last = parts.length > 1 ? parts.slice(1).join(' ') : first;
    return {
      first_name: first,
      last_name: last,
      email: a.email,
      phone: this.phone(a.phone),
      ...this.lines(a.address),
      city: a.city.trim(),
      state: a.state.trim(),
      country: 'NG',
      zip: process.env.TERMINAL_DEFAULT_ZIP || '100001',
    };
  }

  private parcel(declaredValueKobo: bigint, itemName: string) {
    const name = (itemName || 'Goods').slice(0, 80);
    return {
      description: name,
      weight_unit: 'kg',
      items: [{
        name, description: name, type: 'parcel', currency: 'NGN',
        value: Math.max(1, Math.round(Number(declaredValueKobo) / 100)), // Terminal wants naira
        quantity: 1,
        weight: Number(process.env.TERMINAL_DEFAULT_WEIGHT_KG) || 1,
      }],
    };
  }

  // The same courier gets the same id every time, even though Terminal makes a new rate id for every quote
  private optionId(rate: any) {
    const carrier = String(rate.carrier_reference || rate.carrier_id || rate.carrier_slug || rate.carrier_name);
    const service = String(rate.carrier_rate_description || 'standard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'standard';
    return `${carrier}:${service}`;
  }

  // Steps 1 and 2: draft shipment, then prices from every courier that will collect from the vendor's door
  async quoteOptions(from: GigAddress, to: GigAddress, declaredValueKobo: bigint, itemName = 'Goods'): Promise<CarrierOption[]> {
    const route = `${from.city}, ${from.state} -> ${to.city}, ${to.state}`;
    const draft = await this.call('POST', '/shipments/quick', {
      pickup_address: this.address(from),
      delivery_address: this.address(to),
      parcel: this.parcel(declaredValueKobo, itemName),
      shipment_purpose: 'commercial',
      metadata: { source: 'tareva' },
    }).catch(e => { this.logger.warn(`Terminal quote failed for ${route}: ${e?.message}`); throw this.asNest(e); });
    const shipmentId: string | undefined = draft?.data?.shipment_id;
    if (!shipmentId) throw new ServiceUnavailableException('The courier service did not accept this delivery. Please try again.');

    const r = await this.call('GET', '/rates/shipment', undefined, { shipment_id: shipmentId, currency: 'NGN' })
      .catch(e => { this.logger.warn(`Terminal quote failed for ${route}: ${e?.message}`); throw this.asNest(e); });
    const rates: any[] = Array.isArray(r?.data) ? r.data : [];

    const best = new Map<string, CarrierOption>();
    for (const rate of rates) {
      const amount = Number(rate.amount);
      if (!rate.rate_id || !Number.isFinite(amount) || amount <= 0) continue; // no price = cannot sell it
      if (rate.dropoff_required === true) continue;                           // the vendor would have to carry it to a hub

      // we want the carrier to collect from the vendor's door ("pickup")
      const options: any[] | undefined = Array.isArray(rate.pickup_options) ? rate.pickup_options : undefined;
      const canPickup = !options || options.some(o => o?.type === 'pickup');
      if (!canPickup) continue;

      const carrier = String(rate.carrier_name || 'Courier').replace(/\|/g, '/');
      const opt: CarrierOption = {
        id: this.optionId(rate),
        carrier,
        service: String(rate.carrier_rate_description || 'Door to door'),
        feeKobo: BigInt(Math.round(amount * 100)),
        etaText: String(rate.delivery_time || 'Delivery time not given'),
        simulated: false,
        // shipment id | rate id | carrier name | does this rate list the "pickup" option (1/0)
        requestToken: `${shipmentId}|${rate.rate_id}|${carrier}|${options ? '1' : '0'}`,
      };
      const prev = best.get(opt.id);
      if (!prev || opt.feeKobo < prev.feeKobo) best.set(opt.id, opt);
    }

    const list = [...best.values()].sort((a, b) => (a.feeKobo < b.feeKobo ? -1 : a.feeKobo > b.feeKobo ? 1 : 0));
    if (list.length === 0) throw new BadRequestException('No courier is available for this route right now.');
    return list;
  }

  // Step 3: book the courier the customer chose (the price is taken from our Terminal wallet)
  async book(args: {
    from: GigAddress; to: GigAddress; declaredValueKobo: bigint; itemName: string; reference: string;
    optionId: string; requestToken?: string;
  }): Promise<GigBooking> {
    // 1) try the quote we already have. Rates can go stale, so if Terminal refuses it, quote again once.
    const parts = (args.requestToken || '').split('|');
    if (parts.length === 4) {
      try {
        return await this.arrange(parts[0], parts[1], parts[2], parts[3] === '1', args.reference);
      } catch (e: any) {
        if (!(e instanceof TerminalHttpError)) throw this.asNest(e); // timeouts etc: do NOT retry, it may have booked
        this.logger.warn(`Terminal rate ${parts[1]} was refused (${e.message}); quoting again`);
      }
    }

    // 2) fresh quote, find the same courier choice, book it
    const options = await this.quoteOptions(args.from, args.to, args.declaredValueKobo, args.itemName);
    const pick = options.find(o => o.id === args.optionId);
    if (!pick || !pick.requestToken) throw new BadRequestException('That courier choice is no longer available. Please choose again.');
    const p = pick.requestToken.split('|');
    try {
      return await this.arrange(p[0], p[1], p[2], p[3] === '1', args.reference);
    } catch (e: any) {
      throw this.asNest(e);
    }
  }

  private async arrange(shipmentId: string, rateId: string, carrier: string, hasPickupOption: boolean, reference: string): Promise<GigBooking> {
    const r = await this.call('POST', '/shipments/pickup', {
      rate_id: rateId,
      shipment_id: shipmentId,
      ...(hasPickupOption ? { pickup_option: 'pickup' } : {}),
    });
    const d = r?.data || {};
    if (d?.metadata?.priority_pickup_error) this.logger.warn(`Terminal ${shipmentId}: ${d.metadata.priority_pickup_error}`);
    const id = d.shipment_id || shipmentId;
    this.logger.log(`Terminal booked ${id} for ${reference}`);
    return {
      waybill: String(id), // the Terminal shipment id: it is what tracking and webhooks use
      status: String(d.status || 'confirmed').toUpperCase(),
      simulated: false,
      carrier,
    };
  }

  // Terminal "your request was wrong" errors become a normal 400 for the app
  private asNest(e: any) {
    return e instanceof TerminalHttpError ? new BadRequestException(e.message) : e;
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
  const mode = (process.env.CARRIER_MODE || '').toLowerCase();
  if (mode === 'terminal') return new TerminalClient();
  if (mode === 'shipbubble') return new ShipbubbleClient();
  return new GigSimulatedClient();
}