import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateTrips, type RateCard, type Trip } from '@/src/engine/payout';

/**
 * Recalculates earnings for every trip of the given riders in a date range, using ALL stored trips
 * (so the daily 25-order slab is right even when a day arrives across several files).
 * Changed results supersede the old row; nothing is overwritten or deleted.
 */
export async function recalculateEarnings(sb: SupabaseClient, feIds: string[], minDate: string, maxDate: string, card: RateCard, cardId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('trips')
      .select('id, source_trip_id, fe_id, operational_date, delivered_at, orders_in_trip, is_raining, pickup_km100, drop_km100')
      .in('fe_id', feIds).gte('operational_date', minDate).lte('operational_date', maxDate)
      .order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const idByTrip = new Map(rows.map((r) => [r.source_trip_id as string, r.id as string]));
  const trips: Trip[] = rows.map((r) => ({
    tripId: r.source_trip_id as string,
    riderKey: `zomato:${r.fe_id}`,
    operationalDate: r.operational_date as string,
    completedAt: String(r.delivered_at).replace(' ', 'T'),
    pickupKm100: r.pickup_km100 as number,
    dropKm100: r.drop_km100 as number,
    ordersInTrip: r.orders_in_trip as number,
    isRaining: r.is_raining as boolean,
  }));
  const calc = calculateTrips(trips, card);

  const current = new Map<string, Record<string, number | string>>();
  const ids = [...idByTrip.values()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('trip_earnings').select('id, trip_id, rate_card_id, first_rank, total_paise, base_paise, distance_paise, batch_bonus_paise, rain_paise, festival_paise')
      .in('trip_id', ids.slice(i, i + 200)).is('superseded_at', null);
    for (const c of data ?? []) current.set(c.trip_id as string, c);
  }

  const toInsert: Record<string, unknown>[] = [];
  const toSupersede: string[] = [];
  for (const e of calc) {
    const tripDbId = idByTrip.get(e.tripId)!;
    const old = current.get(tripDbId);
    const same = old && old.rate_card_id === cardId && old.first_rank === e.firstRank && old.total_paise === e.totalPaise &&
      old.base_paise === e.basePaise && old.distance_paise === e.distancePaise && old.batch_bonus_paise === e.batchBonusPaise &&
      old.rain_paise === e.rainPaise && old.festival_paise === e.festivalPaise;
    if (same) continue;
    if (old) toSupersede.push(old.id as string);
    toInsert.push({
      trip_id: tripDbId, rate_card_id: cardId, first_rank: e.firstRank, last_rank: e.lastRank, base_paise: e.basePaise,
      extra_km100: e.extraKm100, distance_paise: e.distancePaise, batch_bonus_paise: e.batchBonusPaise,
      rain_paise: e.rainPaise, festival_paise: e.festivalPaise, total_paise: e.totalPaise,
    });
  }
  for (let i = 0; i < toSupersede.length; i += 200) {
    const { error } = await sb.from('trip_earnings').update({ superseded_at: new Date().toISOString() }).in('id', toSupersede.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < toInsert.length; i += 200) {
    const { error } = await sb.from('trip_earnings').insert(toInsert.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return { trips: trips.length, written: toInsert.length, superseded: toSupersede.length };
}

/**
 * Recalculates stored trips from a date (up to an optional end date), day by day, each day with the rate card in force on that day.
 * Used after rates change. Old earnings rows are superseded, never deleted.
 */
export async function recalculateFrom(sb: SupabaseClient, fromDate: string, toDate: string | null, loadCard: (date: string) => Promise<{ id: string | null; card: RateCard }>) {
  const days = new Map<string, Set<string>>();
  for (let from = 0; ; from += 1000) {
    let q = sb.from('trips').select('id, fe_id, operational_date').gte('operational_date', fromDate);
    if (toDate) q = q.lte('operational_date', toDate);
    const { data, error } = await q.order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) (days.get(r.operational_date as string) ?? days.set(r.operational_date as string, new Set()).get(r.operational_date as string)!).add(r.fe_id as string);
    if (!data || data.length < 1000) break;
  }
  let written = 0;
  for (const [d, fes] of [...days].sort()) {
    const { id, card } = await loadCard(d);
    if (!id) throw new Error(`No active rate card for ${d}`);
    const r = await recalculateEarnings(sb, [...fes], d, d, card, id);
    written += r.written;
  }
  return { days: days.size, written };
}
