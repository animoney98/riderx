import { supabaseServer } from '@/lib/supabase-server';
import { loadBankDetails, loadSetting, resolveWeekStart } from '@/lib/week-data';
import { cycleFor } from '@/src/engine/calendar';
import { buildBankFile } from '@/src/export/bankFile';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new Response('Sign in first', { status: 401 });
  const { data: profile } = await sb.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle();
  if (!profile?.active || !['super_admin', 'finance_manager'].includes(profile.role)) return new Response('Only finance managers and admins can download the bank file', { status: 403 });

  const start = await resolveWeekStart(sb, new URL(req.url).searchParams.get('week') ?? undefined);
  const cycle = cycleFor(start);
  const debit = await loadSetting(sb, 'bank_debit_account');
  if (!debit) return new Response('Set the company debit account number in Bank Settings first', { status: 400 });

  // The bank file uses the frozen, approved figures only.
  const { data: cyc } = await sb.from('payout_cycles').select('id, status').eq('period_start', cycle.start).maybeSingle();
  if (!cyc) return new Response('Approve this week\'s payroll first. The bank file is built from approved figures only.', { status: 400 });
  const { data: payouts } = await sb.from('rider_payouts').select('rider_id, net_payable_paise').eq('payout_cycle_id', cyc.id);
  const { data: accts } = await sb.from('rider_platform_accounts').select('rider_id, platform_rider_id').eq('platform', 'zomato').in('rider_id', (payouts ?? []).map((p) => p.rider_id as string));
  const feByRider = new Map((accts ?? []).map((a) => [a.rider_id as string, a.platform_rider_id as string]));
  const bank = await loadBankDetails(sb, [...feByRider.values()]);
  const payable = (payouts ?? []).filter((p) => Number(p.net_payable_paise) > 0);
  const missing = payable.filter((p) => !bank.has(feByRider.get(p.rider_id as string) ?? ''));
  const payments = payable.filter((p) => bank.has(feByRider.get(p.rider_id as string) ?? '')).map((p) => {
    const fe = feByRider.get(p.rider_id as string)!;
    const b = bank.get(fe)!;
    return { feId: fe, name: b.holder, accountNumber: b.account, ifsc: b.ifsc, amountPaise: Number(p.net_payable_paise), remarks: `RiderX payout ${cycle.start} to ${cycle.end}` };
  });
  if (!payments.length) return new Response('No rider has complete bank details with an amount to pay', { status: 400 });

  // Payment date must be today or later; use the scheduled Friday unless it has passed.
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const valueDate = cycle.payDate < today ? today : cycle.payDate;
  try {
    const { buffer, totalPaise, count } = await buildBankFile({ payments, debitAccount: debit, valueDate });
    await sb.from('audit_logs').insert({
      actor_id: auth.user.id, action: 'payroll.bank_file', entity_type: 'payout_cycle', entity_id: cycle.start,
      after_values: { riders: count, total_paise: totalPaise, skipped_missing_bank_details: missing.map((m) => feByRider.get(m.rider_id as string)) },
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="RiderX-bank-file-${cycle.start}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(`Bank file stopped: ${(e as Error).message}`, { status: 500 });
  }
}
