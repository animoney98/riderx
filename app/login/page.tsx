import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

async function login(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  });
  if (error) redirect('/login?error=1');
  redirect('/riders');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="brand" style={{ color: '#141414', padding: 0, marginBottom: 20 }}>Rider<span>X</span></div>
      <form action={login} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 style={{ fontSize: 24 }}>Sign in</h1>
        {error && <div className="alert bad" role="alert">Email or password is incorrect.</div>}
        <label>Email<input name="email" type="email" required autoComplete="username" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
