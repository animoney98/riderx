'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, label }: { href: string; label: string }) {
  const on = usePathname().startsWith(href);
  return <Link href={href} className={on ? 'on' : ''}>{label}</Link>;
}
