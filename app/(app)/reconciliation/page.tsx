import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveWeekStart, loadRiderNames } from '@/lib/week-data';
import { loadWeekFinance, loadReceipts } from '@/lib/finance';
import { cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { WeekPicker } from '../week-picker';

async function record(formData: FormData) {
  'use server';
  const week = String(formData.get('week'));
  const back = (q: string): never => redirect(`/reconciliation?week=${week}&${q}`);
  const amount = Math.round(Number(String(formData.get('amount')).replace(/,/g, '')) * 100);
  const date = String(formData.get('date'));
  const reference = String(formData.get('reference') ?? '').trim();
  if (!Number.isFinite(amount) || amount === 0) back('error=Enter+the+amount+received');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back('error=Enter+the+date+received');
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { error } = await sb.from('zomato_receipts').insert({ period_start: cycleFor(week).start, amount_paise: amount, received_on: date, reference: reference || null, recorded_by: auth.user?.id });
  if (error) back(`error=${encodeURIComponent(error.message.includes('ref_unique') ? 'That reference was already recorded' : 'Could not save. Only finance managers and admins can record receipts')}`);
  await sb.from('audit_logs').insert({ actor_id: auth.user?.id, action: 'zomato.receipt', entity_type: 'zomato_receipt', entity_id: week, after_values: { amount_paise: amount, reference } });
  revalidatePath('/reconciliation');
  back('saved=1');
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ week?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const start = await resolveWeekStart(sb, sp.week);
  const cycle = cycleFor(start);
  const [fin, receipts] = await Promise.all([loadWeekFinance(sb, cycle.start, cycle.end), loadReceipts(sb, cycle.start)]);
  const names = await loadRiderNames(sb, fin.rows.map((r) => r.feId));
  const received = receipts.reduce((s, r) => s + r.amountPaise, 0);
  const diff = fin.totals.revenuePaise - received;
  const t = fin.totals;
  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Zomato Reconciliation</div>
        <h1>What Zomato owes vs what riders earn</h1>
      </div>
      <WeekPicker path="/reconciliation" start={cycle.start} />
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.saved && <div className="alert ok">Receipt recorded.</div>}
      {fin.withoutEarnings > 0 && <div className="alert warn">{fin.withoutEarnings} trips this week have no calculated earnings and are left out of both sides. Import the file again to calculate them.</div>}
      <section className="grid">
        <div className="stat"><span>Zomato payout for the week</span><b>{formatINR(t.revenuePaise)}</b></div>
        <div className="stat"><span>Rider earnings</span><b>{formatINR(t.riderPaise)}</b></div>
        <div className="stat"><span>RiderX margin</span><b>{formatINR(t.marginPaise)}{t.marginPct !== null ? ` (${t.marginPct}%)` : ''}</b></div>
        <div className="stat"><span>Received from Zomato</span><b>{formatINR(received)}</b></div>
        <div className="stat"><span>Still to receive</span><b>{formatINR(diff)}</b></div>
      </section>

      <section className="card">
        <h2>By rider</h2>
        <div className="tbl"><table>
          <thead><tr><th>Rider</th><th>FE ID</th><th className="n">Orders</th><th className="n">Zomato payout</th><th className="n">Rider earnings</th><th className="n">Margin</th><th className="n">Margin per order</th></tr></thead>
          <tbody>
            {fin.rows.map((r) => (
              <tr key={r.feId}>
                <td><b>{names.get(r.feId) || <span className="pill p-warn">Not registered</span>}</b></td><td>{r.feId}</td><td className="n">{r.orders}</td>
                <td className="n">{formatINR(r.revenuePaise)}</td><td className="n">{formatINR(r.riderPaise)}</td>
                <td className={r.marginPaise < 0 ? 'n neg' : 'n'}>{formatINR(r.marginPaise)}</td>
                <td className="n">{r.orders ? formatINR(Math.round(r.marginPaise / r.orders)) : '—'}</td>
              </tr>
            ))}
            {fin.rows.length > 0 && (
              <tr className="total">
                <td colSpan={2}>Total</td><td className="n">{t.orders}</td><td className="n">{formatINR(t.revenuePaise)}</td><td className="n">{formatINR(t.riderPaise)}</td>
                <td className="n">{formatINR(t.marginPaise)}</td><td className="n">{t.orders ? formatINR(Math.round(t.marginPaise / t.orders)) : '—'}</td>
              </tr>
            )}
            {!fin.rows.length && <tr><td colSpan={7} className="note">No trips saved for this week.</td></tr>}
          </tbody>
        </table></div>
        <p className="note">Zomato payout is the “Total Payout” column of the Zomato file (it includes the batch bonus). Tips are paid by Zomato directly to riders and are not in either side. Rider earnings are the same figures as on Salary & Payroll.</p>
      </section>

      <section className="card">
        <h2>Money received from Zomato for this week</h2>
        <form action={record} className="row" style={{ marginBottom: 12 }}>
          <input type="hidden" name="week" value={cycle.start} />
          <label>Amount received (₹)<input name="amount" required inputMode="decimal" /></label>
          <label>Date received<input type="date" name="date" required /></label>
          <label>Reference<input name="reference" placeholder="Bank reference" /></label>
          <button type="submit">Record</button>
        </form>
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th className="n">Amount</th><th>Reference</th></tr></thead>
          <tbody>
            {receipts.map((r) => <tr key={r.id}><td>{r.receivedOn}</td><td className="n">{formatINR(r.amountPaise)}</td><td>{r.reference ?? '—'}</td></tr>)}
            {!receipts.length && <tr><td colSpan={3} className="note">Nothing recorded yet. Zomato normally pays on the Monday after the week.</td></tr>}
          </tbody>
        </table></div>
        <p className="note">Receipts are a permanent record. If you enter one wrongly, record the same amount as a negative number to correct it.</p>
      </section>
    </>
  );
}
