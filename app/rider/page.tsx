import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';

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

async function logout() {
  'use server';
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/rider-login');
}

export default async function RiderHome({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/rider-login');
  const { data: riderId } = await sb.rpc('claim_rider_profile');
  if (!riderId) {
    return (
      <main className="login">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 22 }}>We could not find you</h1>
          <p>This mobile number is not registered with RiderX. Please ask your RiderX contact to add it to your profile.</p>
          <form action={logout}><button className="ghost">Sign out</button></form>
        </div>
      </main>
    );
  }
  const { data: rider } = await sb.from('riders').select('full_name').eq('id', riderId).maybeSingle();
  const { data: det } = await sb.from('rider_payment_details').select('bank_account_holder, bank_account_number, bank_ifsc, bank_name, verified_at').eq('rider_id', riderId).maybeSingle();
  const masked = det?.bank_account_number ? `••••${det.bank_account_number.slice(-4)}` : null;
  return (
    <main className="login" style={{ alignItems: 'stretch', maxWidth: 520 }}>
      <div className="brand" style={{ padding: 0, marginBottom: 12 }}>Rider<span>X</span></div>
      <h1 style={{ fontSize: 24 }}>Hello, {rider?.full_name}</h1>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {saved && <div className="alert ok">Saved. RiderX will check your details before the next payment.</div>}
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
      <form action={logout}><button className="ghost" style={{ width: '100%' }}>Sign out</button></form>
    </main>
  );
}
