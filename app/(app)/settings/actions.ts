'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';

const go = (q: string, week?: string, hash = ''): never => redirect(`/settings?${week ? `week=${week}&` : ''}${q}${hash}`);
const err = (m: string, week?: string, hash = ''): never => go('error=' + encodeURIComponent(m), week, hash);

/** Set or change the company debit account. Once one exists, a change waits for a second person. */
export async function proposeAccount(formData: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('propose_debit_account', { p_account: String(formData.get('debit') ?? '') });
  if (error) err(error.message);
  revalidatePath('/settings');
  go('saved=' + encodeURIComponent(data === 'set' ? 'Debit account saved.' : 'Change requested. Another admin or finance manager must approve it before it takes effect.'));
}

export async function decideAccount(formData: FormData) {
  const sb = await supabaseServer();
  const decision = String(formData.get('decision') ?? '');
  const { error } = await sb.rpc('decide_debit_account', { p_decision: decision });
  if (error) err(error.message);
  revalidatePath('/settings');
  go('saved=' + encodeURIComponent({ approve: 'Change approved. The new account is now used in bank files.', reject: 'Change rejected. The old account stays.', cancel: 'Request cancelled.' }[decision] ?? 'Done.'));
}

/** After the bank file is uploaded: record paid / failed per rider in one go. */
export async function recordResults(formData: FormData) {
  const week = String(formData.get('week') ?? '');
  const sb = await supabaseServer();
  const ids = formData.getAll('id').map(String);
  type Res = { payout_id: string; outcome: string; reference?: string; reason?: string };
  const results = ids.flatMap<Res>((id) => {
    const o = String(formData.get('o_' + id) ?? '');
    if (o === 'paid') return [{ payout_id: id, outcome: 'paid', reference: String(formData.get('ref_' + id) ?? '').trim() }];
    if (o === 'failed') return [{ payout_id: id, outcome: 'failed', reason: String(formData.get('why_' + id) ?? '').trim() }];
    return [];
  });
  if (!results.length) err('Choose Paid or Failed for at least one rider.', week, '#results');
  if (results.some((r) => r.outcome === 'paid') && formData.get('confirm') !== 'on') err('Tick the box to confirm the bank accepted the payments marked Paid.', week, '#results');
  const { data, error } = await sb.rpc('record_bank_results', {
    p_period_start: week, p_date: String(formData.get('date') ?? ''), p_method: String(formData.get('method') ?? ''), p_batch_ref: String(formData.get('batch') ?? '').trim(), p_results: results,
  });
  if (error) err(error.message.includes('rider_payments_ref_unique') ? 'A bank reference was already used for another payment.' : 'Nothing was saved: ' + error.message, week, '#results');
  revalidatePath('/settings'); revalidatePath('/payroll/payments'); revalidatePath('/payroll');
  const r = (data ?? { paid: 0, failed: 0 }) as { paid: number; failed: number };
  go('saved=' + encodeURIComponent(`Saved: ${r.paid} marked paid, ${r.failed} marked failed.`), week, '#results');
}
