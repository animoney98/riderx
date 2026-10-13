'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from './icons';

export interface NavItem { href: string; label: string; icon: string }

/** Pill bar across the top: the everyday pages as pills, the rest under "More". */
export function TopNav({ main, more }: { main: NavItem[]; more: NavItem[] }) {
  const path = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const on = (href: string) => path.startsWith(href);
  const moreOn = more.some((m) => on(m.href));
  return (
    <nav className="pillnav" aria-label="Main">
      <div className="pillbox">
        <div className="links">
          {main.map((n) => <Link key={n.href} href={n.href} className={on(n.href) ? 'on' : ''}><Icon name={n.icon} />{n.label}</Link>)}
        </div>
        <details className="more" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className={moreOn ? 'on' : ''}>More <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></summary>
          <div className="menu">
            {more.map((n) => <Link key={n.href} href={n.href} className={on(n.href) ? 'on' : ''}><Icon name={n.icon} />{n.label}</Link>)}
          </div>
        </details>
      </div>
    </nav>
  );
}
