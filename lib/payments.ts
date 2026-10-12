import type { SupabaseClient } from '@supabase/supabase-js';

export interface PayoutRow { payoutId: string; riderId: string; riderName: string; feId: string; netPaise: number; paidPaise: number; outstandingPaise: number; status: 'Unpaid' | 'Partially paid' | 'Paid' | 'Overpaid' }
export interface PaymentRow { id: string; riderId: string; amountPaise: number; date: string; method: string; reference: string | null; status: string; notes: string | null }

/** Approved payouts for a week with what has been paid (confirmed payments minus reversals). */
export async function loadPayouts(sb: SupabaseClient, periodStart: string): Promise<{ cycleId: string; payouts: PayoutRow[]; payments: PaymentRow[] } | null> {
  const { data: cyc } = await sb.from('payout_cycles').select('id').eq('period_start', periodStart).maybeSingle();
  if (!cyc) return null;
  const { data: po } = await sb.from('rider_payouts').select('id, rider_id, net_payable_paise, riders(full_name)').eq('payout_cycle_id', cyc.id);
  const ids = (po ?? []).map((p) => p.id as string);
  const { data: pay } = ids.length
    ? await sb.from('rider_payments').select('id, rider_payout_id, rider_id, amount_paise, payment_date, payment_method, transaction_reference, status, notes').in('rider_payout_id', ids).order('created_at')
    : { data: [] };
  const { data: accts } = await sb.from('rider_platform_accounts').select('rider_id, platform_rider_id').eq('platform', 'zomato').in('rider_id', (po ?? []).map((p) => p.rider_id as string));
  const fe = new Map((accts ?? []).map((a) => [a.rider_id as string, a.platform_rider_id as string]));
  const paidBy = new Map<string, number>();
  for (const p of pay ?? []) if (p.status === 'confirmed' || p.status === 'reversed') paidBy.set(p.rider_payout_id as string, (paidBy.get(p.rider_payout_id as string) ?? 0) + Number(p.amount_paise));
  const payouts = (po ?? []).map((p) => {
    const net = Number(p.net_payable_paise);
    const paid = paidBy.get(p.id as string) ?? 0;
    const status: PayoutRow['status'] = paid <= 0 ? 'Unpaid' : paid < net ? 'Partially paid' : paid === net ? 'Paid' : 'Overpaid';
    return {
      payoutId: p.id as string, riderId: p.rider_id as string, riderName: (p.riders as unknown as { full_name: string } | null)?.full_name ?? '', feId: fe.get(p.rider_id as string) ?? '',
      netPaise: net, paidPaise: paid, outstandingPaise: net - paid, status,
    };
  }).sort((a, b) => a.riderName.localeCompare(b.riderName));
  const payments = (pay ?? []).map((p) => ({ id: p.id as string, riderId: p.rider_id as string, amountPaise: Number(p.amount_paise), date: p.payment_date as string, method: p.payment_method as string, reference: (p.transaction_reference as string | null), status: p.status as string, notes: p.notes as string | null }));
  return { cycleId: cyc.id as string, payouts, payments };
}
