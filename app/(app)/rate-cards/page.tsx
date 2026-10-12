import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { loadRateCard, SPECIAL_PREFIX } from '@/lib/rate-card';
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
  const latest = (all ?? []).find((r) => !String((r.configuration as RateCard).name).startsWith(SPECIAL_PREFIX));
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
    await recalculateFrom(sb, effective, null, (d) => loadRateCard(sb, d));
  } catch (e) {
    back(`error=${encodeURIComponent('Rates saved, but earnings could not be recalculated: ' + (e as Error).message + '. Import a Zomato file again to retry.')}`);
  }
  revalidatePath('/rate-cards');
  back('saved=1');
}


const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

async function adminOrBack(back: (q: string) => never) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  if (!me?.active || me.role !== 'super_admin') back('error=Only+an+admin+can+change+rates');
  return { sb, uid: auth.user!.id };
}

async function weekApproved(sb: Awaited<ReturnType<typeof supabaseServer>>, date: string) {
  const weekStart = cycleFor(date).start;
  const { data } = await sb.from('payout_cycles').select('period_start').eq('period_start', weekStart).limit(1);
  return !!data?.length;
}

async function createSpecialDay(formData: FormData) {
  'use server';
  const back = (q: string): never => redirect(`/rate-cards?${q}`);
  const { sb, uid } = await adminOrBack(back);
  const date = String(formData.get('date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) back('error=Choose+a+date');
  if (formData.get('confirm') !== 'on') back('error=Tick+the+box+to+confirm');
  if (await weekApproved(sb, date)) back(`error=${encodeURIComponent('The week containing ' + date + ' is already approved, so its rates cannot change')}`);
  const { data: existing } = await sb.from('rate_cards').select('id, name').eq('status', 'active').eq('effective_start', date).like('name', SPECIAL_PREFIX + '%');
  if (existing?.length) back('error=There+is+already+a+special+rate+for+that+date.+Cancel+it+first');

  const std = await loadRateCard(sb, date, { standardOnly: true });
  if (!std.id) back('error=No+standard+rate+card+found');
  let card: RateCard;
  try {
    card = buildRateCard({
      name: SPECIAL_PREFIX + date, version: 1,
      firstSlabOrders: String(std.card.slabs[0].upToOrder), firstSlabRate: String(formData.get('firstSlabRate')), laterRate: String(formData.get('laterRate')),
      includedKm: String(formData.get('includedKm')), extraKmRate: String(formData.get('extraKmRate')), batchBonus: String(formData.get('batchBonus')),
      rainPerOrder: String(formData.get('rain')), festivalPerOrder: String(formData.get('festival')), batchedTripBaseOrders: std.card.batchedTripBaseOrders ?? 1,
    });
  } catch (e) { return back(`error=${encodeURIComponent((e as Error).message)}`); }
  const { count } = await sb.from('rate_cards').select('id', { count: 'exact', head: true }).eq('name', card.name);
  card.version = (count ?? 0) + 1;
  const { data: created, error } = await sb.from('rate_cards').insert({
    name: card.name, version: card.version, effective_start: date, effective_end: date, status: 'active', configuration: card, created_by: uid, approved_by: uid,
  }).select('id').single();
  if (error || !created) back('error=Could+not+save+the+special+rates');
  await sb.from('audit_logs').insert({ actor_id: uid, action: 'rate_card.special_day', entity_type: 'rate_card', entity_id: created!.id, before_values: std.card, after_values: { ...card, date } });
  try {
    await recalculateFrom(sb, date, date, (d) => loadRateCard(sb, d));
  } catch (e) {
    back(`error=${encodeURIComponent('Saved, but earnings could not be recalculated: ' + (e as Error).message + '. Import a Zomato file again to retry.')}`);
  }
  revalidatePath('/rate-cards');
  back('special=1');
}

async function cancelSpecialDay(formData: FormData) {
  'use server';
  const back = (q: string): never => redirect(`/rate-cards?${q}`);
  const { sb, uid } = await adminOrBack(back);
  const id = String(formData.get('id'));
  const { data: row } = await sb.from('rate_cards').select('id, name, effective_start').eq('id', id).maybeSingle();
  if (!row || !String(row.name).startsWith(SPECIAL_PREFIX)) back('error=Special+rate+not+found');
  const date = row!.effective_start as string;
  if (await weekApproved(sb, date)) back(`error=${encodeURIComponent('The week containing ' + date + ' is already approved, so its rates cannot change')}`);
  const { error } = await sb.from('rate_cards').update({ status: 'retired' }).eq('id', id);
  if (error) back('error=Could+not+cancel');
  await sb.from('audit_logs').insert({ actor_id: uid, action: 'rate_card.special_day_cancel', entity_type: 'rate_card', entity_id: id, after_values: { date } });
  try {
    await recalculateFrom(sb, date, date, (d) => loadRateCard(sb, d));
  } catch (e) {
    back(`error=${encodeURIComponent('Cancelled, but earnings could not be recalculated: ' + (e as Error).message)}`);
  }
  revalidatePath('/rate-cards');
  back('cancelled=1');
}

const rupees = (p: number) => (p / 100).toString();

export default async function RateCardsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; special?: string; cancelled?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role').eq('id', auth.user?.id ?? '').maybeSingle();
  const isAdmin = me?.role === 'super_admin';
  const { data: cards } = await sb.from('rate_cards').select('id, name, version, effective_start, effective_end, status, configuration').order('version', { ascending: false });
  const isSpecial = (r: { name: unknown }) => String(r.name).startsWith(SPECIAL_PREFIX);
  const standardCards = (cards ?? []).filter((r) => !isSpecial(r));
  const specials = (cards ?? []).filter((r) => isSpecial(r) && r.status === 'active').sort((a, b) => String(b.effective_start).localeCompare(String(a.effective_start)));
  const cur = standardCards[0]?.configuration as RateCard | undefined;
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
      {sp.special && <div className="alert ok">Special rates saved for that day and its earnings recalculated. The next day goes back to the standard rates.</div>}
      {sp.cancelled && <div className="alert ok">Special rates cancelled. That day is back on the standard rates.</div>}

      <section className="card">
        <h2>Rate history</h2>
        <div className="tbl"><table>
          <thead><tr><th>Version</th><th>From</th><th>To</th><th>Base pay</th><th>Included km</th><th>Extra km</th><th>Batch bonus</th><th>Rain / order</th><th>Festival / order</th></tr></thead>
          <tbody>
            {standardCards.map((r) => {
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
      <section className="card">
        <h2>Special rates for a single day</h2>
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th>Base pay</th><th>Batch bonus</th><th>Rain / order</th><th>Festival / order</th><th></th></tr></thead>
          <tbody>
            {specials.map((r) => {
              const c = r.configuration as RateCard;
              return (
                <tr key={r.id as string}>
                  <td><b>{r.effective_start as string}</b></td><td>{slab(c)}</td><td>{formatINR(c.batchBonusPaise)}</td><td>{formatINR(c.rainBonusPaisePerOrder)}</td><td>{formatINR(c.festivalBonusPaisePerOrder)}</td>
                  <td>{isAdmin && <form action={cancelSpecialDay}><input type="hidden" name="id" value={r.id as string} /><button type="submit" className="ghost" style={{ minHeight: 36 }}>Cancel</button></form>}</td>
                </tr>
              );
            })}
            {!specials.length && <tr><td colSpan={6} className="note">No special days.</td></tr>}
          </tbody>
        </table></div>
        {isAdmin && cur && (
          <form action={createSpecialDay} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <div className="row">
              <label>Date (rates apply from midnight to midnight, IST)<input type="date" name="date" required defaultValue={todayIST()} /></label>
            </div>
            <div className="row">
              <label>First rate per order (₹)<input name="firstSlabRate" required defaultValue={rupees(cur.slabs[0].ratePaise)} inputMode="decimal" /></label>
              <label>Rate per order after {cur.slabs[0].upToOrder} orders (₹)<input name="laterRate" required defaultValue={rupees(cur.slabs[1].ratePaise)} inputMode="decimal" /></label>
              <label>Per extra km (₹)<input name="extraKmRate" required defaultValue={rupees(cur.extraKmRatePaise)} inputMode="decimal" /></label>
            </div>
            <div className="row">
              <label>Distance included (km)<input name="includedKm" required defaultValue={cur.includedKm100 / 100} inputMode="decimal" /></label>
              <label>Batch bonus (₹)<input name="batchBonus" required defaultValue={rupees(cur.batchBonusPaise)} inputMode="decimal" /></label>
              <label>Rain bonus per order (₹)<input name="rain" required defaultValue={rupees(cur.rainBonusPaisePerOrder)} inputMode="decimal" /></label>
              <label>Festival bonus per order (₹)<input name="festival" required defaultValue={rupees(cur.festivalBonusPaisePerOrder)} inputMode="decimal" /></label>
            </div>
            <p className="note">These rates apply only to orders delivered on that date, until 12 midnight. The next day goes back to the standard rates automatically. The number of orders at the first rate stays the same as the standard ({cur.slabs[0].upToOrder}). A day in an already approved week cannot be changed. The Salary & Payroll columns “at ₹50 / at ₹60” count orders by position (first {cur.slabs[0].upToOrder} of the day or later), so on a special day the money in those columns follows the special rate.</p>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="confirm" style={{ minHeight: 0, width: 18, height: 18 }} /> I have checked these rates.</label>
            <div><button type="submit">Save special rates for this day</button></div>
          </form>
        )}
      </section>
    </>
  );
}
