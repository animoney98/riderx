import { supabaseServer } from '@/lib/supabase-server';
import { loadWeekTrips, loadBankDetails, loadRiderNames, loadSetting, resolveWeekStart } from '@/lib/week-data';
import { loadRateCard } from '@/lib/rate-card';
import { cycleFor } from '@/src/engine/calendar';
import { buildWeekly } from '@/src/engine/weekly';
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

  const [{ trips }, { card }] = await Promise.all([loadWeekTrips(sb, cycle.start, cycle.end), loadRateCard(sb, start)]);
  const weekly = buildWeekly(trips, cycle, card.slabs[0].upToOrder ?? 25);
  const feIds = weekly.map((w) => w.feId);
  const [bank, names] = await Promise.all([loadBankDetails(sb, feIds), loadRiderNames(sb, feIds)]);

  const payable = weekly.filter((w) => w.grossPaise > 0 && names.has(w.feId));
  const missing = payable.filter((w) => !bank.has(w.feId));
  const payments = payable.filter((w) => bank.has(w.feId)).map((w) => {
    const b = bank.get(w.feId)!;
    return { feId: w.feId, name: b.holder, accountNumber: b.account, ifsc: b.ifsc, amountPaise: w.grossPaise, remarks: `RiderX payout ${cycle.start} to ${cycle.end}` };
  });
  if (!payments.length) return new Response('No rider has complete bank details with an amount to pay', { status: 400 });

  // Payment date must be today or later; use the scheduled Friday unless it has passed.
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const valueDate = cycle.payDate < today ? today : cycle.payDate;
  try {
    const { buffer, totalPaise, count } = await buildBankFile({ payments, debitAccount: debit, valueDate });
    await sb.from('audit_logs').insert({
      actor_id: auth.user.id, action: 'payroll.bank_file_draft', entity_type: 'payout_cycle', entity_id: cycle.start,
      after_values: { riders: count, total_paise: totalPaise, skipped_missing_bank_details: missing.map((m) => m.feId) },
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="RiderX-bank-file-${cycle.start}-DRAFT.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(`Bank file stopped: ${(e as Error).message}`, { status: 500 });
  }
}
