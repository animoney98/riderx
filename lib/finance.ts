import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMargin, type FinanceTrip } from '@/src/engine/finance';

/** Revenue and rider cost for one Monday-Sunday week. Trips without calculated earnings are counted separately, not guessed. */
export async function loadWeekFinance(sb: SupabaseClient, start: string, end: string) {
  const trips: FinanceTrip[] = [];
  let withoutEarnings = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('trips')
      .select('id, fe_id, orders_in_trip, zomato_pay_paise, trip_earnings(total_paise, superseded_at)')
      .gte('operational_date', start).lte('operational_date', end).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const e = (r.trip_earnings as { total_paise: number; superseded_at: string | null }[]).find((x) => x.superseded_at === null);
      if (!e) { withoutEarnings++; continue; }
      trips.push({ feId: r.fe_id, orders: r.orders_in_trip, revenuePaise: Number(r.zomato_pay_paise), riderPaise: Number(e.total_paise) });
    }
    if (!data || data.length < 1000) break;
  }
  return { ...buildMargin(trips), withoutEarnings };
}

export async function loadReceipts(sb: SupabaseClient, periodStart: string) {
  const { data } = await sb.from('zomato_receipts').select('id, amount_paise, received_on, reference, notes').eq('period_start', periodStart).order('received_on');
  return (data ?? []).map((r) => ({ id: r.id as string, amountPaise: Number(r.amount_paise), receivedOn: r.received_on as string, reference: r.reference as string | null, notes: r.notes as string | null }));
}
