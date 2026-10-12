import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { last10, parseIdentifier, riderEmail } from '@/src/engine/riderLogin';

function e164(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  const ten = d.length >= 10 ? d.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}


const WRONG = '/rider-login?error=Wrong+FE+ID,+mobile+number+or+PIN';

async function pinLogin(formData: FormData) {
  'use server';
  const id = parseIdentifier(String(formData.get('who') ?? ''));
  const pin = String(formData.get('pin') ?? '').trim();
  if (!id || !/^\d{6}$/.test(pin)) redirect(WRONG);
  const admin = supabaseAdmin();
  if (!admin) redirect('/rider-login?error=Sign+in+is+not+switched+on+yet.+Please+ask+RiderX');
  // Find the rider without revealing whether the FE ID or phone exists: every failure shows the same message.
  let riderId: string | null = null;
  if (id!.kind === 'fe') {
    const { data } = await admin!.from('rider_platform_accounts').select('rider_id').eq('platform', 'zomato').eq('platform_rider_id', id!.value);
    if (data?.length === 1) riderId = data[0].rider_id as string;
  } else {
    const { data } = await admin!.from('riders').select('id, phone').not('phone', 'is', null);
    const hits = (data ?? []).filter((r) => last10(r.phone as string) === id!.value);
    if (hits.length === 1) riderId = hits[0].id as string;
  }
  if (!riderId) redirect(WRONG);
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: riderEmail(riderId!), password: pin });
  if (error) redirect(WRONG);
  redirect('/rider');
}

async function sendCode(formData: FormData) {
  'use server';
  const phone = e164(String(formData.get('phone') ?? ''));
  if (!phone) redirect('/rider-login?error=Enter+your+10-digit+mobile+number');
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
  if (error) redirect('/rider-login?error=Could+not+send+the+code.+Try+again+in+a+minute');
  redirect(`/rider-login?step=code&phone=${encodeURIComponent(phone)}`);
}

async function verifyCode(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '');
  const token = String(formData.get('code') ?? '').trim();
  const sb = await supabaseServer();
  const { error } = await sb.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) redirect(`/rider-login?step=code&phone=${encodeURIComponent(phone)}&error=That+code+is+wrong+or+has+expired`);
  redirect('/rider');
}

export default async function RiderLogin({ searchParams }: { searchParams: Promise<{ error?: string; step?: string; phone?: string; mode?: string }> }) {
  const { error, step, phone, mode } = await searchParams;
  return (
    <main className="login">
      <div className="brand" style={{ padding: 0, marginBottom: 20 }}>Rider<span>X</span></div>
      {step === 'code' && phone ? (
        <form action={verifyCode} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 style={{ fontSize: 24 }}>Enter the code</h1>
          <p className="note">We sent a 6-digit code by SMS to {phone}.</p>
          {error && <div className="alert bad" role="alert">{error}</div>}
          <input type="hidden" name="phone" value={phone} />
          <label>Code<input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={8} /></label>
          <button type="submit">Sign in</button>
        </form>
      ) : mode !== 'sms' ? (
        <form action={pinLogin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 style={{ fontSize: 24 }}>Rider sign in</h1>
          {error && <div className="alert bad" role="alert">{error}</div>}
          <label>FE ID or mobile number<input name="who" required autoComplete="username" placeholder="FE11568286 or 98765 43210" /></label>
          <label>6-digit PIN<input name="pin" type="password" required inputMode="numeric" maxLength={6} autoComplete="current-password" /></label>
          <button type="submit">Sign in</button>
          <p className="note">Forgot your PIN? Ask RiderX to set a new one. <a href="/rider-login?mode=sms">Sign in with an SMS code instead</a></p>
        </form>
      ) : (
        <form action={sendCode} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 style={{ fontSize: 24 }}>Rider sign in</h1>
          {error && <div className="alert bad" role="alert">{error}</div>}
          <label>Mobile number<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="98765 43210" /></label>
          <button type="submit">Send code</button>
          <p className="note">Use the number RiderX has on file for you. <a href="/rider-login">Sign in with a PIN instead</a></p>
        </form>
      )}
    </main>
  );
}
