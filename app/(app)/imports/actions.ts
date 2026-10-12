'use server';
import { supabaseServer } from '@/lib/supabase-server';
import { parseZomatoWorkbook, toTrips } from '@/src/import/zomatoParser';
import { createHash } from 'node:crypto';
import { calculateTrips, dailyTotals, formatINR } from '@/src/engine/payout';
import { loadRateCard } from '@/lib/rate-card';
import { recalculateEarnings } from '@/lib/earnings';
import { cycleFor } from '@/src/engine/calendar';

export interface Preview {
  ok: boolean;
  fatal?: string;
  checksum?: string;
  canImport?: boolean;
  committed?: { inserted: number; identical: number; conflicts: number; earningsWritten: number };
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

// intent=preview checks the file and writes nothing. intent=commit re-checks it and saves.
export async function importAction(_prev: Preview | null, formData: FormData): Promise<Preview> {
  const intent = String(formData.get('intent') ?? 'preview');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, fatal: 'Choose an Excel (.xlsx) file first.' };
  if (!/\.xlsx?$/i.test(file.name)) return { ok: false, fatal: 'Only .xlsx or .xls files are supported.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, fatal: 'File is larger than 10 MB.' };

  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');
  let parsed;
  try {
    parsed = parseZomatoWorkbook(bytes);
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
  // Each operational day is priced with the rate card in force on that day (a one-day special card wins over the standard rates).
  const dayList = [...new Set(trips.map((t) => t.operationalDate))].sort();
  const cards = new Map(await Promise.all(dayList.map(async (d) => [d, await loadRateCard(sb, d)] as const)));
  const earnings = dayList.flatMap((d) => calculateTrips(trips.filter((t) => t.operationalDate === d), cards.get(d)!.card));
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

  const allMatched = feIds.every((fe) => nameByFe.has(fe));

  if (intent === 'commit') {
    if (String(formData.get('checksum') ?? '') !== checksum) return { ok: false, fatal: 'The file is different from the one you checked. Click "Check file" again before importing.' };
    if (!allMatched) return { ok: false, fatal: 'Some FE IDs are not registered as riders. Add them on the Riders page first.' };
    const sortedDates = trips.map((t) => t.operationalDate).sort();
    const { data: res, error } = await sb.rpc('commit_zomato_import', {
      p_filename: file.name,
      p_checksum: checksum,
      p_period_start: sortedDates[0],
      p_period_end: sortedDates[sortedDates.length - 1],
      p_trips: parsed.rows.map((r) => ({
        trip_id: r.tripId, fe_id: r.feId, operational_date: r.deliveredAt.slice(0, 10), delivered_at: r.deliveredAt,
        orders: r.ordersInTrip, raining: r.isRaining, pickup_km100: r.pickupKm100, drop_km100: r.dropKm100,
        zomato_pay_paise: r.zomatoPayPaise, dc_paise: r.dcPaise, tip_paise: r.tipPaise, zomato_distance_paise: r.zomatoDistancePaise,
      })),
      p_errors: parsed.issues,
    });
    if (error) return { ok: false, fatal: `Import failed and nothing was saved: ${error.message}` };
    if ([...cards.values()].some((c) => !c.id)) return { ok: false, fatal: 'Trips were saved, but no active rate card exists, so earnings were not calculated. Run migration 0002 and import again.' };
    let written = 0;
    try {
      for (const d of dayList) {
        const c = cards.get(d)!;
        const r = await recalculateEarnings(sb, feIds, d, d, c.card, c.id!);
        written += r.written;
      }
    } catch (e) {
      return { ok: false, fatal: `Trips were saved, but earnings could not be calculated: ${(e as Error).message}. Importing the same file again will retry safely.` };
    }
    return { ok: true, filename: file.name, committed: { inserted: res.inserted, identical: res.identical, conflicts: res.conflicts.length, earningsWritten: written } };
  }

  const dates = trips.map((t) => t.operationalDate).sort();
  const cycleMap = new Map(dates.map((d) => [cycleFor(d).start, cycleFor(d)]));
  const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);

  return {
    ok: true,
    checksum,
    canImport: allMatched,
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
