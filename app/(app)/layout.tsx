import { Logo } from '../logo';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { TopNav, type NavItem } from './top-nav';

async function logout() {
  'use server';
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}

// Only pages that really work are listed. The everyday ones are pills; the rest sit under "More".
const MAIN: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: 'overview' },
  { href: '/riders', label: 'Riders', icon: 'riders' },
  { href: '/leads', label: 'Leads', icon: 'leads' },
  { href: '/daily-earnings', label: 'Daily Earnings', icon: 'daily' },
  { href: '/payroll', label: 'Salary & Payroll', icon: 'payroll' },
  { href: '/reconciliation', label: 'Zomato Reconciliation', icon: 'recon' },
];
const MORE: NavItem[] = [
  { href: '/daily-targets', label: 'Zomato Daily Targets', icon: 'target' },
  { href: '/imports', label: 'Imports & Data Quality', icon: 'imports' },
  { href: '/rate-cards', label: 'Rate Cards', icon: 'rates' },
  { href: '/reports', label: 'Reports & Exports', icon: 'reports' },
  { href: '/audit-log', label: 'Audit Log', icon: 'audit' },
  { href: '/settings', label: 'Bank Settings', icon: 'bank' },
];
const ADMIN_ONLY: NavItem[] = [{ href: '/users', label: 'User & Access', icon: 'users' }];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

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
      <header className="topbar">
        <svg className="beamline" aria-hidden="true"><rect className="halo b6" width="100%" height="100%" pathLength="100" /><rect className="halo b5" width="100%" height="100%" pathLength="100" /><rect className="halo b4" width="100%" height="100%" pathLength="100" /><rect className="halo b3" width="100%" height="100%" pathLength="100" /><rect className="halo b2" width="100%" height="100%" pathLength="100" /><rect className="halo b1" width="100%" height="100%" pathLength="100" /><rect className="halo b0" width="100%" height="100%" pathLength="100" /><rect className="core b6" width="100%" height="100%" pathLength="100" /><rect className="core b5" width="100%" height="100%" pathLength="100" /><rect className="core b4" width="100%" height="100%" pathLength="100" /><rect className="core b3" width="100%" height="100%" pathLength="100" /><rect className="core b2" width="100%" height="100%" pathLength="100" /><rect className="core b1" width="100%" height="100%" pathLength="100" /><rect className="core b0" width="100%" height="100%" pathLength="100" /></svg>
        <div className="brand"><span className="wordmark">Rider</span><Logo size={34} href="/overview" /></div>
        <TopNav main={profile?.active && ['super_admin', 'operations_manager'].includes(profile.role) ? MAIN : MAIN.filter((n) => n.href !== '/leads')} more={profile?.active && profile.role === 'super_admin' ? [...MORE, ...ADMIN_ONLY] : MORE} />
        <details className="me">
          <summary aria-label="Account">{initials(profile?.full_name ?? auth.user.email ?? '')}</summary>
          <div className="menu right">
            <div className="who"><b>{profile?.full_name ?? auth.user.email}</b><span>{profile ? profile.role.replace('_', ' ') : 'No role yet'}</span></div>
            <form action={logout}><button className="ghost" style={{ width: '100%', minHeight: 40 }}>Sign out</button></form>
          </div>
        </details>
      </header>
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
