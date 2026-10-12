import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { NavLink } from './nav-link';
import { Icon } from './icons';

async function logout() {
  'use server';
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}

// Only pages that really work are links. The rest are shown as not built yet.
const LIVE = [
  { href: '/overview', label: 'Overview', icon: 'overview' },
  { href: '/riders', label: 'Riders', icon: 'riders' },
  { href: '/daily-earnings', label: 'Daily Earnings', icon: 'daily' },
  { href: '/payroll', label: 'Salary & Payroll', icon: 'payroll' },
  { href: '/reconciliation', label: 'Zomato Reconciliation', icon: 'recon' },
  { href: '/daily-targets', label: 'Zomato Daily Targets', icon: 'target' },
  { href: '/imports', label: 'Imports & Data Quality', icon: 'imports' },
  { href: '/rate-cards', label: 'Rate Cards', icon: 'rates' },
  { href: '/audit-log', label: 'Audit Log', icon: 'audit' },
  { href: '/settings', label: 'Bank Settings', icon: 'bank' },
];
const NOT_YET = ['Orders', 'Payout Management', 'Financials & Profit', 'Reports & Exports', 'User & Access Management'];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: profile } = await sb.from('profiles').select('full_name, role, active').eq('id', auth.user.id).maybeSingle();

  // A rider (phone login, no staff profile) belongs on his own page.
  if (!profile?.active && auth.user.email?.endsWith('@riders.riderx.app')) redirect('/rider');
  if (!profile && auth.user.phone) redirect('/rider');

  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">Rider<span>X</span></div>
        {LIVE.map((n) => <NavLink key={n.href} href={n.href} label={n.label} icon={n.icon} />)}
        <div className="sep" />
        {NOT_YET.map((n) => <div key={n} className="soon"><Icon name="soon" />{n}<small>Not built yet</small></div>)}
        <div className="me">
          {profile ? `${profile.full_name} · ${profile.role}` : auth.user.email}
          <form action={logout}><button className="ghost" style={{ marginTop: 8, minHeight: 36, width: '100%' }}>Sign out</button></form>
        </div>
      </nav>
      <main className="main">
        {!profile?.active && (
          <div className="alert bad" role="alert">
            Your login has no role in RiderX yet, so most data will not load. Run the "create your admin profile" SQL step in Supabase, then refresh.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
