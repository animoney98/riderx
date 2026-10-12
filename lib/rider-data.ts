import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from '@/src/engine/calendar';

export interface RiderTrip {
  tripId: string; date: string; deliveredAt: string; orders: number; raining: boolean; pickupKm100: number; dropKm100: number;
  basePaise: number; extraKm100: number; distancePaise: number; batchBonusPaise: number; rainPaise: number; festivalPaise: number; totalPaise: number; isFinal: boolean;
}
export interface RiderDay {
  date: string; orders: number; trips: number; batchedTrips: number; extraKm100: number;
  basePaise: number; distancePaise: number; batchBonusPaise: number; rainPaise: number; festivalPaise: number; totalPaise: number; isFinal: boolean;
}
export interface RiderWeek { periodStart: string; payDate: string; netPaise: number; paidPaise: number }
export interface RiderPayment { date: string; amountPaise: number; method: string; reference: string | null }

/** Groups a rider's own trips into days. A day is Final only when every trip in it belongs to an approved week. */
export function groupDays(trips: RiderTrip[]): RiderDay[] {
  const m = new Map<string, RiderDay>();
  for (const t of trips) {
    const d = m.get(t.date) ?? { date: t.date, orders: 0, trips: 0, batchedTrips: 0, extraKm100: 0, basePaise: 0, distancePaise: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, totalPaise: 0, isFinal: true };
    d.orders += t.orders; d.trips += 1; d.batchedTrips += t.orders > 1 ? 1 : 0; d.extraKm100 += t.extraKm100;
    d.basePaise += t.basePaise; d.distancePaise += t.distancePaise; d.batchBonusPaise += t.batchBonusPaise; d.rainPaise += t.rainPaise; d.festivalPaise += t.festivalPaise; d.totalPaise += t.totalPaise;
    d.isFinal = d.isFinal && t.isFinal;
    m.set(t.date, d);
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadRiderView(sb: SupabaseClient, today: string) {
  const from = addDays(today, -20);
  const [t, w, p, u] = await Promise.all([
    sb.rpc('rider_my_trips', { p_from: from, p_to: today }),
    sb.rpc('rider_my_weeks'),
    sb.rpc('rider_my_payments'),
    sb.rpc('rider_last_update'),
  ]);
  const trips: RiderTrip[] = ((t.data ?? []) as Record<string, any>[]).map((r) => ({
    tripId: r.trip_id, date: r.operational_date, deliveredAt: String(r.delivered_at).replace('T', ' ').slice(0, 16), orders: r.orders_in_trip, raining: r.is_raining,
    pickupKm100: r.pickup_km100, dropKm100: r.drop_km100, basePaise: Number(r.base_paise), extraKm100: r.extra_km100, distancePaise: Number(r.distance_paise),
    batchBonusPaise: Number(r.batch_bonus_paise), rainPaise: Number(r.rain_paise), festivalPaise: Number(r.festival_paise), totalPaise: Number(r.total_paise), isFinal: !!r.is_final,
  }));
  const weeks: RiderWeek[] = ((w.data ?? []) as Record<string, any>[]).map((r) => ({ periodStart: r.period_start, payDate: r.scheduled_payment_date, netPaise: Number(r.net_payable_paise), paidPaise: Number(r.paid_paise) }));
  const payments: RiderPayment[] = ((p.data ?? []) as Record<string, any>[]).map((r) => ({ date: r.payment_date, amountPaise: Number(r.amount_paise), method: r.payment_method, reference: r.transaction_reference }));
  return { trips, days: groupDays(trips), weeks, payments, lastUpdate: (u.data as string | null) ?? null };
}
