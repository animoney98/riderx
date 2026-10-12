import { supabaseServer } from '@/lib/supabase-server';
import { loadWeekTrips, loadRiderNames, resolveWeekStart } from '@/lib/week-data';
import { loadRateCard } from '@/lib/rate-card';
import { buildWeekly } from '@/src/engine/weekly';
import { addDays, cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { WeekPicker } from '../week-picker';

const km = (v: number) => (v / 100).toFixed(2);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const start = await resolveWeekStart(sb, sp.week);
  const cycle = cycleFor(start);
  const [{ trips, withoutEarnings }, { card }] = await Promise.all([loadWeekTrips(sb, cycle.start, cycle.end), loadRateCard(sb, start)]);
  const slab1Limit = card.slabs[0].upToOrder ?? 25;
  const r1 = formatINR(card.slabs[0].ratePaise).replace('.00', '');
  const r2 = formatINR((card.slabs[1] ?? card.slabs[0]).ratePaise).replace('.00', '');
  const rows = buildWeekly(trips, cycle, slab1Limit);
  const names = await loadRiderNames(sb, rows.map((r) => r.feId));

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const gross = sum((r) => r.grossPaise);
  const unregistered = rows.filter((r) => !names.has(r.feId)).length;
  const cards: [string, string][] = [
    ['Riders in this cycle', String(rows.length)],
    ['Total orders', String(sum((r) => r.orders))],
    ['Gross rider earnings', formatINR(gross)],
    ['Incentives and bonuses', formatINR(sum((r) => r.incentivesPaise))],
    ['Additions / deductions', '₹0.00 / ₹0.00'],
    ['Net salary payable (draft)', formatINR(gross)],
    ['Approved', 'Not approved yet'],
    ['Paid', '₹0.00'],
  ];

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Salary & Payroll</div>
        <h1>Weekly rider salary</h1>
      </div>
      <WeekPicker path="/payroll" start={cycle.start} payDate={cycle.payDate} />
      <div>
        <a className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#141414' }} href={`/payroll/export?week=${cycle.start}`}>Download Payroll Excel (draft)</a>
      </div>
      <div className="alert warn">
        <b>Draft.</b> These figures are calculated live from saved trips. Penalties, approval, payment recording and the Excel download are the next steps; until then nothing here is final.
      </div>
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
                  <td className="n">{formatINR(r.grossPaise)}</td><td className="n"><b>{formatINR(r.grossPaise)}</b></td><td className="n">₹0.00</td><td className="n">{formatINR(r.grossPaise)}</td>
                  <td>{cycle.payDate}</td><td><span className="pill p-warn">Draft</span></td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr style={{ fontWeight: 800, background: '#F6F5F3' }}>
                  <td colSpan={3}>Total ({rows.length} riders)</td>
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => <td key={d} className="n">{sum((r) => r.ordersByDay[d]) || '–'}</td>)}
                  <td className="n">{sum((r) => r.orders)}</td><td className="n">{sum((r) => r.slab1Orders)}</td><td className="n">{sum((r) => r.slab2Orders)}</td><td className="n">{formatINR(sum((r) => r.basePaise))}</td>
                  <td className="n">{km(sum((r) => r.km100))}</td><td className="n">{km(sum((r) => r.extraKm100))}</td><td className="n">{formatINR(sum((r) => r.distancePaise))}</td>
                  <td className="n">{sum((r) => r.batchedTrips)}</td><td className="n">{formatINR(sum((r) => r.batchBonusPaise))}</td><td className="n">{formatINR(sum((r) => r.rainPaise))}</td><td className="n">{formatINR(sum((r) => r.festivalPaise))}</td>
                  <td className="n">{formatINR(gross)}</td><td className="n">{formatINR(gross)}</td><td className="n">₹0.00</td><td className="n">{formatINR(gross)}</td><td></td><td></td>
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
