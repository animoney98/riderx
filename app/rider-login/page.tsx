import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

function e164(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  const ten = d.length >= 10 ? d.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
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

export default async function RiderLogin({ searchParams }: { searchParams: Promise<{ error?: string; step?: string; phone?: string }> }) {
  const { error, step, phone } = await searchParams;
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
      ) : (
        <form action={sendCode} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 style={{ fontSize: 24 }}>Rider sign in</h1>
          {error && <div className="alert bad" role="alert">{error}</div>}
          <label>Mobile number<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="98765 43210" /></label>
          <button type="submit">Send code</button>
          <p className="note">Use the number RiderX has on file for you.</p>
        </form>
      )}
    </main>
  );
}
