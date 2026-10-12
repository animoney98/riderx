'use server';
import { supabaseServer } from '@/lib/supabase-server';
import { parseZomatoWorkbook, toTrips } from '@/src/import/zomatoParser';
import { calculateTrips, dailyTotals, DEFAULT_RATE_CARD, formatINR } from '@/src/engine/payout';
import { cycleFor } from '@/src/engine/calendar';

export interface Preview {
  ok: boolean;
  fatal?: string;
  filename?: string;
  totalRows?: number;
  validRows?: number;
  issues?: { row: number; code: string; message: string }[];
  batched?: number;
  dateRange?: string;
  cycles?: { start: string; end: string; payDate: string }[];
  alreadyImported?: number;
  riders?: { feId: string; matched: boolean; name: string; orders: number; extraKm: string; base: string; distance: string; batch: string; rain: string; total: string; zomatoPay: string }[];
  totals?: { riderPay: string; zomatoPay: string; tipsIgnored: string };
}

const fmtKm = (km100: number) => (km100 / 100).toFixed(2);

// Preview only. Nothing is written to the database in this step.
export async function previewImport(_prev: Preview | null, formData: FormData): Promise<Preview> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, fatal: 'Choose an Excel (.xlsx) file first.' };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, fatal: 'Only .xlsx or .xls files are supported.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, fatal: 'File is larger than 10 MB.' };

  let parsed;
  try {
    parsed = parseZomatoWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { ok: false, fatal: 'This file could not be read as an Excel workbook.' };
  }
  if (!parsed.rows.length) {
    return { ok: false, filename: file.name, totalRows: parsed.totalRows, issues: parsed.issues, fatal: parsed.issues[0]?.message ?? 'No usable rows.' };
  }

  const sb = await supabaseServer();
  const feIds = [...new Set(parsed.rows.map((r) => r.feId))];
  const { data: accounts } = await sb
    .from('rider_platform_accounts')
    .select('platform_rider_id, riders(full_name)')
    .eq('platform', 'zomato')
    .in('platform_rider_id', feIds);
  const nameByFe = new Map((accounts ?? []).map((a) => [a.platform_rider_id, (a.riders as unknown as { full_name: string } | null)?.full_name ?? '']));

  const tripIds = parsed.rows.map((r) => r.tripId);
  let alreadyImported = 0;
  for (let i = 0; i < tripIds.length; i += 200) {
    const { count } = await sb.from('trips').select('id', { count: 'exact', head: true }).eq('platform', 'zomato').in('source_trip_id', tripIds.slice(i, i + 200));
    alreadyImported += count ?? 0;
  }

  const trips = toTrips(parsed.rows);
  const earnings = calculateTrips(trips, DEFAULT_RATE_CARD);
  const zomatoByFe = new Map<string, number>();
  for (const r of parsed.rows) zomatoByFe.set(r.feId, (zomatoByFe.get(r.feId) ?? 0) + r.zomatoPayPaise);

  const days = dailyTotals(earnings);
  const perRider = new Map<string, { orders: number; extra: number; base: number; dist: number; batch: number; rain: number; total: number }>();
  for (const d of days) {
    const fe = d.riderKey.replace('zomato:', '');
    const p = perRider.get(fe) ?? { orders: 0, extra: 0, base: 0, dist: 0, batch: 0, rain: 0, total: 0 };
    p.orders += d.orders; p.extra += d.extraKm100; p.base += d.basePaise; p.dist += d.distancePaise;
    p.batch += d.batchBonusPaise; p.rain += d.rainPaise; p.total += d.totalPaise;
    perRider.set(fe, p);
  }

  const dates = trips.map((t) => t.operationalDate).sort();
  const cycleMap = new Map(dates.map((d) => [cycleFor(d).start, cycleFor(d)]));
  const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);

  return {
    ok: true,
    filename: file.name,
    totalRows: parsed.totalRows,
    validRows: parsed.rows.length,
    issues: parsed.issues,
    batched: parsed.rows.filter((r) => r.ordersInTrip === 2).length,
    dateRange: `${dates[0]} to ${dates[dates.length - 1]}`,
    cycles: [...cycleMap.values()],
    alreadyImported,
    riders: [...perRider].map(([fe, p]) => ({
      feId: fe,
      matched: nameByFe.has(fe),
      name: nameByFe.get(fe) ?? '',
      orders: p.orders,
      extraKm: fmtKm(p.extra),
      base: formatINR(p.base),
      distance: formatINR(p.dist),
      batch: formatINR(p.batch),
      rain: formatINR(p.rain),
      total: formatINR(p.total),
      zomatoPay: formatINR(zomatoByFe.get(fe) ?? 0),
    })),
    totals: {
      riderPay: formatINR(sum([...perRider.values()].map((p) => p.total))),
      zomatoPay: formatINR(sum(zomatoByFe.values())),
      tipsIgnored: formatINR(sum(parsed.rows.map((r) => r.tipPaise))),
    },
  };
}
