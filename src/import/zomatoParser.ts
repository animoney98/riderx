// Parses Zomato's per-trip payout sheet (columns as seen in the sample file).
// Nothing here writes to a database; it returns rows plus a validation report.
import * as XLSX from 'xlsx';
import type { Trip } from '../engine/payout';

export interface ZomatoRow {
  tripId: string;
  /** Row number in the Excel sheet (header is row 1). */
  row: number;
  feId: string;
  /** The identifier as it appeared in the file, before FE ID normalising. */
  rawId: string;
  vendorName: string;
  /** Source 'dt' column as YYYY-MM-DD. */
  sourceDate: string;
  /** delivered_at as local IST text, YYYY-MM-DDTHH:MM:SS. */
  deliveredAt: string;
  ordersInTrip: number;
  isRaining: boolean;
  pickupKm100: number;
  dropKm100: number;
  /** What Zomato pays RiderX for this trip (revenue side, not rider pay). */
  zomatoPayPaise: number;
  /** Zomato 'DC' column. Meaning unconfirmed; stored, not used for rider pay. */
  dcPaise: number;
  /** Tips go straight from Zomato to riders; kept for reference only. */
  tipPaise: number;
  /** Zomato's own distance amount, kept to cross-check our calculation. */
  zomatoDistancePaise: number;
  disputeType: string;
}

export interface ParseIssue { row: number; code: string; message: string }
export interface ParseResult {
  rows: ZomatoRow[]; issues: ParseIssue[]; totalRows: number;
  /** 'raw_id' when bare-number IDs had 10,000 added to make the FE ID; 'fe_id' when every ID already started with FE. */
  format?: 'fe_id' | 'raw_id';
}

/** Raw delivery data carries no payout column, so what Zomato pays RiderX is worked out: 60 base + 5 per km over 6 + rain surge (25, or 35 if batched) + 30 batch fee. */
export function companyPayKm100(totalKm100: number, orders: number, raining: boolean): number {
  const extra = Math.max(0, totalKm100 - 600);
  const distance = Math.floor((2 * extra * 500 + 100) / 200);
  return 6000 + distance + (raining ? (orders === 2 ? 3500 : 2500) : 0) + (orders === 2 ? 3000 : 0);
}

/** TRUE/FALSE, 1/0, yes/no. Anything else (including blank) is null so it can be flagged, never assumed false. */
export function parseRain(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  const t = String(v ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(t)) return true;
  if (['false', '0', 'no', 'n'].includes(t)) return false;
  return null;
}

const REQUIRED_BASE = ['dt', 'trip_id', 'orders', 'delivered_at', 'pickup_distance', 'drop_distance'];

function serialToLocalIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400) * 1000;
  return new Date(ms).toISOString().slice(0, 19);
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Zomato sends the bare number (11568286). Riders are stored as FE11568286, so add the FE. Also accepts "fe 123", "FE-123" and Excel's "123.0". */
export function normalizeFeId(v: unknown): string {
  const t = String(v ?? '').trim().replace(/\s+/g, '');
  const digits = t.match(/^(?:FE-?)?(\d+)(?:\.0+)?$/i);
  return digits ? `FE${digits[1]}` : t;
}

/** delivered_at as IST text. Accepts an Excel date number or text like "2026-10-14 15:56:54.000". */
export function parseDelivered(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return serialToLocalIso(v);
  const t = String(v ?? '').trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}`;
  const n = num(t);
  return n === null ? null : serialToLocalIso(n);
}

export function parseZomatoWorkbook(buf: Buffer | Uint8Array): ParseResult {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true });
  const issues: ParseIssue[] = [];
  if (!raw.length) return { rows: [], issues: [{ row: 0, code: 'EMPTY', message: 'No data rows found' }], totalRows: 0 };
  // Column names are matched ignoring capital letters and stray spaces.
  const keyByNorm = new Map(Object.keys(raw[0]).map((h) => [h.trim().toLowerCase(), h]));
  const has = (name: string) => keyByNorm.has(name.toLowerCase());
  // The identifier column is "FE ID" when present, otherwise "ID".
  // A bare number (11558286) is Zomato's raw ID, so 10,000 is added (FE11568286). A value that already starts with FE is final and is never incremented.
  const idCol = has('FE ID') ? 'FE ID' : 'ID';
  const missing = [...REQUIRED_BASE].filter((r) => !has(r));
  if (!has(idCol)) missing.push('FE ID (or ID)');
  if (missing.length) {
    return { rows: [], issues: [{ row: 0, code: 'MISSING_COLUMNS', message: `Missing columns: ${missing.join(', ')}` }], totalRows: raw.length };
  }
  let added = 0;
  const hasPayout = has('Total Payout');
  const rows: ZomatoRow[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const rowNo = i + 2;
    const g = (k: string) => { const key = keyByNorm.get(k.trim().toLowerCase()); return key === undefined ? undefined : r[key]; };
    const tripId = String(g('trip_id') ?? '').trim();
    const rawId = String(g(idCol) ?? '').trim();
    let feId: string;
    if (/^FE-?\s*\d+$/i.test(rawId)) feId = normalizeFeId(rawId);
    else if (/^\d+(\.0+)?$/.test(rawId)) { feId = `FE${Number(rawId) + 10000}`; added++; }
    else { issues.push({ row: rowNo, code: 'BAD_FE_ID', message: `ID "${rawId}" is not a number, so 10,000 cannot be added` }); return; }
    const delivered = parseDelivered(g('delivered_at'));
    const pickup = num(g('pickup_distance'));
    const drop = num(g('drop_distance'));
    const orders = num(g('orders'));
    const dt = String(g('dt')).trim();
    const bad = (code: string, message: string) => issues.push({ row: rowNo, code, message });
    if (!tripId) return bad('MISSING_TRIP_ID', 'trip_id is empty');
    if (!/^FE\d+$/.test(feId)) return bad('BAD_FE_ID', `Unexpected FE ID "${feId}"`);
    if (delivered === null) return bad('BAD_DELIVERED_AT', 'delivered_at missing or not a date');
    if (pickup === null || drop === null || pickup < 0 || drop < 0) return bad('BAD_DISTANCE', 'pickup/drop distance missing or negative');
    if (orders === null || ![1, 2].includes(orders)) return bad('BAD_ORDERS', `orders must be 1 or 2, got "${g('orders')}"`);
    const rain = has('israining') || has('is raining') ? parseRain(g('israining') ?? g('is raining')) : false;
    if (rain === null) return bad('BAD_RAIN', `isRaining is blank or not TRUE/FALSE (got "${String(g('israining') ?? g('is raining') ?? '')}")`);
    if (seen.has(tripId)) return bad('DUPLICATE_TRIP', `trip_id ${tripId} appears more than once in this file`);
    seen.add(tripId);
    rows.push({
      tripId,
      row: rowNo,
      feId,
      rawId,
      vendorName: String(g('vendor_name') ?? '').trim(),
      sourceDate: /^\d{8}$/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : dt,
      deliveredAt: delivered,
      ordersInTrip: orders,
      isRaining: rain,
      pickupKm100: Math.round(pickup * 100),
      dropKm100: Math.round(drop * 100),
      // 'Total Payout' (when the file has it) already includes Zomato's batch bonus. Otherwise RiderX's own rules decide what Zomato pays: the file's 'pay' column (₹55) is not used.
      zomatoPayPaise: hasPayout && num(g('Total Payout')) !== null ? Math.round(num(g('Total Payout'))! * 100) : companyPayKm100(Math.round(pickup * 100) + Math.round(drop * 100), orders, rain),
      dcPaise: Math.round((num(g('DC')) ?? num(g('final_dc')) ?? 0) * 100),
      tipPaise: Math.round((num(g('tip_amount')) ?? 0) * 100),
      zomatoDistancePaise: Math.round((num(g('Distance Amount')) ?? 0) * 100),
      disputeType: String(g('dispute_type') ?? '').trim(),
    });
  });
  return { rows, issues, totalRows: raw.length, format: added > 0 ? 'raw_id' : 'fe_id' };
}

/**
 * Maps parsed rows to engine trips. The operational day is the IST date of
 * delivered_at, so anything after midnight counts as the next day.
 */
export function toTrips(rows: ZomatoRow[]): Trip[] {
  return rows.map((r) => ({
    tripId: r.tripId,
    riderKey: `zomato:${r.feId}`,
    operationalDate: r.deliveredAt.slice(0, 10),
    completedAt: r.deliveredAt,
    pickupKm100: r.pickupKm100,
    dropKm100: r.dropKm100,
    ordersInTrip: r.ordersInTrip,
    isRaining: r.isRaining,
  }));
}
