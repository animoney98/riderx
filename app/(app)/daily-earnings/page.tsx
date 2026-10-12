import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { loadWeekTrips, loadRiderNames, resolveWeekStart } from '@/lib/week-data';
import { loadRateCard } from '@/lib/rate-card';
import { buildDaily } from '@/src/engine/weekly';
import { addDays } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { WeekPicker, fmtDate } from '../week-picker';

const km = (v: number) => (v / 100).toFixed(2);

export default async function DailyEarningsPage({ searchParams }: { searchParams: Promise<{ week?: string; fe?: string; date?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const start = await resolveWeekStart(sb, sp.week);
  const end = addDays(start, 6);
  const [{ trips, withoutEarnings }, { card }] = await Promise.all([loadWeekTrips(sb, start, end), loadRateCard(sb, start, { standardOnly: true })]);
  const slab1Limit = card.slabs[0].upToOrder ?? 25;
  const r1 = formatINR(card.slabs[0].ratePaise).replace('.00', '');
  const r2 = formatINR((card.slabs[1] ?? card.slabs[0]).ratePaise).replace('.00', '');
  const names = await loadRiderNames(sb, [...new Set(trips.map((t) => t.feId))]);

  const rows = buildDaily(trips, slab1Limit).filter((r) => !sp.fe || r.feId === sp.fe);
  const detail = sp.fe && sp.date ? trips.filter((t) => t.feId === sp.fe && t.date === sp.date).sort((a, b) => a.deliveredAt.localeCompare(b.deliveredAt)) : [];
  const total = rows.reduce((s, r) => s + r.totalPaise, 0);
  const base = `?week=${start}`;

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Daily Earnings</div>
        <h1>Earnings per rider per day</h1>
      </div>
      <WeekPicker path="/daily-earnings" start={start} />
      {withoutEarnings > 0 && <div className="alert warn">{withoutEarnings} trips this week have no calculated earnings yet. Import the file again to calculate them.</div>}
      {sp.fe && <div className="note">Showing {names.get(sp.fe) || sp.fe} only. <Link href={`/daily-earnings${base}`}>Show all riders</Link></div>}

      <section className="card">
        <h2>{rows.length} rider-days · {formatINR(total)}</h2>
        <div className="tbl">
          <table>
            <thead><tr>
              <th>Date</th><th>Rider</th><th>FE ID</th><th className="n">Orders</th><th className="n">At {r1}</th><th className="n">At {r2}</th><th className="n">Batched</th>
              <th className="n">Km</th><th className="n">Extra km</th><th className="n">Base</th><th className="n">Distance</th><th className="n">Batch</th><th className="n">Rain</th><th className="n">Festival</th><th className="n">Total</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.feId + r.date}>
                  <td>{fmtDate(r.date)}</td><td>{names.get(r.feId) || <span className="pill p-warn">Not registered</span>}</td><td>{r.feId}</td>
                  <td className="n">{r.orders}</td><td className="n">{r.slab1Orders}</td><td className="n">{r.slab2Orders}</td><td className="n">{r.batchedTrips}</td>
                  <td className="n">{km(r.km100)}</td><td className="n">{km(r.extraKm100)}</td>
                  <td className="n">{formatINR(r.basePaise)}</td><td className="n">{formatINR(r.distancePaise)}</td><td className="n">{formatINR(r.batchBonusPaise)}</td>
                  <td className="n">{formatINR(r.rainPaise)}</td><td className="n">{formatINR(r.festivalPaise)}</td><td className="n"><b>{formatINR(r.totalPaise)}</b></td>
                  <td><Link href={`/daily-earnings${base}&fe=${r.feId}&date=${r.date}`}>Trips</Link></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={16} className="note">No trips saved for this week. Import a Zomato file first.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="note">Rain and festival show ₹0 until rates are set. Penalties are not applied yet. Km is pickup plus drop; extra km is what exceeds the 6 km allowance per trip.</p>
      </section>

      {detail.length > 0 && (
        <section className="card">
          <h2>{names.get(sp.fe!) || sp.fe} · {fmtDate(sp.date!)} · trip by trip</h2>
          <div className="tbl">
            <table>
              <thead><tr><th>Trip ID</th><th>Delivered</th><th className="n">Orders</th><th className="n">Order rank</th><th className="n">Pickup km</th><th className="n">Drop km</th><th className="n">Extra km</th><th className="n">Base</th><th className="n">Distance</th><th className="n">Batch</th><th className="n">Total</th></tr></thead>
              <tbody>
                {detail.map((t) => (
                  <tr key={t.tripId}>
                    <td>{t.tripId}</td><td>{t.deliveredAt}</td><td className="n">{t.orders}</td>
                    <td className="n">{t.firstRank === t.lastRank ? t.firstRank : `${t.firstRank}-${t.lastRank}`}</td>
                    <td className="n">{km(t.pickupKm100)}</td><td className="n">{km(t.dropKm100)}</td><td className="n">{km(t.extraKm100)}</td>
                    <td className="n">{formatINR(t.basePaise)}</td><td className="n">{formatINR(t.distancePaise)}</td><td className="n">{formatINR(t.batchBonusPaise)}</td><td className="n"><b>{formatINR(t.totalPaise)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
