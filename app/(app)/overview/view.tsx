import Link from 'next/link';
import { Icon } from '../icons';
import { Donut, WeeklyBars, type Slice } from './chart';
import { formatINR } from '@/src/engine/payout';

export interface WeekRow { start: string; orders: number; revenuePaise: number; riderPaise: number; marginPaise: number; approved: boolean; outstandingPaise: number | null; toReceivePaise: number }
export interface OverviewData {
  weekStart: string;
  weekEnd: string;
  activeRiders: number;
  ridersWithOrders: number;
  orders: number;
  revenuePaise: number;
  riderPaise: number;
  marginPaise: number;
  marginPct: number | null;
  prevRevenuePaise: number | null;
  approved: boolean;
  outstandingPaise: number | null;
  split: { basePaise: number; distancePaise: number; batchPaise: number; rainPaise: number; festivalPaise: number };
  alerts: { text: string; href: string }[];
  weeks: WeekRow[]; // newest first, only weeks with trips
}

const SPLIT_COLORS = ['#F4F6F6', '#F39A3D', '#7FA3A6', '#C2573A', '#8A9496'];

export function OverviewView({ d }: { d: OverviewData }) {
  const sp = d.split;
  const parts: Slice[] = [
    { label: 'Base pay', paise: sp.basePaise, color: SPLIT_COLORS[0] },
    { label: 'Extra-km pay', paise: sp.distancePaise, color: SPLIT_COLORS[1] },
    { label: 'Batch bonus', paise: sp.batchPaise, color: SPLIT_COLORS[2] },
    { label: 'Rain', paise: sp.rainPaise, color: SPLIT_COLORS[3] },
    { label: 'Festival', paise: sp.festivalPaise, color: SPLIT_COLORS[4] },
  ].filter((p) => p.paise > 0);
  const splitTotal = parts.reduce((s, p) => s + p.paise, 0);
  const splitMatches = splitTotal === d.riderPaise;
  const delta = d.prevRevenuePaise === null ? null : d.revenuePaise - d.prevRevenuePaise;
  const share = d.revenuePaise > 0 ? Math.round((d.riderPaise * 1000) / d.revenuePaise) / 10 : null;
  return (
    <>
      <div>
        <h1 style={{ fontSize: 34 }}>Overview</h1>
        <div className="note">Week of {d.weekStart} to {d.weekEnd}, the latest week with imported trips. Every figure comes from the same saved trips as the other pages.</div>
      </div>
      <div className="ov">
        <div className="ov-left">
          <div className="ov-row a">
            <section className="hero">
              <div>
                <div className="lbl">Zomato payout this week</div>
                <div className="big">{formatINR(d.revenuePaise)}</div>
                <div className="sub">
                  {delta === null ? 'First week on record' : `${delta >= 0 ? '+' : '−'}${formatINR(Math.abs(delta))} compared with the week before`}
                  {' · '}{d.orders} orders from {d.ridersWithOrders} riders
                </div>
              </div>
              <div className="acts">
                <Link className="dark" href={`/payroll?week=${d.weekStart}`}>Review payroll</Link>
                <Link className="light" href={`/reconciliation?week=${d.weekStart}`}>Zomato reconciliation</Link>
              </div>
            </section>
            <div className="mini">
              <div className="tile">
                <div className="t">Rider earnings</div>
                <div className="v">{formatINR(d.riderPaise)}</div>
                <div className="s">This week</div>
                {share !== null && <span className="chip v">{share}% of payout</span>}
              </div>
              <div className="tile">
                <div className="t">Margin</div>
                <div className="v">{formatINR(d.marginPaise)}</div>
                <div className="s">Payout minus rider earnings</div>
                {d.marginPct !== null && <span className={d.marginPaise >= 0 ? 'chip' : 'chip r'}>{d.marginPct}%</span>}
              </div>
            </div>
          </div>

          <div className="ov-row b">
            <section className="card">
              <div className="cardhead"><h2>Weekly flow</h2><span className="chipbtn">Last 8 weeks</span></div>
              <WeeklyBars bars={[...d.weeks].reverse().map((w) => ({ label: w.start.slice(5), revenuePaise: w.revenuePaise, riderPaise: w.riderPaise }))} />
            </section>
            <section className="card">
              <div className="cardhead"><h2>Rider pay split</h2><span className="chipbtn">This week</span></div>
              {parts.length ? (
                <div className="donutwrap">
                  <Donut slices={parts} centerLabel="Total" centerValue={formatINR(splitTotal).replace(/\.00$/, '')} />
                  <div className="dlegend">
                    {parts.map((p) => (
                      <div key={p.label}>
                        <i style={{ background: p.color }} />
                        <span>{p.label}<small>{formatINR(p.paise)}</small></span>
                        <b>{Math.round((p.paise * 100) / splitTotal)}%</b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="note">No earnings calculated for this week yet.</p>}
              {!splitMatches && parts.length > 0 && <div className="alert warn" style={{ marginTop: 12 }}>The split adds up to {formatINR(splitTotal)} but rider earnings are {formatINR(d.riderPaise)}. Check Imports &amp; Data Quality.</div>}
            </section>
          </div>

          <section className="card">
            <div className="cardhead"><h2>Recent weeks</h2></div>
            <div className="tbl"><table>
              <thead><tr><th>Week</th><th className="n">Orders</th><th className="n">Zomato payout</th><th className="n">Rider earnings</th><th className="n">Margin</th><th>Payroll</th><th className="n">Rider pay outstanding</th><th className="n">Zomato to receive</th></tr></thead>
              <tbody>
                {d.weeks.map((w) => (
                  <tr key={w.start}>
                    <td><Link href={`/payroll?week=${w.start}`}>{w.start}</Link></td><td className="n">{w.orders}</td><td className="n">{formatINR(w.revenuePaise)}</td>
                    <td className="n">{formatINR(w.riderPaise)}</td><td className="n">{formatINR(w.marginPaise)}</td>
                    <td><span className={w.approved ? 'pill p-ok' : 'pill p-warn'}>{w.approved ? 'Approved' : 'Draft'}</span></td>
                    <td className="n">{w.outstandingPaise === null ? '—' : formatINR(w.outstandingPaise)}</td>
                    <td className="n">{formatINR(w.toReceivePaise)}</td>
                  </tr>
                ))}
                {!d.weeks.length && <tr><td colSpan={8} className="note">No trips imported yet.</td></tr>}
              </tbody>
            </table></div>
          </section>
        </div>

        <aside className="ov-side">
          <section className="card">
            <div className="cardhead"><h2>Needs attention</h2>{d.alerts.length > 0 && <span className="chipbtn">{d.alerts.length}</span>}</div>
            {d.alerts.length ? (
              <ul className="alist">
                {d.alerts.map((a) => (
                  <li key={a.text}><Link href={a.href}><span className="ic"><Icon name="alert" /></span><span style={{ flex: 1 }}>{a.text}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></Link></li>
                ))}
              </ul>
            ) : <ul className="alist"><li className="ok">Nothing needs attention.</li></ul>}
          </section>
          <section className="card">
            <div className="cardhead"><h2>This week at a glance</h2></div>
            <div className="kv">
              <div><span>Active riders</span><b>{d.activeRiders}</b></div>
              <div><span>Riders with orders</span><b>{d.ridersWithOrders}</b></div>
              <div><span>Orders</span><b>{d.orders}</b></div>
              <div><span>Payroll</span><span className={d.approved ? 'pill p-ok' : 'pill p-warn'}>{d.approved ? 'Approved' : 'Draft'}</span></div>
              <div><span>Rider pay outstanding</span><b>{d.outstandingPaise === null ? '—' : formatINR(d.outstandingPaise)}</b></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
