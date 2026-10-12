// Parses Zomato's per-trip payout sheet (columns as seen in the sample file).
// Nothing here writes to a database; it returns rows plus a validation report.
import * as XLSX from 'xlsx';
import type { Trip } from '../engine/payout.js';

export interface ZomatoRow {
  tripId: string;
  feId: string;
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
export interface ParseResult { rows: ZomatoRow[]; issues: ParseIssue[]; totalRows: number }

const REQUIRED = ['dt', 'trip_id', 'orders', 'pay', 'delivered_at', 'pickup_distance', 'drop_distance', 'FE ID'];

function serialToLocalIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400) * 1000;
  return new Date(ms).toISOString().slice(0, 19);
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function parseZomatoWorkbook(buf: Buffer | Uint8Array): ParseResult {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true });
  const issues: ParseIssue[] = [];
  if (!raw.length) return { rows: [], issues: [{ row: 0, code: 'EMPTY', message: 'No data rows found' }], totalRows: 0 };
  const headers = Object.keys(raw[0]).map((h) => h.trim());
  const missing = REQUIRED.filter((r) => !headers.includes(r));
  if (missing.length) {
    return { rows: [], issues: [{ row: 0, code: 'MISSING_COLUMNS', message: `Missing columns: ${missing.join(', ')}` }], totalRows: raw.length };
  }
  const rows: ZomatoRow[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const rowNo = i + 2;
    const g = (k: string) => r[k] ?? r[k + ' '];
    const tripId = String(g('trip_id')).trim();
    const feId = String(g('FE ID')).trim();
    const delivered = num(g('delivered_at'));
    const pickup = num(g('pickup_distance'));
    const drop = num(g('drop_distance'));
    const orders = num(g('orders'));
    const pay = num(g('pay'));
    const dt = String(g('dt')).trim();
    const bad = (code: string, message: string) => issues.push({ row: rowNo, code, message });
    if (!tripId) return bad('MISSING_TRIP_ID', 'trip_id is empty');
    if (!/^FE\d+$/.test(feId)) return bad('BAD_FE_ID', `Unexpected FE ID "${feId}"`);
    if (delivered === null) return bad('BAD_DELIVERED_AT', 'delivered_at missing or not a date');
    if (pickup === null || drop === null || pickup < 0 || drop < 0) return bad('BAD_DISTANCE', 'pickup/drop distance missing or negative');
    if (orders === null || ![1, 2].includes(orders)) return bad('BAD_ORDERS', `orders must be 1 or 2, got "${g('orders')}"`);
    if (pay === null) return bad('BAD_PAY', 'pay missing');
    if (seen.has(tripId)) return bad('DUPLICATE_TRIP', `trip_id ${tripId} appears more than once in this file`);
    seen.add(tripId);
    rows.push({
      tripId,
      feId,
      vendorName: String(g('vendor_name') ?? '').trim(),
      sourceDate: /^\d{8}$/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : dt,
      deliveredAt: serialToLocalIso(delivered),
      ordersInTrip: orders,
      isRaining: num(g('israining')) === 1,
      pickupKm100: Math.round(pickup * 100),
      dropKm100: Math.round(drop * 100),
      zomatoPayPaise: Math.round(pay * 100),
      dcPaise: Math.round((num(g('DC')) ?? num(g('final_dc')) ?? 0) * 100),
      tipPaise: Math.round((num(g('tip_amount')) ?? 0) * 100),
      zomatoDistancePaise: Math.round((num(g('Distance Amount')) ?? 0) * 100),
      disputeType: String(g('dispute_type') ?? '').trim(),
    });
  });
  return { rows, issues, totalRows: raw.length };
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
