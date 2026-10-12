import type { SupabaseClient } from '@supabase/supabase-js';
import { cycleFor } from '@/src/engine/calendar';
import type { TripDetail } from '@/src/engine/weekly';
export type { TripDetail };

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Monday of the requested week; defaults to the week of the latest saved trip, else this week. */
export async function resolveWeekStart(sb: SupabaseClient, param?: string): Promise<string> {
  if (isDate(param)) return cycleFor(param!).start;
  const { data } = await sb.from('trips').select('operational_date').order('operational_date', { ascending: false }).limit(1);
  return cycleFor(data?.[0]?.operational_date ?? istToday()).start;
}

export async function loadWeekTrips(sb: SupabaseClient, start: string, end: string): Promise<{ trips: TripDetail[]; withoutEarnings: number }> {
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('trips')
      .select('id, source_trip_id, fe_id, operational_date, delivered_at, orders_in_trip, is_raining, pickup_km100, drop_km100, trip_earnings(first_rank, last_rank, extra_km100, base_paise, distance_paise, batch_bonus_paise, rain_paise, festival_paise, total_paise, superseded_at)')
      .gte('operational_date', start).lte('operational_date', end)
      .order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const trips: TripDetail[] = [];
  let withoutEarnings = 0;
  for (const r of rows) {
    const e = (r.trip_earnings as Record<string, any>[]).find((x) => x.superseded_at === null);
    if (!e) { withoutEarnings++; continue; }
    trips.push({
      feId: r.fe_id, tripId: r.source_trip_id, date: r.operational_date, orders: r.orders_in_trip,
      firstRank: e.first_rank, lastRank: e.last_rank, km100: r.pickup_km100 + r.drop_km100, extraKm100: e.extra_km100,
      basePaise: e.base_paise, distancePaise: e.distance_paise, batchBonusPaise: e.batch_bonus_paise,
      rainPaise: e.rain_paise, festivalPaise: e.festival_paise, totalPaise: e.total_paise,
      deliveredAt: String(r.delivered_at).replace('T', ' ').slice(0, 19), pickupKm100: r.pickup_km100, dropKm100: r.drop_km100, raining: r.is_raining,
    });
  }
  return { trips, withoutEarnings };
}

export async function loadRiderNames(sb: SupabaseClient, feIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!feIds.length) return out;
  const { data } = await sb.from('rider_platform_accounts').select('platform_rider_id, riders(full_name)').eq('platform', 'zomato').in('platform_rider_id', feIds);
  for (const a of data ?? []) out.set(a.platform_rider_id, (a.riders as unknown as { full_name: string } | null)?.full_name ?? '');
  return out;
}

export async function loadRiderInfo(sb: SupabaseClient, feIds: string[]): Promise<Map<string, { name: string; phone: string | null }>> {
  const out = new Map<string, { name: string; phone: string | null }>();
  if (!feIds.length) return out;
  const { data } = await sb.from('rider_platform_accounts').select('platform_rider_id, riders(full_name, phone)').eq('platform', 'zomato').in('platform_rider_id', feIds);
  for (const a of data ?? []) {
    const r = a.riders as unknown as { full_name: string; phone: string | null } | null;
    out.set(a.platform_rider_id, { name: r?.full_name ?? '', phone: r?.phone ?? null });
  }
  return out;
}

export interface BankDetails { holder: string; account: string; ifsc: string; bank: string | null }

/** Bank details by FE ID. Only complete details that RiderX has checked are returned. */
export async function loadBankDetails(sb: SupabaseClient, feIds: string[]): Promise<Map<string, BankDetails>> {
  const out = new Map<string, BankDetails>();
  if (!feIds.length) return out;
  const { data: accts } = await sb.from('rider_platform_accounts').select('platform_rider_id, rider_id').eq('platform', 'zomato').in('platform_rider_id', feIds);
  const riderIds = [...new Set((accts ?? []).map((a) => a.rider_id as string))];
  if (!riderIds.length) return out;
  const { data: det } = await sb.from('rider_payment_details').select('rider_id, bank_account_holder, bank_account_number, bank_ifsc, bank_name, verified_at').in('rider_id', riderIds);
  const byRider = new Map((det ?? []).map((d) => [d.rider_id as string, d]));
  for (const a of accts ?? []) {
    const d = byRider.get(a.rider_id as string);
    if (d?.bank_account_holder && d.bank_account_number && d.bank_ifsc && d.verified_at)
      out.set(a.platform_rider_id, { holder: d.bank_account_holder, account: d.bank_account_number, ifsc: d.bank_ifsc, bank: d.bank_name ?? null });
  }
  return out;
}

export async function loadSetting(sb: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
}
