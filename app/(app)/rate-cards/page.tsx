import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { loadRateCard } from '@/lib/rate-card';
import { recalculateFrom } from '@/lib/earnings';
import { cycleFor } from '@/src/engine/calendar';
import { formatINR, type RateCard } from '@/src/engine/payout';
import { buildRateCard } from '@/src/engine/rateCardForm';

async function createVersion(formData: FormData) {
  'use server';
  const back = (q: string): never => redirect(`/rate-cards?${q}`);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  if (!me?.active || me.role !== 'super_admin') back('error=Only+an+admin+can+change+rates');

  const effective = String(formData.get('effective') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || cycleFor(effective).start !== effective) back('error=The+start+date+must+be+a+Monday');
  if (formData.get('confirm') !== 'on') back('error=Tick+the+box+to+confirm');

  const { data: all } = await sb.from('rate_cards').select('id, version, effective_start, status, configuration').order('version', { ascending: false });
  const latest = (all ?? [])[0];
  if (!latest) back('error=No+existing+rate+card+found.+Run+migration+0002');
  if (effective <= (latest!.effective_start as string)) back(`error=${encodeURIComponent('The new rates must start after the current ones, which start on ' + latest!.effective_start)}`);

  const { data: approved } = await sb.from('payout_cycles').select('period_start').gte('period_start', effective).limit(1);
  if (approved?.length) back(`error=${encodeURIComponent('The week of ' + approved[0].period_start + ' is already approved. Choose a start date after the last approved week')}`);

  const prev = latest!.configuration as RateCard;
  let card: RateCard;
  try {
    card = buildRateCard({
      name: prev.name, version: (latest!.version as number) + 1,
      firstSlabOrders: String(formData.get('firstSlabOrders')), firstSlabRate: String(formData.get('firstSlabRate')), laterRate: String(formData.get('laterRate')),
      includedKm: String(formData.get('includedKm')), extraKmRate: String(formData.get('extraKmRate')), batchBonus: String(formData.get('batchBonus')),
      rainPerOrder: String(formData.get('rain')), festivalPerOrder: String(formData.get('festival')), batchedTripBaseOrders: prev.batchedTripBaseOrders ?? 1,
    });
  } catch (e) { return back(`error=${encodeURIComponent((e as Error).message)}`); }

  const dayBefore = new Date(Date.parse(effective + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const { error: e1 } = await sb.from('rate_cards').update({ effective_end: dayBefore }).eq('id', latest!.id);
  if (e1) back('error=Could+not+save.+Only+an+admin+can+change+rates');
  const { data: created, error: e2 } = await sb.from('rate_cards').insert({
    name: card.name, version: card.version, effective_start: effective, status: 'active', configuration: card, created_by: auth.user!.id, approved_by: auth.user!.id,
  }).select('id').single();
  if (e2 || !created) {
    await sb.from('rate_cards').update({ effective_end: null }).eq('id', latest!.id); // undo
    back('error=Could+not+save+the+new+rates');
  }
  await sb.from('audit_logs').insert({ actor_id: auth.user!.id, action: 'rate_card.create', entity_type: 'rate_card', entity_id: created!.id, before_values: prev, after_values: { ...card, effective_start: effective } });
  try {
    await recalculateFrom(sb, effective, (ws) => loadRateCard(sb, ws));
  } catch (e) {
    back(`error=${encodeURIComponent('Rates saved, but earnings could not be recalculated: ' + (e as Error).message + '. Import a Zomato file again to retry.')}`);
  }
  revalidatePath('/rate-cards');
  back('saved=1');
}

const rupees = (p: number) => (p / 100).toString();

export default async function RateCardsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role').eq('id', auth.user?.id ?? '').maybeSingle();
  const isAdmin = me?.role === 'super_admin';
  const { data: cards } = await sb.from('rate_cards').select('id, name, version, effective_start, effective_end, status, configuration').order('version', { ascending: false });
  const cur = (cards ?? [])[0]?.configuration as RateCard | undefined;
  const nextMonday = cycleFor(new Date(Date.now() + 5.5 * 3600 * 1000 + 7 * 86400000).toISOString().slice(0, 10)).start;
  const slab = (c: RateCard) => `${formatINR(c.slabs[0].ratePaise).replace('.00', '')} for orders 1–${c.slabs[0].upToOrder}, then ${formatINR(c.slabs[1].ratePaise).replace('.00', '')}`;
  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Rate Cards</div>
        <h1>Rider pay rates</h1>
      </div>
      {sp.error && <div className="alert bad" role="alert">{sp.error}</div>}
      {sp.saved && <div className="alert ok">New rates saved and earnings recalculated from the start date.</div>}

      <section className="card">
        <h2>Rate history</h2>
        <div className="tbl"><table>
          <thead><tr><th>Version</th><th>From</th><th>To</th><th>Base pay</th><th>Included km</th><th>Extra km</th><th>Batch bonus</th><th>Rain / order</th><th>Festival / order</th></tr></thead>
          <tbody>
            {(cards ?? []).map((r) => {
              const c = r.configuration as RateCard;
              return (
                <tr key={r.id as string}>
                  <td><b>v{r.version as number}</b></td><td>{r.effective_start as string}</td><td>{(r.effective_end as string | null) ?? 'Current'}</td><td>{slab(c)}</td>
                  <td>{c.includedKm100 / 100} km</td><td>{formatINR(c.extraKmRatePaise)}/km</td><td>{formatINR(c.batchBonusPaise)}</td>
                  <td>{formatINR(c.rainBonusPaisePerOrder)}</td><td>{formatINR(c.festivalBonusPaisePerOrder)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="note">Each week is paid with the rates in force on its Monday. Old versions are kept so past weeks can always be explained.</p>
      </section>

      {isAdmin && cur ? (
        <form action={createVersion} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Change the rates</h2>
          <div className="row">
            <label>Starts on (a Monday)<input type="date" name="effective" required defaultValue={nextMonday} /></label>
          </div>
          <div className="row">
            <label>Orders paid at the first rate (per day)<input name="firstSlabOrders" required defaultValue={cur.slabs[0].upToOrder ?? 25} inputMode="numeric" /></label>
            <label>First rate per order (₹)<input name="firstSlabRate" required defaultValue={rupees(cur.slabs[0].ratePaise)} inputMode="decimal" /></label>
            <label>Rate per order after that (₹)<input name="laterRate" required defaultValue={rupees(cur.slabs[1].ratePaise)} inputMode="decimal" /></label>
          </div>
          <div className="row">
            <label>Distance included (km, pickup + drop)<input name="includedKm" required defaultValue={cur.includedKm100 / 100} inputMode="decimal" /></label>
            <label>Per extra km (₹)<input name="extraKmRate" required defaultValue={rupees(cur.extraKmRatePaise)} inputMode="decimal" /></label>
            <label>Batch bonus per batched trip (₹)<input name="batchBonus" required defaultValue={rupees(cur.batchBonusPaise)} inputMode="decimal" /></label>
          </div>
          <div className="row">
            <label>Rain bonus per order (₹)<input name="rain" required defaultValue={rupees(cur.rainBonusPaisePerOrder)} inputMode="decimal" /></label>
            <label>Festival bonus per order (₹)<input name="festival" required defaultValue={rupees(cur.festivalBonusPaisePerOrder)} inputMode="decimal" /></label>
          </div>
          <p className="note">The new rates apply to every trip from the start date onwards, and those weeks are recalculated. Weeks that are already approved cannot be changed, so the start date must be after the last approved week. The rain bonus is paid on orders Zomato marks as rain orders.</p>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="confirm" style={{ minHeight: 0, width: 18, height: 18 }} /> I have checked these rates.</label>
          <div><button type="submit">Save new rates</button></div>
        </form>
      ) : (
        <div className="alert warn">Only an admin can change rates.</div>
      )}
    </>
  );
}
