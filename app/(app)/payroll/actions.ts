'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { loadWeekTrips, loadRiderNames } from '@/lib/week-data';
import { loadRateCard } from '@/lib/rate-card';
import { cycleFor } from '@/src/engine/calendar';
import { buildWeekly } from '@/src/engine/weekly';

export async function approvePayroll(formData: FormData) {
  const week = String(formData.get('week') ?? '');
  const total = Number(formData.get('expectedTotal'));
  const back = (q: string) => redirect(`/payroll?week=${week}&${q}`);
  if (formData.get('confirm') !== 'on') back('error=Tick+the+box+to+confirm+you+have+checked+the+figures');
  const sb = await supabaseServer();
  const cycle = cycleFor(week);
  if (cycle.start !== week) back('error=Invalid+week');
  const [{ trips, withoutEarnings }, { id: cardId, card }] = await Promise.all([loadWeekTrips(sb, cycle.start, cycle.end), loadRateCard(sb, week, { standardOnly: true })]);
  if (!cardId) back('error=No+active+rate+card');
  if (withoutEarnings > 0) back('error=Some+trips+have+no+calculated+earnings.+Import+again+first');
  const rows = buildWeekly(trips, cycle, card.slabs[0].upToOrder ?? 25);
  const names = await loadRiderNames(sb, rows.map((r) => r.feId));
  if (rows.some((r) => !names.has(r.feId))) back('error=Some+FE+IDs+are+not+registered+riders');
  const gross = rows.reduce((s, r) => s + r.grossPaise, 0);
  if (gross !== total) back('error=The+figures+changed+since+you+opened+this+page.+Refresh+and+check+again');
  if (!rows.length) back('error=Nothing+to+approve');
  const { error } = await sb.rpc('approve_payroll_cycle', {
    p_period_start: cycle.start,
    p_rate_card_id: cardId,
    p_rows: rows.map((r) => ({ fe_id: r.feId, gross_paise: r.grossPaise, snapshot: { ...r, fe_id: r.feId, trips: trips.filter((t) => t.feId === r.feId && t.date >= cycle.start && t.date <= cycle.end).length } })),
  });
  if (error) back(`error=${encodeURIComponent('Not approved: ' + error.message)}`);
  revalidatePath('/payroll');
  back('approved=1');
}
