import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveWeekStart, loadRiderNames } from '@/lib/week-data';
import { loadRiderDays } from '@/lib/finance';
import { cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { rupeesToPaise } from '@/src/engine/rateCardForm';
import { applyTargets, validateTarget, type DayTarget } from '@/src/engine/targets';
import { WeekPicker } from '../week-picker';

const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

async function saveTarget(formData: FormData) {
  'use server';
  const back = (q: string): never => redirect(`/daily-targets?${q}`);
  const date = String(formData.get('date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back('error=Choose+a+date');
  let target: DayTarget;
  try {
    const tiers = [1, 2, 3, 4].map((n) => ({ o: String(formData.get(`orders${n}`) ?? '').trim(), r: String(formData.get(`rate${n}`) ?? '').trim() }))
      .filter((t) => t.o || t.r).map((t) => {
        if (!t.o || !t.r) throw new Error('Fill both the orders and the rate for each tier, or leave the row empty');
        return { minOrders: Number(t.o), ratePaise: rupeesToPaise(t.r, 'Tier rate') };
      });
    target = { date, baseRatePaise: rupeesToPaise(String(formData.get('base')), 'Standard rate'), batchBonusPaise: rupeesToPaise(String(formData.get('batch')), 'Batch bonus'), tiers };
    if (!tiers.length) throw new Error('Add at least one tier');
    validateTarget(target);
  } catch (e) { return back(`error=${encodeURIComponent((e as Error).message)}`); }

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: before } = await sb.from('zomato_daily_targets').select('*').eq('target_date', date).maybeSingle();

  let picture_path = (before?.picture_path as string | null) ?? null;
  const file = formData.get('picture') as File | null;
  if (file && file.size > 0) {
    if (!file.type.startsWith('image/')) back('error=The+picture+must+be+an+image');
    if (file.size > 5 * 1024 * 1024) back('error=The+picture+must+be+under+5+MB');
    const path = `${date}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const { error: up } = await sb.storage.from('target-pictures').upload(path, file, { contentType: file.type });
    if (up) back(`error=${encodeURIComponent('Could not upload the picture: ' + up.message)}`);
    picture_path = path;
  }
  const row = {
    target_date: date, base_rate_paise: target.baseRatePaise, batch_bonus_paise: target.batchBonusPaise, tiers: target.tiers, picture_path,
    notes: String(formData.get('notes') ?? '').trim() || null, updated_by: auth.user?.id, updated_at: new Date().toISOString(), ...(before ? {} : { created_by: auth.user?.id }),
  };
  const { error } = await sb.from('zomato_daily_targets').upsert(row, { onConflict: 'target_date' });
  if (error) back('error=Could+not+save.+Check+your+role');
  await sb.from('audit_logs').insert({ actor_id: auth.user?.id, action: before ? 'zomato.target_update' : 'zomato.target_create', entity_type: 'zomato_daily_target', entity_id: date, before_values: before ?? null, after_values: row });
  revalidatePath('/daily-targets');
  back(`week=${cycleFor(date).start}&saved=1`);
}

async function removeTarget(formData: FormData) {
  'use server';
  const date = String(formData.get('date'));
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: before } = await sb.from('zomato_daily_targets').select('*').eq('target_date', date).maybeSingle();
  await sb.from('zomato_daily_targets').delete().eq('target_date', date);
  await sb.from('audit_logs').insert({ actor_id: auth.user?.id, action: 'zomato.target_remove', entity_type: 'zomato_daily_target', entity_id: date, before_values: before });
  revalidatePath('/daily-targets');
  redirect(`/daily-targets?week=${cycleFor(date).start}`);
}

export default async function DailyTargetsPage({ searchParams }: { searchParams: Promise<{ week?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const start = await resolveWeekStart(sb, sp.week);
  const cycle = cycleFor(start);
  const { data: rows } = await sb.from('zomato_daily_targets').select('*').gte('target_date', cycle.start).lte('target_date', cycle.end).order('target_date');
  const targets: (DayTarget & { picture: string | null; notes: string | null })[] = (rows ?? []).map((r) => ({
    date: r.target_date as string, baseRatePaise: Number(r.base_rate_paise), batchBonusPaise: Number(r.batch_bonus_paise), tiers: r.tiers as DayTarget['tiers'], picture: r.picture_path as string | null, notes: r.notes as string | null,
  }));
  const days = targets.length ? await loadRiderDays(sb, cycle.start, cycle.end) : [];
  const results = applyTargets(days, targets);
  const names = await loadRiderNames(sb, [...new Set(results.map((r) => r.feId))]);
  const urls = new Map<string, string>();
  for (const t of targets) if (t.picture) { const { data } = await sb.storage.from('target-pictures').createSignedUrl(t.picture, 3600); if (data) urls.set(t.date, data.signedUrl); }
  const extraTotal = results.reduce((s, r) => s + r.extraPaise, 0);
  const diffTotal = results.reduce((s, r) => s + r.differencePaise, 0);
  const sameDayRows = (d: string) => results.filter((r) => r.date === d);

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Zomato Daily Targets</div>
        <h1>Extra money from Zomato’s daily targets</h1>
        <div className="note">This is your revenue only. Rider pay does not change.</div>
      </div>
      <WeekPicker path="/daily-targets" start={cycle.start} />
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.saved && <div className="alert ok">Target saved.</div>}

      <section className="grid">
        <div className="stat"><span>Days with a target this week</span><b>{targets.length}</b></div>
        <div className="stat"><span>Extra earned from targets</span><b>{formatINR(extraTotal)}</b></div>
        <div className="stat"><span>File paid vs targets say</span><b>{formatINR(diffTotal)}</b></div>
      </section>

      <form action={saveTarget} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Add or change a day’s target</h2>
        <div className="row">
          <label>Date<input type="date" name="date" required defaultValue={todayIST()} /></label>
          <label>Standard Zomato rate per order (₹)<input name="base" required defaultValue="60" inputMode="decimal" /></label>
          <label>Zomato batch bonus (₹)<input name="batch" required defaultValue="30" inputMode="decimal" /></label>
        </div>
        {[1, 2, 3, 4].map((n) => (
          <div className="row" key={n}>
            <label>Tier {n}: orders in the day<input name={`orders${n}`} inputMode="numeric" placeholder={n === 1 ? 'e.g. 50' : ''} /></label>
            <label>Rate for all that day’s orders (₹)<input name={`rate${n}`} inputMode="decimal" placeholder={n === 1 ? 'e.g. 70' : ''} /></label>
          </div>
        ))}
        <div className="row">
          <label>Picture of the targets (optional)<input type="file" name="picture" accept="image/*" /></label>
          <label>Notes (optional)<input name="notes" /></label>
        </div>
        <p className="note">Each rider is checked separately: if a rider reaches the number of orders in a tier, all of that rider’s trips that day are paid at the tier rate. Saving again for the same date replaces it. Leave a tier row empty if you don’t need it.</p>
        <div><button type="submit">Save target</button></div>
      </form>

      {targets.map((t) => (
        <section className="card" key={t.date}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h2>{t.date}</h2>
            <form action={removeTarget}><input type="hidden" name="date" value={t.date} /><button type="submit" className="ghost" style={{ minHeight: 36 }}>Remove target</button></form>
          </div>
          <p>Standard {formatINR(t.baseRatePaise)}. {[...t.tiers].sort((a, b) => a.minOrders - b.minOrders).map((x) => `${x.minOrders}+ orders = ${formatINR(x.ratePaise)}`).join(' · ')}.{t.notes ? ` ${t.notes}` : ''}</p>
          {urls.get(t.date) && <p><a href={urls.get(t.date)} target="_blank" rel="noreferrer">View the picture</a></p>}
          <div className="tbl"><table>
            <thead><tr><th>Rider</th><th>FE ID</th><th className="n">Orders</th><th className="n">Trips</th><th>Tier reached</th><th className="n">Rate</th><th className="n">Should be</th><th className="n">File paid</th><th className="n">Extra from target</th></tr></thead>
            <tbody>
              {sameDayRows(t.date).map((r) => (
                <tr key={r.feId}>
                  <td><b>{names.get(r.feId) || '—'}</b></td><td>{r.feId}</td><td className="n">{r.orders}</td><td className="n">{r.trips}</td>
                  <td>{r.tierMin ? `${r.tierMin}+ orders` : 'None'}</td><td className="n">{formatINR(r.ratePaise)}</td><td className="n">{formatINR(r.expectedPaise)}</td>
                  <td className="n" style={{ color: r.differencePaise !== 0 ? '#B3261E' : undefined }}>{formatINR(r.actualPaise)}</td><td className="n"><b>{formatINR(r.extraPaise)}</b></td>
                </tr>
              ))}
              {!sameDayRows(t.date).length && <tr><td colSpan={9} className="note">No trips imported for this day yet.</td></tr>}
            </tbody>
          </table></div>
          <p className="note">“Should be” = trips × rate, plus the batch bonus for each batched trip. If “File paid” is red, the Zomato file paid a different amount than the tiers say; check the target or the file. Your actual revenue elsewhere in the app always comes from the file.</p>
        </section>
      ))}
    </>
  );
}
