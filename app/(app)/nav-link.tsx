'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const on = usePathname().startsWith(href);
  return <Link href={href} className={on ? 'on' : ''}><Icon name={icon} />{label}</Link>;
}
