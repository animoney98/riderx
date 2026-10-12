'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { loadPayouts } from '@/lib/payments';

const METHODS = ['Bank transfer', 'UPI', 'Cash', 'Other'];
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

async function ctx(formData: FormData) {
  const week = String(formData.get('week') ?? '');
  const back = (q: string): never => redirect(`/payroll/payments?week=${week}&${q}`);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const data = await loadPayouts(sb, week);
  if (!data) back('error=This+week+is+not+approved+yet');
  const date = String(formData.get('date') ?? '');
  const method = String(formData.get('method') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIST()) back('error=Payment+date+must+be+today+or+earlier');
  if (!METHODS.includes(method)) back('error=Choose+a+payment+method');
  if (method !== 'Cash' && !reference) back('error=Enter+the+bank+or+UPI+reference');
  return { week, back, sb, uid: auth.user!.id, data: data!, date, method, reference };
}

/** Record one payment for one rider. Never more than the amount still owed. */
export async function recordPayment(formData: FormData) {
  const { week, back, sb, uid, data, date, method, reference } = await ctx(formData);
  const p = data.payouts.find((x) => x.payoutId === String(formData.get('payoutId')));
  if (!p) back('error=Rider+not+found+in+this+week');
  const amountPaise = Math.round(Number(String(formData.get('amount')).replace(/,/g, '')) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) back('error=Enter+an+amount+above+zero');
  if (amountPaise > p!.outstandingPaise) back(`error=${encodeURIComponent('That is more than the outstanding amount for ' + p!.riderName)}`);
  const { error } = await sb.from('rider_payments').insert({
    rider_payout_id: p!.payoutId, rider_id: p!.riderId, amount_paise: amountPaise, payment_date: date, payment_method: method,
    transaction_reference: reference || null, status: 'confirmed', recorded_by: uid,
  });
  if (error) back(`error=${encodeURIComponent(error.message.includes('rider_payments_ref_unique') ? 'That reference was already used for another payment' : 'Could not save the payment')}`);
  await sb.from('audit_logs').insert({ actor_id: uid, action: 'payment.record', entity_type: 'rider_payout', entity_id: p!.payoutId, after_values: { amount_paise: amountPaise, method, reference } });
  revalidatePath('/payroll/payments');
  back('saved=1');
}

/** After uploading the bank file: mark every rider's full outstanding amount as paid. */
export async function markAllPaid(formData: FormData) {
  const { back, sb, uid, data, date, method, reference } = await ctx(formData);
  if (formData.get('confirm') !== 'on') back('error=Tick+the+box+to+confirm+the+bank+accepted+the+payments');
  const todo = data.payouts.filter((p) => p.outstandingPaise > 0);
  if (!todo.length) back('error=Nobody+has+an+outstanding+amount');
  const rows = todo.map((p) => ({
    rider_payout_id: p.payoutId, rider_id: p.riderId, amount_paise: p.outstandingPaise, payment_date: date, payment_method: method,
    transaction_reference: reference ? `${reference}-${p.feId}` : null, status: 'confirmed', recorded_by: uid,
  }));
  const { error } = await sb.from('rider_payments').insert(rows);
  if (error) back(`error=${encodeURIComponent('Nothing was saved: ' + (error.message.includes('rider_payments_ref_unique') ? 'that reference was already used' : error.message))}`);
  await sb.from('audit_logs').insert({ actor_id: uid, action: 'payment.record_all', entity_type: 'payout_cycle', entity_id: data.cycleId, after_values: { riders: rows.length, total_paise: rows.reduce((s, r) => s + r.amount_paise, 0), method, reference } });
  revalidatePath('/payroll/payments');
  back('saved=1');
}
