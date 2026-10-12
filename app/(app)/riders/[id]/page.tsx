import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { pinProblem, riderEmail } from '@/src/engine/riderLogin';

async function saveRider(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const back = (q: string) => redirect(`/riders/${id}?${q}`);
  const name = String(formData.get('name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const holder = String(formData.get('holder') ?? '').trim();
  const account = String(formData.get('account') ?? '').replace(/\s/g, '');
  const ifsc = String(formData.get('ifsc') ?? '').replace(/\s/g, '').toUpperCase();
  const bank = String(formData.get('bank') ?? '').trim();
  if (!name) back('error=Name+is+required');
  if (phone && !/^\+?\d{10,13}$/.test(phone.replace(/[\s-]/g, ''))) back('error=Phone+number+looks+wrong');
  const anyBank = holder || account || ifsc;
  if (anyBank) {
    if (!holder) back('error=Enter+the+name+exactly+as+on+the+bank+account');
    if (!/^[0-9]{6,20}$/.test(account)) back('error=Account+number+must+be+6+to+20+digits');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) back('error=IFSC+must+look+like+IDFB0080123+(11+characters,+5th+is+zero)');
  }
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { error } = await sb.from('riders').update({ full_name: name, phone: phone || null, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) back('error=Could+not+save.+Check+your+role');
  if (anyBank) {
    const { error: e2 } = await sb.from('rider_payment_details').upsert({
      rider_id: id, bank_account_holder: holder, bank_account_number: account, bank_ifsc: ifsc, bank_name: bank || null,
      updated_by: auth.user?.id, source: 'admin', verified_at: new Date().toISOString(), verified_by: auth.user?.id, updated_at: new Date().toISOString(),
    });
    if (e2) back('error=Rider+saved,+but+bank+details+were+not+(only+finance+managers+and+admins+can+change+them)');
  }
  // The audit log never stores the full account number.
  await sb.from('audit_logs').insert({ action: 'rider.update', entity_type: 'rider', entity_id: id, after_values: { name, phone, bank_updated: !!anyBank, account_last4: anyBank ? account.slice(-4) : null } });
  revalidatePath('/riders');
  back('saved=1');
}

/** Creates the rider's login, or resets his PIN. The PIN is typed by the admin and never stored or shown again. */
async function setPin(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const back = (q: string): never => redirect(`/riders/${id}?${q}`);
  const pin = String(formData.get('pin') ?? '').trim();
  const problem = pinProblem(pin);
  if (problem) back(`error=${encodeURIComponent(problem)}`);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  if (!me?.active || !['super_admin', 'operations_manager', 'finance_manager'].includes(me.role)) back('error=Not+allowed');
  const admin = supabaseAdmin();
  if (!admin) back('error=Rider+logins+are+not+switched+on+yet.+Add+SUPABASE_SERVICE_ROLE_KEY+in+Vercel+(see+the+steps+I+sent)');
  const { data: rider } = await sb.from('riders').select('id, user_id').eq('id', id).maybeSingle();
  if (!rider) back('error=Rider+not+found');
  const email = riderEmail(id);
  let userId = rider!.user_id as string | null;
  if (userId) {
    const { error } = await admin!.auth.admin.updateUserById(userId, { email, password: pin, email_confirm: true });
    if (error) back(`error=${encodeURIComponent('Could not set the PIN: ' + error.message)}`);
  } else {
    const { data, error } = await admin!.auth.admin.createUser({ email, password: pin, email_confirm: true, user_metadata: { rider_id: id } });
    if (error || !data.user) back(`error=${encodeURIComponent('Could not create the login: ' + (error?.message ?? 'unknown'))}`);
    userId = data.user!.id;
    const { error: e2 } = await admin!.from('riders').update({ user_id: userId }).eq('id', id);
    if (e2) back('error=Login+created+but+could+not+be+linked.+Try+again');
  }
  await sb.from('audit_logs').insert({ actor_id: auth.user?.id, action: 'rider.pin_set', entity_type: 'rider', entity_id: id });
  revalidatePath(`/riders/${id}`);
  back('saved=1');
}

export default async function RiderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const sb = await supabaseServer();
  const { data: rider } = await sb.from('riders').select('id, full_name, phone, user_id, rider_platform_accounts(platform_rider_id)').eq('id', id).maybeSingle();
  if (!rider) notFound();
  const { data: det } = await sb.from('rider_payment_details').select('bank_account_holder, bank_account_number, bank_ifsc, bank_name, source, verified_at').eq('rider_id', id).maybeSingle();
  const fe = (rider.rider_platform_accounts as { platform_rider_id: string }[]).map((a) => a.platform_rider_id).join(', ');
  return (
    <>
      <div>
        <Link href="/riders" className="note">← All riders</Link>
        <h1>{rider.full_name}</h1>
        <div className="note">FE ID {fe || '—'}</div>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {saved && <div className="alert ok">Saved.</div>}
      <form action={saveRider} className="card">
        <input type="hidden" name="id" value={rider.id} />
        <h2>Rider details</h2>
        <div className="row">
          <label>Full name<input name="name" required defaultValue={rider.full_name} /></label>
          <label>Phone<input name="phone" inputMode="tel" defaultValue={rider.phone ?? ''} /></label>
        </div>
        <h2 style={{ marginTop: 24 }}>Bank details</h2>
        <div className="row">
          <label>Name as on bank account<input name="holder" defaultValue={det?.bank_account_holder ?? ''} /></label>
          <label>Account number<input name="account" inputMode="numeric" defaultValue={det?.bank_account_number ?? ''} /></label>
          <label>IFSC<input name="ifsc" defaultValue={det?.bank_ifsc ?? ''} placeholder="IDFB0080123" style={{ textTransform: 'uppercase' }} /></label>
          <label>Bank name (optional)<input name="bank" defaultValue={det?.bank_name ?? ''} /></label>
        </div>
        <p className="note">Bank details are visible only to finance managers and admins. Check the account number twice: a wrong number sends the money to someone else.{det?.source === 'rider' && !det.verified_at ? ' The rider entered these himself. Check them with him, then click Save to approve them for the bank file.' : ''}</p>
        <button type="submit" style={{ marginTop: 12 }}>Save</button>
      </form>

      <form action={setPin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="id" value={rider.id} />
        <h2>Rider login</h2>
        <p className="note">The rider signs in at <b>/rider-login</b> with his FE ID or mobile number and this PIN, and sees his own earnings. {rider.user_id ? 'A login exists. Setting a PIN again resets it.' : 'No login yet.'}</p>
        <div className="row">
          <label>New 6-digit PIN<input name="pin" required inputMode="numeric" maxLength={6} autoComplete="off" /></label>
          <button type="submit">{rider.user_id ? 'Reset PIN' : 'Create login'}</button>
        </div>
        <p className="note">Tell the rider his PIN in person or by call. It is not stored anywhere you can read it, so if he forgets it, set a new one.</p>
      </form>
    </>
  );
}
