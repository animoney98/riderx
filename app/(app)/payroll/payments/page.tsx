import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveWeekStart } from '@/lib/week-data';
import { loadPayouts } from '@/lib/payments';
import { cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { WeekPicker } from '../../week-picker';
import { recordPayment, markAllPaid } from './actions';

const pill = (s: string) => (s === 'Paid' ? 'pill p-ok' : 'pill p-warn');

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ week?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const start = await resolveWeekStart(sb, sp.week);
  const cycle = cycleFor(start);
  const data = await loadPayouts(sb, cycle.start);
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const net = data?.payouts.reduce((s, p) => s + p.netPaise, 0) ?? 0;
  const paid = data?.payouts.reduce((s, p) => s + p.paidPaise, 0) ?? 0;
  const names = new Map((data?.payouts ?? []).map((p) => [p.riderId, p.riderName]));
  return (
    <>
      <div>
        <Link href={`/payroll?week=${cycle.start}`} className="note">← Salary & Payroll</Link>
        <h1>Payments</h1>
      </div>
      <WeekPicker path="/payroll/payments" start={cycle.start} payDate={cycle.payDate} />
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.saved && <div className="alert ok">Payment recorded.</div>}
      {!data ? (
        <div className="alert warn">This week is not approved yet. Approve it on the Salary & Payroll page first.</div>
      ) : (
        <>
          <section className="grid">
            <div className="stat"><span>Net payable</span><b>{formatINR(net)}</b></div>
            <div className="stat"><span>Paid</span><b>{formatINR(paid)}</b></div>
            <div className="stat"><span>Outstanding</span><b>{formatINR(net - paid)}</b></div>
          </section>

          {net - paid > 0 && (
            <form action={markAllPaid} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2>Mark everyone as paid</h2>
              <p className="note">Use this after the bank has accepted the bank file. It records each rider’s full outstanding amount.</p>
              <input type="hidden" name="week" value={cycle.start} />
              <div className="row">
                <label>Payment date<input type="date" name="date" defaultValue={today} max={today} required /></label>
                <label>Method<select name="method" defaultValue="Bank transfer"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Other</option></select></label>
                <label>Bank batch reference<input name="reference" placeholder="e.g. IDFC batch number" /></label>
              </div>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="confirm" style={{ minHeight: 0, width: 18, height: 18 }} /> The bank has accepted these payments.</label>
              <div><button type="submit">Mark all as paid</button></div>
            </form>
          )}

          <section className="card">
            <h2>Rider payments</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>Rider</th><th>FE ID</th><th className="n">Net payable</th><th className="n">Paid</th><th className="n">Outstanding</th><th>Status</th><th>Record a payment</th></tr></thead>
                <tbody>
                  {data.payouts.map((p) => (
                    <tr key={p.payoutId}>
                      <td><b>{p.riderName}</b></td><td>{p.feId}</td><td className="n">{formatINR(p.netPaise)}</td><td className="n">{formatINR(p.paidPaise)}</td><td className="n">{formatINR(p.outstandingPaise)}</td>
                      <td><span className={pill(p.status)}>{p.status}</span></td>
                      <td>
                        {p.outstandingPaise > 0 ? (
                          <form action={recordPayment} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <input type="hidden" name="week" value={cycle.start} /><input type="hidden" name="payoutId" value={p.payoutId} />
                            <input name="amount" required inputMode="decimal" defaultValue={(p.outstandingPaise / 100).toFixed(2)} aria-label="Amount" style={{ width: 100 }} />
                            <input type="date" name="date" defaultValue={today} max={today} required aria-label="Date" />
                            <select name="method" defaultValue="Bank transfer" aria-label="Method"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Other</option></select>
                            <input name="reference" placeholder="Reference" aria-label="Reference" style={{ width: 130 }} />
                            <button type="submit">Save</button>
                          </form>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Payment history</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>Date</th><th>Rider</th><th className="n">Amount</th><th>Method</th><th>Reference</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}><td>{p.date}</td><td>{names.get(p.riderId)}</td><td className="n">{formatINR(p.amountPaise)}</td><td>{p.method}</td><td>{p.reference ?? '—'}</td></tr>
                  ))}
                  {!data.payments.length && <tr><td colSpan={5} className="note">No payments recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="note">Payments are a permanent record and cannot be edited or deleted. A mistake is fixed with a reversing entry.</p>
          </section>
        </>
      )}
    </>
  );
}
