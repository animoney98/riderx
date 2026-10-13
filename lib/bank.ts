import type { SupabaseClient } from '@supabase/supabase-js';
import { openFailures, readiness, type BankFacts, type Readiness } from '@/src/engine/bank';
import { loadPayouts } from '@/lib/payments';

export interface ReadinessRow { riderId: string; name: string; feId: string; phone: string | null; state: Readiness; missing: string[] }

/** Every active rider with a Zomato FE ID, and whether the bank file can include them. */
export async function loadReadiness(sb: SupabaseClient): Promise<ReadinessRow[]> {
  const { data: riders } = await sb.from('riders').select('id, full_name, phone, status').in('status', ['active', 'onboarding']).order('full_name');
  const ids = (riders ?? []).map((r) => r.id as string);
  if (!ids.length) return [];
  const [{ data: accts }, { data: det }] = await Promise.all([
    sb.from('rider_platform_accounts').select('rider_id, platform_rider_id').eq('platform', 'zomato').in('rider_id', ids),
    sb.from('rider_payment_details').select('rider_id, bank_account_holder, bank_account_number, bank_ifsc, verified_at, upi_id, source').in('rider_id', ids),
  ]);
  const fe = new Map((accts ?? []).map((a) => [a.rider_id as string, a.platform_rider_id as string]));
  const facts = new Map((det ?? []).map((d) => [d.rider_id as string, { holder: d.bank_account_holder, account: d.bank_account_number, ifsc: d.bank_ifsc, verifiedAt: d.verified_at, upi: d.upi_id, source: d.source } as BankFacts]));
  return (riders ?? []).filter((r) => fe.has(r.id as string)).map((r) => {
    const x = readiness(facts.get(r.id as string) ?? null);
    return { riderId: r.id as string, name: r.full_name as string, feId: fe.get(r.id as string)!, phone: r.phone as string | null, state: x.state, missing: x.missing };
  });
}

export interface OpenFailure { payoutId: string; riderId: string; riderName: string; feId: string; weekStart: string; amountPaise: number; outstandingPaise: number; failedOn: string; reason: string; createdAt: string }

/** Failed bank payments that still have money outstanding, across all weeks. */
export async function loadOpenFailures(sb: SupabaseClient): Promise<OpenFailure[]> {
  const { data: fails } = await sb.from('payment_failures').select('rider_payout_id, rider_id, amount_paise, failed_on, reason, created_at');
  if (!fails?.length) return [];
  const payoutIds = [...new Set(fails.map((f) => f.rider_payout_id as string))];
  const { data: po } = await sb.from('rider_payouts').select('id, rider_id, net_payable_paise, riders(full_name), payout_cycles(period_start)').in('id', payoutIds);
  const { data: pay } = await sb.from('rider_payments').select('rider_payout_id, amount_paise, status').in('rider_payout_id', payoutIds);
  const paid = new Map<string, number>();
  for (const p of pay ?? []) if (p.status === 'confirmed' || p.status === 'reversed') paid.set(p.rider_payout_id as string, (paid.get(p.rider_payout_id as string) ?? 0) + Number(p.amount_paise));
  const info = new Map((po ?? []).map((p) => [p.id as string, p]));
  const { data: accts } = await sb.from('rider_platform_accounts').select('rider_id, platform_rider_id').eq('platform', 'zomato').in('rider_id', [...new Set((po ?? []).map((p) => p.rider_id as string))]);
  const fe = new Map((accts ?? []).map((a) => [a.rider_id as string, a.platform_rider_id as string]));
  const open = openFailures(
    fails.map((f) => ({ payoutId: f.rider_payout_id as string, amountPaise: Number(f.amount_paise), failedOn: f.failed_on as string, reason: f.reason as string, createdAt: f.created_at as string })),
    (po ?? []).map((p) => ({ payoutId: p.id as string, outstandingPaise: Number(p.net_payable_paise) - (paid.get(p.id as string) ?? 0) })),
  );
  return open.map((f) => {
    const p = info.get(f.payoutId)!;
    return {
      ...f, riderId: p.rider_id as string, riderName: (p.riders as unknown as { full_name: string } | null)?.full_name ?? '', feId: fe.get(p.rider_id as string) ?? '',
      weekStart: (p.payout_cycles as unknown as { period_start: string } | null)?.period_start ?? '',
    };
  }).sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : a.riderName.localeCompare(b.riderName)));
}

export { loadPayouts };
