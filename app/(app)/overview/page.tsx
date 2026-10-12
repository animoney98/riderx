import { supabaseServer } from '@/lib/supabase-server';
import { resolveWeekStart, loadRiderNames, loadBankDetails, loadWeekTrips } from '@/lib/week-data';
import { loadWeekFinance, loadReceipts } from '@/lib/finance';
import { loadPayouts } from '@/lib/payments';
import { addDays, cycleFor } from '@/src/engine/calendar';
import { OverviewView, type OverviewData } from './view';

const outstanding = (pay: Awaited<ReturnType<typeof loadPayouts>>) => (pay ? pay.payouts.reduce((s, p) => s + p.outstandingPaise, 0) : null);

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
  const { trips } = await loadWeekTrips(sb, cur.c.start, cur.c.end);

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
  const sum = (f: (x: (typeof trips)[number]) => number) => trips.reduce((s, x) => s + f(x), 0);
  const prev = data[1];
  const view: OverviewData = {
    weekStart: cur.c.start, weekEnd: cur.c.end,
    activeRiders: riderCount ?? 0, ridersWithOrders: cur.fin.rows.length, orders: t.orders,
    revenuePaise: t.revenuePaise, riderPaise: t.riderPaise, marginPaise: t.marginPaise, marginPct: t.marginPct,
    prevRevenuePaise: prev.fin.rows.length ? prev.fin.totals.revenuePaise : null,
    approved: !!cur.pay, outstandingPaise: outstanding(cur.pay),
    split: { basePaise: sum((x) => x.basePaise), distancePaise: sum((x) => x.distancePaise), batchPaise: sum((x) => x.batchBonusPaise), rainPaise: sum((x) => x.rainPaise), festivalPaise: sum((x) => x.festivalPaise) },
    alerts,
    weeks: data.filter((d) => d.fin.rows.length).map((d) => ({
      start: d.c.start, orders: d.fin.totals.orders, revenuePaise: d.fin.totals.revenuePaise, riderPaise: d.fin.totals.riderPaise, marginPaise: d.fin.totals.marginPaise,
      approved: !!d.pay, outstandingPaise: outstanding(d.pay), toReceivePaise: d.fin.totals.revenuePaise - d.received,
    })),
  };
  return <OverviewView d={view} />;
}
