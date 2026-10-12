import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { loadRiderView } from '@/lib/rider-data';
import { addDays, cycleFor } from '@/src/engine/calendar';
import { formatINR } from '@/src/engine/payout';
import { pinProblem } from '@/src/engine/riderLogin';

async function save(formData: FormData) {
  'use server';
  const holder = String(formData.get('holder') ?? '').trim();
  const account = String(formData.get('account') ?? '').replace(/\s/g, '');
  const account2 = String(formData.get('account2') ?? '').replace(/\s/g, '');
  const ifsc = String(formData.get('ifsc') ?? '').replace(/\s/g, '').toUpperCase();
  const bank = String(formData.get('bank') ?? '').trim();
  if (!holder) redirect('/rider?error=Enter+your+name+exactly+as+on+your+bank+account');
  if (!/^[0-9]{6,20}$/.test(account)) redirect('/rider?error=Account+number+must+be+6+to+20+digits');
  if (account !== account2) redirect('/rider?error=The+two+account+numbers+do+not+match');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) redirect('/rider?error=IFSC+must+be+11+characters,+for+example+IDFB0080123');
  const sb = await supabaseServer();
  const { data: riderId } = await sb.rpc('claim_rider_profile');
  if (!riderId) redirect('/rider?error=Could+not+find+your+rider+record');
  const { error } = await sb.from('rider_payment_details').upsert({
    rider_id: riderId, bank_account_holder: holder, bank_account_number: account, bank_ifsc: ifsc, bank_name: bank || null,
    source: 'rider', verified_at: null, verified_by: null, updated_at: new Date().toISOString(),
  });
  if (error) redirect('/rider?error=Could+not+save.+Please+try+again');
  await sb.from('audit_logs').insert({ action: 'rider.bank_self_update', entity_type: 'rider', entity_id: String(riderId), after_values: { account_last4: account.slice(-4) } });
  revalidatePath('/rider');
  redirect('/rider?saved=1');
}

async function changePin(formData: FormData) {
  'use server';
  const pin = String(formData.get('pin') ?? '').trim();
  const problem = pinProblem(pin);
  if (problem) redirect(`/rider?error=${encodeURIComponent(problem)}`);
  const sb = await supabaseServer();
  const { data: riderId } = await sb.rpc('claim_rider_profile');
  if (!riderId) redirect('/rider?error=Could+not+find+your+rider+record');
  const { error } = await sb.auth.updateUser({ password: pin });
  if (error) redirect(`/rider?error=${encodeURIComponent('Could not change the PIN: ' + error.message)}`);
  await sb.from('audit_logs').insert({ action: 'rider.pin_changed', entity_type: 'rider', entity_id: String(riderId) });
  redirect('/rider?pinsaved=1');
}

async function logout() {
  'use server';
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/rider-login');
}

const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const km = (v: number) => (v / 100).toFixed(2);

export default async function RiderHome({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; pinsaved?: string; day?: string }> }) {
  const { error, saved, pinsaved, day } = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/rider-login');
  const { data: riderId } = await sb.rpc('claim_rider_profile');
  if (!riderId) {
    return (
      <main className="login">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 22 }}>We could not find you</h1>
          <p>This login is not linked to a rider. Riders: ask your RiderX contact to set up your login. RiderX staff: sign in on the main sign-in page, and ask the admin to give your account a role.</p>
          <form action={logout}><button className="ghost">Sign out</button></form>
        </div>
      </main>
    );
  }
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: rider } = await sb.from('riders').select('full_name').eq('id', riderId).maybeSingle();
  const { data: det } = await sb.from('rider_payment_details').select('bank_account_holder, bank_account_number, bank_ifsc, bank_name, verified_at').eq('rider_id', riderId).maybeSingle();
  const view = await loadRiderView(sb, today);
  const masked = det?.bank_account_number ? `••••${det.bank_account_number.slice(-4)}` : null;

  const byDate = new Map(view.days.map((d) => [d.date, d]));
  const t0 = byDate.get(today);
  const weekStart = cycleFor(today).start;
  const weekDays = view.days.filter((d) => d.date >= weekStart);
  const weekTotal = weekDays.reduce((s, d) => s + d.totalPaise, 0);
  const weekOrders = weekDays.reduce((s, d) => s + d.orders, 0);
  const picked = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const pickedTrips = picked ? view.trips.filter((t) => t.date === picked) : [];
  const updated = view.lastUpdate ? new Date(view.lastUpdate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  const pill = (final: boolean) => <span className={final ? 'pill p-ok' : 'pill p-warn'}>{final ? 'Final' : 'Estimated'}</span>;
  const parts = (d: typeof t0) => d && [
    ['Base pay', d.basePaise], ['Extra distance', d.distancePaise], ['Batch bonus', d.batchBonusPaise], ['Rain incentive', d.rainPaise], ['Festival incentive', d.festivalPaise],
  ] as [string, number][];

  return (
    <main className="rider">
      <div className="brand" style={{ padding: 0 }}>Rider<span>X</span></div>
      <div>
        <h1 style={{ fontSize: 24 }}>Hello, {rider?.full_name}</h1>
        <div className="note">{updated ? `Updated ${updated}. ` : ''}Orders appear here after RiderX loads Zomato’s latest data. Tips are paid to you by Zomato and are not shown here.</div>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {saved && <div className="alert ok">Saved. RiderX will check your details before the next payment.</div>}
      {pinsaved && <div className="alert ok">Your PIN was changed.</div>}

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <h2>Today · {dayLabel(today)}</h2>{t0 && pill(t0.isFinal)}
        </div>
        {t0 ? (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
              <div className="stat"><span>Orders delivered</span><b>{t0.orders}</b></div>
              <div className="stat"><span>Earned so far</span><b>{formatINR(t0.totalPaise)}</b></div>
            </div>
            <div className="breakdown">
              <div><span>Batched trips</span><b>{t0.batchedTrips}</b></div>
              <div><span>Extra distance</span><b>{km(t0.extraKm100)} km</b></div>
              {parts(t0)!.map(([l, v]) => <div key={l}><span>{l}</span><b>{formatINR(v)}</b></div>)}
            </div>
          </>
        ) : <p className="note">No orders recorded yet today.</p>}
      </section>

      <section className="card">
        <h2>This week</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div className="stat"><span>Orders</span><b>{weekOrders}</b></div>
          <div className="stat"><span>Earned</span><b>{formatINR(weekTotal)}</b></div>
        </div>
      </section>

      <section className="card">
        <h2>Day by day</h2>
        <div className="days">
          {view.days.map((d) => (
            <a key={d.date} href={`/rider?day=${d.date}#day`} className={`daycard${picked === d.date ? ' sel' : ''}`}>
              <div><b>{dayLabel(d.date)}</b><div className="note">{d.orders} orders{d.batchedTrips ? ` · ${d.batchedTrips} batched` : ''}{d.rainPaise ? ` · rain ${formatINR(d.rainPaise)}` : ''}</div></div>
              <div style={{ textAlign: 'right' }}><b>{formatINR(d.totalPaise)}</b><div>{pill(d.isFinal)}</div></div>
            </a>
          ))}
          {!view.days.length && <p className="note">No orders in the last 3 weeks.</p>}
        </div>
      </section>

      {picked && (
        <section className="card" id="day">
          <h2>{dayLabel(picked)}: your trips</h2>
          <div className="tbl"><table>
            <thead><tr><th>Time</th><th className="n">Orders</th><th className="n">Km</th><th className="n">Base</th><th className="n">Extra km</th><th className="n">Batch</th><th className="n">Rain</th><th className="n">Total</th></tr></thead>
            <tbody>
              {pickedTrips.map((t) => (
                <tr key={t.tripId}>
                  <td>{t.deliveredAt.slice(11)}</td><td className="n">{t.orders}</td><td className="n">{km(t.pickupKm100 + t.dropKm100)}</td>
                  <td className="n">{formatINR(t.basePaise)}</td><td className="n">{formatINR(t.distancePaise)}</td><td className="n">{formatINR(t.batchBonusPaise)}</td><td className="n">{formatINR(t.rainPaise)}</td><td className="n"><b>{formatINR(t.totalPaise)}</b></td>
                </tr>
              ))}
              {!pickedTrips.length && <tr><td colSpan={8} className="note">No trips that day.</td></tr>}
            </tbody>
          </table></div>
          <p className="note">The first orders of each day are paid at the base rate; extra distance is paid on the distance beyond 6 km (pickup plus drop).</p>
        </section>
      )}

      <section className="card">
        <h2>Weekly pay</h2>
        <div className="tbl"><table>
          <thead><tr><th>Week starting</th><th className="n">Earned</th><th className="n">Paid</th><th className="n">To receive</th><th>Pay date</th></tr></thead>
          <tbody>
            {view.weeks.map((w) => (
              <tr key={w.periodStart}><td>{dayLabel(w.periodStart)}</td><td className="n">{formatINR(w.netPaise)}</td><td className="n">{formatINR(w.paidPaise)}</td><td className="n"><b>{formatINR(w.netPaise - w.paidPaise)}</b></td><td>{dayLabel(w.payDate)}</td></tr>
            ))}
            {!view.weeks.length && <tr><td colSpan={5} className="note">Weeks appear here after RiderX approves them. Pay is released on the Friday of the following week.</td></tr>}
          </tbody>
        </table></div>
        {view.payments.length > 0 && (
          <>
            <h2 style={{ marginTop: 16 }}>Payments received</h2>
            <div className="tbl"><table>
              <thead><tr><th>Date</th><th className="n">Amount</th><th>Method</th><th>Reference</th></tr></thead>
              <tbody>{view.payments.map((p, i) => <tr key={i}><td>{p.date}</td><td className="n">{formatINR(p.amountPaise)}</td><td>{p.method}</td><td>{p.reference ?? '—'}</td></tr>)}</tbody>
            </table></div>
          </>
        )}
      </section>

      {masked && (
        <div className="card">
          <b>Bank details on file</b>
          <p>{det!.bank_account_holder} · {masked} · {det!.bank_ifsc}</p>
          <span className={det!.verified_at ? 'pill p-ok' : 'pill p-warn'}>{det!.verified_at ? 'Checked by RiderX' : 'Waiting for RiderX to check'}</span>
        </div>
      )}
      <form action={save} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>{masked ? 'Change bank details' : 'Add your bank details'}</h2>
        <label>Name as on bank account<input name="holder" required /></label>
        <label>Account number<input name="account" required inputMode="numeric" autoComplete="off" /></label>
        <label>Type account number again<input name="account2" required inputMode="numeric" autoComplete="off" /></label>
        <label>IFSC code<input name="ifsc" required autoComplete="off" style={{ textTransform: 'uppercase' }} /></label>
        <label>Bank name (optional)<input name="bank" /></label>
        <p className="note">Check carefully. If the account number is wrong, your salary can go to someone else.</p>
        <button type="submit">Save</button>
      </form>
      <form action={changePin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Change your PIN</h2>
        <label>New 6-digit PIN<input name="pin" type="password" required inputMode="numeric" maxLength={6} autoComplete="new-password" /></label>
        <button type="submit" className="ghost">Change PIN</button>
      </form>
      <form action={logout}><button className="ghost" style={{ width: '100%' }}>Sign out</button></form>
    </main>
  );
}
