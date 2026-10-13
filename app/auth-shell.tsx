import type { ReactNode } from 'react';
import { Logo } from './logo';

/** The glass sign-in card shared by the staff and rider login pages. */
export function AuthShell({ title, subtitle, error, children, footer }: { title: string; subtitle: string; error?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="login">
      <div className="beam" aria-hidden="true" />
      <section className="card auth">
        <div className="authmark"><Logo size={72} /></div>
        <h1>{title}</h1>
        <p className="sub">{subtitle}</p>
        {error && <div className="alert bad" role="alert">{error}</div>}
        {children}
        {footer && <div className="authfoot">{footer}</div>}
      </section>
    </main>
  );
}
