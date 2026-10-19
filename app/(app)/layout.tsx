import { Logo } from '../logo';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { SideNav, type NavItem } from './side-nav';

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
  { href: '/reconciliation', label: 'Zomato Revenue', icon: 'recon' },
];
const MORE: NavItem[] = [
  { href: '/daily-targets', label: 'Zomato Daily Targets', icon: 'target' },
  { href: '/imports', label: 'Import Center', icon: 'imports' },
  { href: '/rate-cards', label: 'Rate Cards', icon: 'rates' },
  { href: '/reports', label: 'Reports & Exports', icon: 'reports' },
  { href: '/audit-log', label: 'Audit Log', icon: 'audit' },
  { href: '/settings', label: 'Bank', icon: 'bank' },
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

  const role = profile?.active ? (profile.role as string) : '';
  const nav = {
    main: MAIN.filter((n) => (n.href !== '/leads' || ['super_admin', 'operations_manager'].includes(role)) && (n.href !== '/reconciliation' || role === 'super_admin')),
    more: role === 'super_admin' ? [...MORE, ...ADMIN_ONLY] : MORE,
  };
  return (
    <div className="shell">
      <div className="frame">
        <aside className="sidebar">
          <div className="brand"><span className="wordmark">Rider</span><Logo size={34} href="/overview" /></div>
          <SideNav main={nav.main} more={nav.more} />
          <div className="acct">
            <span className="av">{initials(profile?.full_name ?? auth.user.email ?? '')}</span>
            <div className="who"><b>{profile?.full_name ?? auth.user.email}</b><span>{profile ? profile.role.replace('_', ' ') : 'No role yet'}</span></div>
            <form action={logout}><button className="ghost" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9" /></svg></button></form>
          </div>
        </aside>
      <main className="main">
        {!profile?.active && (
          <div className="alert bad" role="alert">
            Your login has no role in RiderX yet, so most data will not load. Run the "create your admin profile" SQL step in Supabase, then refresh.
          </div>
        )}
        {children}
      </main>
      </div>
    </div>
  );
}
