'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export interface NavItem { href: string; label: string; icon: string }

/** Vertical menu in the glass sidebar. Everyday pages first, then the rest under "Tools". */
export function SideNav({ main, more }: { main: NavItem[]; more: NavItem[] }) {
  const path = usePathname() ?? '';
  const on = (href: string) => path.startsWith(href);
  const item = (n: NavItem) => <Link key={n.href} href={n.href} className={on(n.href) ? 'on' : ''}><Icon name={n.icon} /><span>{n.label}</span></Link>;
  return (
    <nav className="sidenav" aria-label="Main">
      <div className="navgroup">{main.map(item)}</div>
      <div className="navlabel">Tools</div>
      <div className="navgroup">{more.map(item)}</div>
    </nav>
  );
}
