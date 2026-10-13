import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { loadSetting, resolveWeekStart } from '@/lib/week-data';
import { loadOpenFailures, loadPayouts, loadReadiness } from '@/lib/bank';
import { cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { maskAccount } from '@/src/engine/bank';
import { WeekPicker, fmtDate } from '../week-picker';
import { proposeAccount, decideAccount, recordResults } from './actions';

const STATE_LABEL = { ready: 'Ready', needs_check: 'Needs your check', incomplete: 'Incomplete', none: 'No bank details' } as const;
const STATE_PILL = { ready: 'pill p-ok', needs_check: 'pill p-warn', incomplete: 'pill p-warn', none: 'pill p-bad' } as const;

export default async function BankPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; week?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  if (!me?.active || !['super_admin', 'finance_manager'].includes(me.role as string)) {
    return <><h1>Bank</h1><div className="alert warn">Only finance managers and admins can see this page.</div></>;
  }

  const start = await resolveWeekStart(sb, sp.week);
  const cycle = cycleFor(start);
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [current, pendingRaw, readyRows, failures, loaded] = await Promise.all([
    loadSetting(sb, 'bank_debit_account'), loadSetting(sb, 'bank_debit_account_pending'), loadReadiness(sb), loadOpenFailures(sb), loadPayouts(sb, cycle.start),
  ]);
  let pending: { account: string; by: string; by_name: string; at: string } | null = null;
  try { pending = pendingRaw ? JSON.parse(pendingRaw) : null; } catch { pending = null; }
  const mine = pending?.by === auth.user?.id;

  const counts = { ready: 0, needs_check: 0, incomplete: 0, none: 0 };
  for (const r of readyRows) counts[r.state]++;
  const notReady = readyRows.filter((r) => r.state !== 'ready');
  const stateByFe = new Map(readyRows.map((r) => [r.feId, r.state]));
  const toPay = (loaded?.payouts ?? []).filter((p) => p.outstandingPaise > 0);
  const blocked = toPay.filter((p) => (stateByFe.get(p.feId) ?? 'none') !== 'ready');
  const failedByPayout = new Map(failures.map((f) => [f.payoutId, f]));
  const failWeeks = [...new Set(failures.map((f) => f.weekStart))];

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Bank</div>
        <h1>Bank</h1>
      </div>
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.saved && <div className="alert ok">{sp.saved}</div>}

      <section className="card">
        <h2>Company debit account</h2>
        <p style={{ margin: '4px 0 12px' }}>
          {current ? <>Paying from IDFC FIRST Bank account <b style={{ letterSpacing: '.08em' }}>{maskAccount(current)}</b></> : <span className="note">No account set yet.</span>}
        </p>
        {pending && (
          <div className="alert warn" style={{ marginBottom: 14 }}>
            <b>Change waiting for approval:</b> new account <b>{maskAccount(pending.account)}</b>, requested by {mine ? 'you' : pending.by_name} on {fmtDate(pending.at.slice(0, 10))}. The old account is used until it is approved by someone other than the requester.
            <form action={decideAccount} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {mine
                ? <button className="ghost" name="decision" value="cancel">Cancel my request</button>
                : <><button name="decision" value="approve">Approve change</button><button className="ghost" name="decision" value="reject">Reject</button></>}
            </form>
          </div>
        )}
        {!pending && (
          <form action={proposeAccount} className="row">
            <label>{current ? 'Change to a different account number' : 'IDFC FIRST Bank account number to pay from'}<input name="debit" required inputMode="numeric" autoComplete="off" /></label>
            <button type="submit">{current ? 'Request change' : 'Save'}</button>
          </form>
        )}
        <p className="note">This goes in the “Debit Account Number” column of the bank file, so a wrong or swapped number sends payroll from the wrong account. Only the last four digits are shown here. Once an account is set, changing it needs a second admin or finance manager to approve. If you are the only one who can approve, the change goes straight through and is recorded in the audit log.</p>
      </section>

      <section className="card">
        <h2>Payout readiness</h2>
        <p className="note" style={{ margin: '4px 0 14px' }}>The bank file only includes riders with a name, account number, IFSC code and your check. Anyone else is left out until fixed.</p>
        <div className="grid leadstats">
          <div className="stat"><span>Ready</span><b>{counts.ready}</b></div>
          <div className="stat"><span>Need your check</span><b>{counts.needs_check}</b></div>
          <div className="stat"><span>Incomplete</span><b>{counts.incomplete}</b></div>
          <div className="stat"><span>No bank details</span><b>{counts.none}</b></div>
        </div>
        {blocked.length > 0 && (
          <div className="alert warn" style={{ marginTop: 14 }}>
            <b>Week of {fmtDate(cycle.start)}:</b> {blocked.length} {blocked.length === 1 ? 'rider is' : 'riders are'} owed {formatINR(blocked.reduce((s, p) => s + p.outstandingPaise, 0))} but cannot be in the bank file yet: {blocked.map((p) => p.riderName).join(', ')}.
          </div>
        )}
        {notReady.length > 0 ? (
          <div className="tbl" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th>Rider</th><th>FE ID</th><th>Phone</th><th>Status</th><th>What is missing</th><th></th></tr></thead>
              <tbody>
                {notReady.map((r) => (
                  <tr key={r.riderId}>
                    <td><b>{r.name}</b></td><td>{r.feId}</td><td>{r.phone ?? '—'}</td>
                    <td><span className={STATE_PILL[r.state]}>{STATE_LABEL[r.state]}</span></td>
                    <td>{r.missing.join(', ')}</td>
                    <td><Link href={`/riders/${r.riderId}`}>Open rider</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="note" style={{ marginTop: 14 }}>Every active rider is ready for the bank file.</p>}
      </section>

      <WeekPicker path="/settings" start={cycle.start} payDate={cycle.payDate} />
      <section className="card" id="results">
        <h2>Bank results for this week</h2>
        {!loaded ? (
          <p className="note">This week is not approved yet. Approve it on the Salary & Payroll page first.</p>
        ) : !toPay.length ? (
          <p className="note">Nobody is owed anything for this week. Everything is paid.</p>
        ) : (
          <form action={recordResults} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="note">After you upload the bank file, mark what happened to each payment. Riders set to Paid are recorded as paid in full. Riders set to Failed go on the pay-again list below. Not sent is left alone.</p>
            <input type="hidden" name="week" value={cycle.start} />
            <div className="row">
              <label>Date<input type="date" name="date" defaultValue={today} max={today} required /></label>
              <label>Method<select name="method" defaultValue="Bank transfer"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Other</option></select></label>
              <label>Bank batch reference<input name="batch" placeholder="e.g. IDFC batch number" /></label>
            </div>
            <div className="tbl">
              <table>
                <thead><tr><th>Rider</th><th>FE ID</th><th className="n">Still owed</th><th>Result</th><th>Own reference</th><th>Reason if failed</th></tr></thead>
                <tbody>
                  {toPay.map((p) => {
                    const st = stateByFe.get(p.feId) ?? 'none';
                    const prior = failedByPayout.get(p.payoutId);
                    return (
                      <tr key={p.payoutId}>
                        <td><b>{p.riderName}</b>{st !== 'ready' && <div className="note">Not in bank file: {STATE_LABEL[st].toLowerCase()}</div>}{prior && <div className="note">Failed before: {prior.reason}</div>}</td>
                        <td>{p.feId}</td><td className="n">{formatINR(p.outstandingPaise)}</td>
                        <td>
                          <input type="hidden" name="id" value={p.payoutId} />
                          <select name={`o_${p.payoutId}`} defaultValue={st === 'ready' ? 'paid' : 'skip'} aria-label={`Result for ${p.riderName}`}>
                            <option value="paid">Paid</option><option value="failed">Failed</option><option value="skip">Not sent</option>
                          </select>
                        </td>
                        <td><input name={`ref_${p.payoutId}`} placeholder="optional" aria-label="Reference" style={{ width: 130 }} /></td>
                        <td><input name={`why_${p.payoutId}`} placeholder="e.g. wrong IFSC" aria-label="Reason" style={{ width: 170 }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="confirm" style={{ minHeight: 0, width: 18, height: 18 }} /> The bank accepted the payments I marked Paid.</label>
            <div><button type="submit">Save bank results</button></div>
            <p className="note">Saved results are a permanent record. Everything is saved together, or nothing is. A rider's reference is the batch reference plus their FE ID unless you type their own.</p>
          </form>
        )}
      </section>

      <section className="card">
        <h2>Failed payments to pay again</h2>
        {!failures.length ? (
          <p className="note">No failed payments are waiting.</p>
        ) : (
          <>
            <p className="note" style={{ margin: '4px 0 14px' }}>Fix the cause (usually the bank details), then download a bank file with just these riders. A rider disappears from this list once they are paid.</p>
            <div className="tbl">
              <table>
                <thead><tr><th>Rider</th><th>FE ID</th><th>Week</th><th className="n">Still owed</th><th>Failed on</th><th>Reason</th><th>Bank details</th></tr></thead>
                <tbody>
                  {failures.map((f) => {
                    const st = stateByFe.get(f.feId) ?? 'none';
                    return (
                      <tr key={f.payoutId}>
                        <td><Link href={`/riders/${f.riderId}`}><b>{f.riderName}</b></Link></td><td>{f.feId}</td><td>{fmtDate(f.weekStart)}</td>
                        <td className="n">{formatINR(f.outstandingPaise)}</td><td>{f.failedOn}</td><td>{f.reason}</td>
                        <td><span className={STATE_PILL[st]}>{STATE_LABEL[st]}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {failWeeks.map((w) => <a key={w} className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} href={`/payroll/bank-file?week=${w}&only=failed`}>Download retry bank file, week of {fmtDate(w)}</a>)}
            </div>
          </>
        )}
      </section>
    </>
  );
}
