import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveWeekStart, loadRiderNames, loadBankDetails } from '@/lib/week-data';
import { loadWeekFinance, loadReceipts } from '@/lib/finance';
import { loadPayouts } from '@/lib/payments';
import { WeeklyBars } from './chart';
import { addDays, cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';

export default async function Overview() {
  const sb = await supabaseServer();
  const latest = await resolveWeekStart(sb);
  const weeks = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => addDays(latest, -7 * i));
  const data = await Promise.all(weeks.map(async (w) => {
    const c = cycleFor(w);
    const [fin, pay, rec] = await Promise.all([loadWeekFinance(sb, c.start, c.end), loadPayouts(sb, c.start), loadReceipts(sb, c.start)]);
    return { c, fin, pay, received: rec.reduce((s, r) => s + r.amountPaise, 0) };
  }));
  const cur = data[0];
  const names = await loadRiderNames(sb, cur.fin.rows.map((r) => r.feId));
  const bank = await loadBankDetails(sb, cur.fin.rows.map((r) => r.feId));
  const { count: riderCount } = await sb.from('riders').select('id', { count: 'exact', head: true }).eq('status', 'active');

  const alerts: { text: string; href: string }[] = [];
  const unreg = cur.fin.rows.filter((r) => !names.has(r.feId)).length;
  if (unreg) alerts.push({ text: `${unreg} FE IDs in the latest week are not registered riders`, href: '/riders' });
  if (cur.fin.withoutEarnings) alerts.push({ text: `${cur.fin.withoutEarnings} trips in the latest week have no calculated earnings`, href: '/imports' });
  const noBank = cur.fin.rows.filter((r) => names.has(r.feId) && !bank.has(r.feId)).length;
  if (noBank) alerts.push({ text: `${noBank} riders in the latest week have no checked bank details`, href: '/riders' });
  if (cur.fin.rows.length && !cur.pay) alerts.push({ text: `Latest week (${cur.c.start}) is not approved yet`, href: `/payroll?week=${cur.c.start}` });
  if (cur.pay && cur.pay.payouts.some((p) => p.outstandingPaise > 0)) alerts.push({ text: `Rider payments are outstanding for the week of ${cur.c.start}`, href: `/payroll/payments?week=${cur.c.start}` });
  if (cur.fin.totals.revenuePaise > cur.received && cur.fin.rows.length) alerts.push({ text: `Zomato money for the week of ${cur.c.start} is not fully received`, href: `/reconciliation?week=${cur.c.start}` });

  const t = cur.fin.totals;
  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Overview</div>
        <h1>Week of {cur.c.start}</h1>
        <div className="note">The latest week with imported trips. Everything here comes from the same saved trips as the other pages.</div>
      </div>
      <section className="grid">
        <div className="stat"><span>Active riders</span><b>{riderCount ?? 0}</b></div>
        <div className="stat"><span>Riders with orders</span><b>{cur.fin.rows.length}</b></div>
        <div className="stat"><span>Orders</span><b>{t.orders}</b></div>
        <div className="stat"><span>Zomato payout</span><b>{formatINR(t.revenuePaise)}</b></div>
        <div className="stat"><span>Rider earnings</span><b>{formatINR(t.riderPaise)}</b></div>
        <div className="stat"><span>Margin</span><b>{formatINR(t.marginPaise)}{t.marginPct !== null ? ` (${t.marginPct}%)` : ''}</b></div>
        <div className="stat"><span>Payroll</span><b>{cur.pay ? 'Approved' : 'Draft'}</b></div>
        <div className="stat"><span>Rider pay outstanding</span><b>{cur.pay ? formatINR(cur.pay.payouts.reduce((s, p) => s + p.outstandingPaise, 0)) : '—'}</b></div>
      </section>

      <section className="card">
        <h2>Needs attention</h2>
        {alerts.length ? <ul>{alerts.map((a) => <li key={a.text}><Link href={a.href}>{a.text}</Link></li>)}</ul> : <p>Nothing needs attention.</p>}
      </section>

      <section className="card">
        <h2>Last 8 weeks</h2>
        <WeeklyBars bars={data.filter((d) => d.fin.rows.length).reverse().map((d) => ({ label: d.c.start.slice(5), revenuePaise: d.fin.totals.revenuePaise, riderPaise: d.fin.totals.riderPaise }))} />
        <div className="tbl"><table>
          <thead><tr><th>Week</th><th className="n">Orders</th><th className="n">Zomato payout</th><th className="n">Rider earnings</th><th className="n">Margin</th><th>Payroll</th><th className="n">Rider pay outstanding</th><th className="n">Zomato to receive</th></tr></thead>
          <tbody>
            {data.filter((d) => d.fin.rows.length).map((d) => (
              <tr key={d.c.start}>
                <td><Link href={`/payroll?week=${d.c.start}`}>{d.c.start}</Link></td><td className="n">{d.fin.totals.orders}</td><td className="n">{formatINR(d.fin.totals.revenuePaise)}</td>
                <td className="n">{formatINR(d.fin.totals.riderPaise)}</td><td className="n">{formatINR(d.fin.totals.marginPaise)}</td>
                <td><span className={d.pay ? 'pill p-ok' : 'pill p-warn'}>{d.pay ? 'Approved' : 'Draft'}</span></td>
                <td className="n">{d.pay ? formatINR(d.pay.payouts.reduce((s, p) => s + p.outstandingPaise, 0)) : '—'}</td>
                <td className="n">{formatINR(d.fin.totals.revenuePaise - d.received)}</td>
              </tr>
            ))}
            {!data.some((d) => d.fin.rows.length) && <tr><td colSpan={8} className="note">No trips imported yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
