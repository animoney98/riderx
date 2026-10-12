import type { SupabaseClient } from '@supabase/supabase-js';
import { DATE, INR, KM, type RSheet } from '@/src/export/reportsWorkbook';
import { loadWeekTrips, loadRiderInfo } from '@/lib/week-data';

/** Reads every row of a table, 1000 at a time (the database returns at most 1000 per request). */
export async function fetchAll(sb: SupabaseClient, table: string, orderBy: string, filter?: (q: any) => any): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select('*');
    if (filter) q = filter(q);
    const { data, error } = await q.order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const BACKUP_TABLES: [string, string][] = [
  ['profiles', 'id'], ['riders', 'id'], ['rider_platform_accounts', 'id'], ['rider_payment_details', 'rider_id'],
  ['import_batches', 'id'], ['import_row_errors', 'id'], ['rate_cards', 'id'], ['trips', 'id'], ['trip_earnings', 'id'],
  ['payout_cycles', 'id'], ['rider_payouts', 'id'], ['rider_payments', 'id'], ['adjustments', 'id'],
  ['zomato_receipts', 'id'], ['zomato_daily_targets', 'id'], ['app_settings', 'key'], ['audit_logs', 'id'],
];

const rupees = (p: unknown) => Number(p ?? 0) / 100;

async function riderMaps(sb: SupabaseClient) {
  const riders = await fetchAll(sb, 'riders', 'id');
  const accts = await fetchAll(sb, 'rider_platform_accounts', 'id', (q) => q.eq('platform', 'zomato'));
  const name = new Map(riders.map((r) => [r.id as string, r.full_name as string]));
  const fe = new Map(accts.map((a) => [a.rider_id as string, a.platform_rider_id as string]));
  return { name, fe };
}

export async function payrollHistorySheet(sb: SupabaseClient): Promise<RSheet> {
  const [cycles, payouts, payments, { name, fe }] = await Promise.all([
    fetchAll(sb, 'payout_cycles', 'period_start'), fetchAll(sb, 'rider_payouts', 'id'), fetchAll(sb, 'rider_payments', 'id'), riderMaps(sb),
  ]);
  const cyc = new Map(cycles.map((c) => [c.id as string, c]));
  const paid = new Map<string, number>();
  for (const p of payments) if (p.status === 'confirmed' || p.status === 'reversed') paid.set(p.rider_payout_id, (paid.get(p.rider_payout_id) ?? 0) + Number(p.amount_paise));
  const rows = payouts
    .map((p) => {
      const c = cyc.get(p.payout_cycle_id)!;
      const net = Number(p.net_payable_paise);
      const pd = paid.get(p.id) ?? 0;
      return {
        start: c.period_start, end: c.period_end, payDate: c.scheduled_payment_date, cycle: c.status, fe: fe.get(p.rider_id) ?? '', rider: name.get(p.rider_id) ?? '',
        gross: rupees(p.gross_paise), add: rupees(p.additions_paise), ded: rupees(p.deductions_paise), net: rupees(net), paid: rupees(pd), out: rupees(net - pd),
      };
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.rider.localeCompare(b.rider)));
  return {
    name: 'Payroll history', title: 'RiderX Payroll History', subtitle: 'Every approved week, per rider, from the frozen approved figures. Paid = confirmed payments minus reversals.',
    cols: [
      { header: 'Week start', key: 'start', width: 13 }, { header: 'Week end', key: 'end', width: 13 }, { header: 'Scheduled pay date', key: 'payDate', width: 16 }, { header: 'Week status', key: 'cycle', width: 14 },
      { header: 'FE ID', key: 'fe', width: 14 }, { header: 'Rider', key: 'rider', width: 26 },
      { header: 'Gross earnings', key: 'gross', width: 15, fmt: INR, total: true }, { header: 'Additions', key: 'add', width: 12, fmt: INR, total: true },
      { header: 'Deductions', key: 'ded', width: 12, fmt: INR, total: true }, { header: 'Net payable', key: 'net', width: 15, fmt: INR, total: true },
      { header: 'Paid so far', key: 'paid', width: 15, fmt: INR, total: true }, { header: 'Outstanding', key: 'out', width: 15, fmt: INR, total: true },
    ],
    rows,
  };
}

export async function paymentsSheet(sb: SupabaseClient): Promise<RSheet> {
  const [payments, payouts, cycles, { name, fe }] = await Promise.all([
    fetchAll(sb, 'rider_payments', 'created_at'), fetchAll(sb, 'rider_payouts', 'id'), fetchAll(sb, 'payout_cycles', 'period_start'), riderMaps(sb),
  ]);
  const po = new Map(payouts.map((p) => [p.id as string, p]));
  const cyc = new Map(cycles.map((c) => [c.id as string, c]));
  const rows = payments.map((p) => ({
    date: p.payment_date, fe: fe.get(p.rider_id) ?? '', rider: name.get(p.rider_id) ?? '',
    week: cyc.get(po.get(p.rider_payout_id)?.payout_cycle_id)?.period_start ?? '', amount: rupees(p.amount_paise),
    method: p.payment_method, ref: p.transaction_reference ?? '', status: p.status, notes: p.notes ?? '',
  }));
  return {
    name: 'Payments', title: 'RiderX Payments Ledger', subtitle: 'Every payment recorded, oldest first. A reversal appears as a negative amount.',
    cols: [
      { header: 'Payment date', key: 'date', width: 13 }, { header: 'FE ID', key: 'fe', width: 14 }, { header: 'Rider', key: 'rider', width: 26 }, { header: 'For week starting', key: 'week', width: 15 },
      { header: 'Amount', key: 'amount', width: 14, fmt: INR, total: true }, { header: 'Method', key: 'method', width: 12 }, { header: 'Reference', key: 'ref', width: 24 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Notes', key: 'notes', width: 30 },
    ],
    rows,
  };
}

export async function tripsSheets(sb: SupabaseClient, from: string, to: string): Promise<{ sheets: RSheet[]; withoutEarnings: number; trips: number }> {
  const { trips, withoutEarnings } = await loadWeekTrips(sb, from, to);
  const info = await loadRiderInfo(sb, [...new Set(trips.map((t) => t.feId))]);
  const nm = (fe: string) => info.get(fe)?.name ?? '';
  const sorted = [...trips].sort((a, b) => (a.deliveredAt < b.deliveredAt ? -1 : 1));
  const tripRows = sorted.map((t) => ({
    date: t.date, at: t.deliveredAt, fe: t.feId, rider: nm(t.feId), id: t.tripId, orders: t.orders, rank: t.firstRank === t.lastRank ? String(t.firstRank) : `${t.firstRank}-${t.lastRank}`,
    pickup: t.pickupKm100 / 100, drop: t.dropKm100 / 100, extra: t.extraKm100 / 100,
    base: rupees(t.basePaise), dist: rupees(t.distancePaise), batch: rupees(t.batchBonusPaise), rain: rupees(t.rainPaise), fest: rupees(t.festivalPaise), total: rupees(t.totalPaise),
  }));
  const perDay = new Map<string, { date: string; fe: string; rider: string; trips: number; orders: number; total: number }>();
  for (const t of sorted) {
    const k = `${t.date}|${t.feId}`;
    const d = perDay.get(k) ?? { date: t.date, fe: t.feId, rider: nm(t.feId), trips: 0, orders: 0, total: 0 };
    d.trips += 1; d.orders += t.orders; d.total += rupees(t.totalPaise);
    perDay.set(k, d);
  }
  const dayRows = [...perDay.values()].sort((a, b) => (a.date === b.date ? a.rider.localeCompare(b.rider) : a.date < b.date ? -1 : 1));
  const sub = `Operational days ${from} to ${to}. Pay is the current calculated pay per trip (not yet approved unless the week is approved).`;
  return {
    withoutEarnings, trips: trips.length,
    sheets: [
      {
        name: 'Rider per day', title: 'RiderX Rider Earnings per Day', subtitle: sub,
        cols: [{ header: 'Date', key: 'date', width: 13 }, { header: 'FE ID', key: 'fe', width: 14 }, { header: 'Rider', key: 'rider', width: 26 }, { header: 'Trips', key: 'trips', width: 8, total: true }, { header: 'Orders', key: 'orders', width: 8, total: true }, { header: 'Earnings', key: 'total', width: 14, fmt: INR, total: true }],
        rows: dayRows,
      },
      {
        name: 'Trips', title: 'RiderX Trip Details', subtitle: sub,
        cols: [
          { header: 'Date', key: 'date', width: 13 }, { header: 'Delivered at', key: 'at', width: 19 }, { header: 'FE ID', key: 'fe', width: 14 }, { header: 'Rider', key: 'rider', width: 24 }, { header: 'Trip ID', key: 'id', width: 22 },
          { header: 'Orders', key: 'orders', width: 8, total: true }, { header: 'Order number of day', key: 'rank', width: 12 }, { header: 'Pickup km', key: 'pickup', width: 10, fmt: KM }, { header: 'Drop km', key: 'drop', width: 10, fmt: KM }, { header: 'Extra km paid', key: 'extra', width: 11, fmt: KM, total: true },
          { header: 'Base pay', key: 'base', width: 12, fmt: INR, total: true }, { header: 'Extra-km pay', key: 'dist', width: 12, fmt: INR, total: true }, { header: 'Batch bonus', key: 'batch', width: 12, fmt: INR, total: true },
          { header: 'Rain', key: 'rain', width: 10, fmt: INR, total: true }, { header: 'Festival', key: 'fest', width: 10, fmt: INR, total: true }, { header: 'Total pay', key: 'total', width: 13, fmt: INR, total: true },
        ],
        rows: tripRows,
      },
    ],
  };
}
export { DATE };
