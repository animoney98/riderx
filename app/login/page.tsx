import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { AuthShell } from '../auth-shell';

async function login(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  });
  if (error) redirect('/login?error=1');
  redirect('/overview');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Sign in" subtitle="Sign in to RiderX to continue." error={error ? 'Email or password is incorrect.' : undefined}>
      <form action={login} className="authform">
        <label>Email<input name="email" type="email" required autoComplete="username" placeholder="Enter your email address" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" placeholder="Enter your password" /></label>
        <button type="submit">Sign in</button>
      </form>
    </AuthShell>
  );
}
