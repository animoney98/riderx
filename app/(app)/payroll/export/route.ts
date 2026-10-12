import { supabaseServer } from '@/lib/supabase-server';
import { loadWeekTrips, loadRiderInfo, resolveWeekStart } from '@/lib/week-data';
import { loadRateCard } from '@/lib/rate-card';
import { cycleFor } from '@/src/engine/calendar';
import { buildPayrollWorkbook } from '@/src/export/payrollWorkbook';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new Response('Sign in first', { status: 401 });
  const { data: profile } = await sb.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle();
  if (!profile?.active || !['super_admin', 'finance_manager', 'operations_manager'].includes(profile.role)) return new Response('Not allowed', { status: 403 });

  const week = new URL(req.url).searchParams.get('week') ?? undefined;
  const start = await resolveWeekStart(sb, week);
  const cycle = cycleFor(start);
  const [{ trips, withoutEarnings }, { card }] = await Promise.all([loadWeekTrips(sb, cycle.start, cycle.end), loadRateCard(sb, start)]);
  const riders = await loadRiderInfo(sb, [...new Set(trips.map((t) => t.feId))]);
  try {
    const { buffer } = await buildPayrollWorkbook({
      cycle, trips, riders,
      slab1Limit: card.slabs[0].upToOrder ?? 25,
      slab1RatePaise: card.slabs[0].ratePaise,
      slab2RatePaise: (card.slabs[1] ?? card.slabs[0]).ratePaise,
      status: 'DRAFT - not approved',
      generatedAt: new Date(),
      tripsWithoutEarnings: withoutEarnings,
    });
    await sb.from('audit_logs').insert({ actor_id: auth.user.id, action: 'payroll.export_draft', entity_type: 'payout_cycle', entity_id: cycle.start });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="RiderX-payroll-${cycle.start}-to-${cycle.end}-DRAFT.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(`Export stopped: ${(e as Error).message}`, { status: 500 });
  }
}
