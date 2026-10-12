import { supabaseServer } from '@/lib/supabase-server';
import { loadWeekTrips, loadRiderNames, loadBankDetails, loadSetting, resolveWeekStart } from '@/lib/week-data';
import { loadRateCard } from '@/lib/rate-card';
import { buildWeekly } from '@/src/engine/weekly';
import { addDays, cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { WeekPicker } from '../week-picker';
import { approvePayroll } from './actions';
import { loadPayouts } from '@/lib/payments';

const km = (v: number) => (v / 100).toFixed(2);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ week?: string; error?: string; approved?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role').eq('id', auth.user?.id ?? '').maybeSingle();
  const canApprove = me?.role === 'super_admin' || me?.role === 'finance_manager';
  const start = await resolveWeekStart(sb, sp.week);
  const cycle = cycleFor(start);
  const [{ trips, withoutEarnings }, { card }] = await Promise.all([loadWeekTrips(sb, cycle.start, cycle.end), loadRateCard(sb, start, { standardOnly: true })]);
  const slab1Limit = card.slabs[0].upToOrder ?? 25;
  const r1 = formatINR(card.slabs[0].ratePaise).replace('.00', '');
  const r2 = formatINR((card.slabs[1] ?? card.slabs[0]).ratePaise).replace('.00', '');
  const rows = buildWeekly(trips, cycle, slab1Limit);
  const { data: approvedCycle } = await sb.from('payout_cycles').select('id, status, approved_at, profiles:approved_by(full_name)').eq('period_start', cycle.start).maybeSingle();
  const { data: payouts } = approvedCycle ? await sb.from('rider_payouts').select('gross_paise').eq('payout_cycle_id', approvedCycle.id) : { data: null };
  const pay = approvedCycle ? await loadPayouts(sb, cycle.start) : null;
  const payByFe = new Map((pay?.payouts ?? []).map((p) => [p.feId, p]));
  const paidTotal = (pay?.payouts ?? []).reduce((s, p) => s + p.paidPaise, 0);
  const approvedTotal = (payouts ?? []).reduce((s, p) => s + Number(p.gross_paise), 0);
  const names = await loadRiderNames(sb, rows.map((r) => r.feId));
  const [bank, debit] = await Promise.all([loadBankDetails(sb, rows.map((r) => r.feId)), loadSetting(sb, 'bank_debit_account')]);
  const payable = rows.filter((r) => r.grossPaise > 0 && names.has(r.feId));
  const noBank = payable.filter((r) => !bank.has(r.feId));

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const gross = sum((r) => r.grossPaise);
  const unregistered = rows.filter((r) => !names.has(r.feId)).length;
  const cards: [string, string][] = [
    ['Riders in this cycle', String(rows.length)],
    ['Total orders', String(sum((r) => r.orders))],
    ['Gross rider earnings', formatINR(gross)],
    ['Incentives and bonuses', formatINR(sum((r) => r.incentivesPaise))],
    ['Additions / deductions', '₹0.00 / ₹0.00'],
    [approvedCycle ? 'Net salary payable' : 'Net salary payable (draft)', formatINR(gross)],
    ['Approved', approvedCycle ? 'Approved' : 'Not approved yet'],
    ['Paid', formatINR(paidTotal)],
  ];

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Salary & Payroll</div>
        <h1>Weekly rider salary</h1>
      </div>
      <WeekPicker path="/payroll" start={cycle.start} payDate={cycle.payDate} />
      <div>
        <a className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#141414' }} href={`/payroll/export?week=${cycle.start}`}>Download Payroll Excel (draft)</a>{' '}
        <a className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#141414', marginLeft: 8 }} href={`/payroll/bank-file?week=${cycle.start}`}>Download Bank file</a>
        {approvedCycle && <a className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#141414', marginLeft: 8 }} href={`/payroll/payments?week=${cycle.start}`}>Record payments</a>}
        <p className="note" style={{ marginTop: 8 }}>
          {!approvedCycle && <>The bank file is available after you approve the week. </>}Bank file: {payable.length - noBank.length} of {payable.length} riders ready, {formatINR(payable.filter((r) => bank.has(r.feId)).reduce((s, r) => s + r.grossPaise, 0))}.
          {!debit && <> The company debit account is not set — <a href="/settings">add it in Bank Settings</a>.</>}
          {noBank.length > 0 && <> No bank details yet for: {noBank.map((r) => names.get(r.feId)).join(', ')} — they will be left out of the file. Add them on the Riders page.</>}
        </p>
      </div>
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.approved && <div className="alert ok">Payroll approved. The figures for this week are now frozen.</div>}
      {approvedCycle ? (
        <div className="alert ok">
          <b>Approved</b> on {new Date(approvedCycle.approved_at as string).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' })} by {(approvedCycle.profiles as unknown as { full_name: string } | null)?.full_name ?? 'finance'}.
          The approved total is {formatINR(approvedTotal)}. Penalties and other changes after approval are entered as separate adjustments, never by editing these figures.
          {approvedTotal !== gross && <> <b>Warning:</b> the live figures ({formatINR(gross)}) now differ from the approved total. The bank file uses the approved figures. Check the Imports page for a changed file before paying.</>}
        </div>
      ) : (
        <>
          <div className="alert warn">
            <b>Draft.</b> These figures are calculated live from saved trips and are not final until approved. Penalties and payment recording are the next steps.
          </div>
          {canApprove && rows.length > 0 && !withoutEarnings && !unregistered && (
            <form action={approvePayroll} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2>Approve this week</h2>
              <input type="hidden" name="week" value={cycle.start} />
              <input type="hidden" name="expectedTotal" value={gross} />
              <p>{rows.length} riders · {formatINR(gross)} · payment on {cycle.payDate}. After approval these figures are frozen and the bank file becomes available.</p>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="confirm" style={{ minHeight: 0, width: 18, height: 18 }} /> I have checked the figures and they are correct.</label>
              <div><button type="submit">Approve payroll</button></div>
            </form>
          )}
        </>
      )}
      {withoutEarnings > 0 && <div className="alert warn">{withoutEarnings} trips this week have no calculated earnings yet and are not counted. Import the file again to calculate them.</div>}
      {unregistered > 0 && <div className="alert warn">{unregistered} FE IDs in this week are not registered as riders.</div>}

      <section className="grid">
        {cards.map(([label, value]) => (
          <div key={label} className="stat"><span>{label}</span><b style={{ fontSize: value.length > 16 ? 15 : 22 }}>{value}</b></div>
        ))}
      </section>

      <section className="card">
        <h2>Rider-wise payroll</h2>
        <div className="tbl">
          <table style={{ minWidth: 1500 }}>
            <thead>
              <tr>
                <th>#</th><th>Rider</th><th>FE ID</th>
                {DAYS.map((d, i) => <th key={d} className="n">{d}<br /><small style={{ fontWeight: 400 }}>{addDays(cycle.start, i).slice(5)}</small></th>)}
                <th className="n">Orders</th><th className="n">At {r1}</th><th className="n">At {r2}</th><th className="n">Base</th><th className="n">Km</th><th className="n">Extra km</th>
                <th className="n">Distance</th><th className="n">Batched</th><th className="n">Batch bonus</th><th className="n">Rain</th><th className="n">Festival</th>
                <th className="n">Gross</th><th className="n">Net payable</th><th className="n">Paid</th><th className="n">Outstanding</th><th>Pay on</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.feId}>
                  <td>{i + 1}</td><td><b>{names.get(r.feId) || <span className="pill p-warn">Not registered</span>}</b></td><td>{r.feId}</td>
                  {r.ordersByDay.map((n, d) => <td key={d} className="n">{n || '–'}</td>)}
                  <td className="n"><b>{r.orders}</b></td><td className="n">{r.slab1Orders}</td><td className="n">{r.slab2Orders}</td><td className="n">{formatINR(r.basePaise)}</td>
                  <td className="n">{km(r.km100)}</td><td className="n">{km(r.extraKm100)}</td><td className="n">{formatINR(r.distancePaise)}</td>
                  <td className="n">{r.batchedTrips}</td><td className="n">{formatINR(r.batchBonusPaise)}</td><td className="n">{formatINR(r.rainPaise)}</td><td className="n">{formatINR(r.festivalPaise)}</td>
                  <td className="n">{formatINR(r.grossPaise)}</td><td className="n"><b>{formatINR(r.grossPaise)}</b></td><td className="n">{formatINR(payByFe.get(r.feId)?.paidPaise ?? 0)}</td><td className="n">{formatINR(payByFe.get(r.feId)?.outstandingPaise ?? r.grossPaise)}</td>
                  <td>{cycle.payDate}</td><td>{approvedCycle ? <span className={payByFe.get(r.feId)?.status === 'Paid' ? 'pill p-ok' : 'pill p-warn'}>{payByFe.get(r.feId)?.status ?? 'Approved'}</span> : <span className="pill p-warn">Draft</span>}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr style={{ fontWeight: 800, background: '#F6F5F3' }}>
                  <td colSpan={3}>Total ({rows.length} riders)</td>
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => <td key={d} className="n">{sum((r) => r.ordersByDay[d]) || '–'}</td>)}
                  <td className="n">{sum((r) => r.orders)}</td><td className="n">{sum((r) => r.slab1Orders)}</td><td className="n">{sum((r) => r.slab2Orders)}</td><td className="n">{formatINR(sum((r) => r.basePaise))}</td>
                  <td className="n">{km(sum((r) => r.km100))}</td><td className="n">{km(sum((r) => r.extraKm100))}</td><td className="n">{formatINR(sum((r) => r.distancePaise))}</td>
                  <td className="n">{sum((r) => r.batchedTrips)}</td><td className="n">{formatINR(sum((r) => r.batchBonusPaise))}</td><td className="n">{formatINR(sum((r) => r.rainPaise))}</td><td className="n">{formatINR(sum((r) => r.festivalPaise))}</td>
                  <td className="n">{formatINR(gross)}</td><td className="n">{formatINR(gross)}</td><td className="n">{formatINR(paidTotal)}</td><td className="n">{formatINR(approvedCycle ? approvedTotal - paidTotal : gross)}</td><td></td><td></td>
                </tr>
              )}
              {!rows.length && <tr><td colSpan={30} className="note">No trips saved for this week. Import a Zomato file first.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="note">Order days use the operational date (a trip delivered after midnight counts as the next day). Tips are not part of payroll.</p>
      </section>
    </>
  );
}
