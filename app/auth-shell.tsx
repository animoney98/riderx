import type { ReactNode } from 'react';

/** The glass sign-in card shared by the staff and rider login pages. */
export function AuthShell({ title, subtitle, error, children, footer }: { title: string; subtitle: string; error?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="login">
      <div className="beam" aria-hidden="true" />
      <section className="card auth">
        <div className="authmark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /></svg></div>
        <h1>{title}</h1>
        <p className="sub">{subtitle}</p>
        {error && <div className="alert bad" role="alert">{error}</div>}
        {children}
        {footer && <div className="authfoot">{footer}</div>}
      </section>
    </main>
  );
}
