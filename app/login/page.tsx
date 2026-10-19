import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { AuthShell } from '../auth-shell';
import { signInRider } from '@/lib/rider-signin';

async function login(formData: FormData) {
  'use server';
  const who = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // No @ means a rider typing his FE ID (or mobile number) and PIN: use the rider sign-in.
  if (!who.includes('@')) {
    const res = await signInRider(who, password);
    if (res === 'off') redirect('/login?error=2');
    if (res) redirect('/login?error=1');
    redirect('/rider');
  }
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: who, password });
  if (error) redirect('/login?error=1');
  redirect('/overview');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Sign in" subtitle="Sign in to RiderX to continue." error={error ? (error === '2' ? 'Rider sign-in is not switched on yet. Please ask RiderX.' : 'Email, FE ID or password is incorrect.') : undefined}>
      <form action={login} className="authform">
        <label>Email or FE ID<input name="email" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Email address or FE ID" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" placeholder="Password or 6-digit PIN" /></label>
        <button type="submit">Sign in</button>
      </form>
    </AuthShell>
  );
}
