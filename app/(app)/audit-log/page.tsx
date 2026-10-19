import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

const PAGE = 50;
const LABELS: Record<string, string> = {
  'import.commit': 'Zomato file imported',
  'import.undo': 'Zomato import undone',
  'rider.create': 'Rider added',
  'rider.update': 'Rider details changed',
  'rider.login_linked': 'Rider phone linked',
  'rider.bank_self_update': 'Rider entered bank details',
  'payroll.approve': 'Payroll approved',
  'payroll.export_draft': 'Payroll Excel downloaded',
  'payroll.bank_file': 'Bank file downloaded',
  'payment.record': 'Payment recorded',
  'payment.record_all': 'All payments recorded',
  'payment.bank_results': 'Bank results recorded (paid / failed)',
  'zomato.receipt': 'Money received from Zomato recorded',
  'rate_card.create': 'Standard rates changed',
  'rate_card.special_day': 'Special one-day rates added',
  'rate_card.special_day_cancel': 'Special one-day rates cancelled',
  'zomato.target_create': 'Zomato daily target added',
  'zomato.target_update': 'Zomato daily target changed',
  'zomato.target_remove': 'Zomato daily target removed',
  'report.download': 'Report or backup downloaded',
  'lead.onboard': 'Lead added as a rider',
  'lead.update': 'Lead status or notes changed',
  'user.create': 'Team member added',
  'user.update': 'Team member role or status changed',
  'user.password_reset': 'Team member password reset',
  'settings.debit_account': 'Bank debit account set',
  'settings.debit_account_requested': 'Bank debit account change requested',
  'settings.debit_account_approve': 'Bank debit account change approved',
  'settings.debit_account_reject': 'Bank debit account change rejected',
  'settings.debit_account_cancel': 'Bank debit account request cancelled',
};
const GROUPS: [string, string][] = [['', 'Everything'], ['import', 'Imports'], ['rider', 'Riders'], ['payroll', 'Payroll'], ['payment', 'Payments'], ['rate_card', 'Rates'], ['zomato', 'Zomato'], ['settings', 'Settings'], ['user', 'Team'], ['report', 'Reports'], ['lead', 'Leads']];

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ page?: string; group?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role').eq('id', auth.user?.id ?? '').maybeSingle();
  if (me?.role !== 'super_admin') {
    return (
      <>
        <h1>Audit log</h1>
        <div className="alert warn">Only an admin can see the audit log.</div>
      </>
    );
  }
  const page = Math.max(1, Number(sp.page) || 1);
  const group = GROUPS.some(([g]) => g === sp.group) ? sp.group ?? '' : '';
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let q = sb.from('audit_logs').select('id, actor_id, action, entity_type, entity_id, before_values, after_values, reason, created_at', { count: 'exact' });
  if (group) q = q.like('action', `${group}.%`);
  if (isDate(sp.from)) q = q.gte('created_at', `${sp.from}T00:00:00+05:30`);
  if (isDate(sp.to)) q = q.lte('created_at', `${sp.to}T23:59:59+05:30`);
  const { data: rows, count } = await q.order('id', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);

  const actorIds = [...new Set((rows ?? []).map((r) => r.actor_id as string | null).filter(Boolean) as string[])];
  const { data: people } = actorIds.length ? await sb.from('profiles').select('id, full_name').in('id', actorIds) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number) => `/audit-log?page=${p}${group ? `&group=${group}` : ''}${sp.from ? `&from=${sp.from}` : ''}${sp.to ? `&to=${sp.to}` : ''}`;

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Audit Log</div>
        <h1>Who did what, and when</h1>
        <div className="note">A permanent record. Entries cannot be edited or deleted. Times are Indian time. Bank account numbers are never recorded in full.</div>
      </div>
      <form className="card row" method="get" action="/audit-log">
        <label>Show<select name="group" defaultValue={group}>{GROUPS.map(([g, l]) => <option key={g} value={g}>{l}</option>)}</select></label>
        <label>From<input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
        <label>To<input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
        <button type="submit">Filter</button>
      </form>
      <section className="card">
        <h2>{count ?? 0} entries</h2>
        <div className="tbl"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id as number}>
                <td style={{ whiteSpace: 'nowrap' }}>{when(r.created_at as string)}</td>
                <td>{r.actor_id ? nameOf.get(r.actor_id as string) ?? 'Unknown user' : 'System'}</td>
                <td><b>{LABELS[r.action as string] ?? (r.action as string)}</b></td>
                <td>{r.entity_type as string}{r.entity_id ? ` · ${String(r.entity_id).slice(0, 12)}` : ''}</td>
                <td>
                  {(r.after_values || r.before_values || r.reason) ? (
                    <details>
                      <summary>Show</summary>
                      {r.reason ? <p>Reason: {r.reason as string}</p> : null}
                      {r.before_values ? <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>Before: {JSON.stringify(r.before_values, null, 1)}</pre> : null}
                      {r.after_values ? <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>After: {JSON.stringify(r.after_values, null, 1)}</pre> : null}
                    </details>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {!rows?.length && <tr><td colSpan={5} className="note">No entries match.</td></tr>}
          </tbody>
        </table></div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          {page > 1 && <Link href={link(page - 1)}>← Newer</Link>}
          <span className="note">Page {page} of {pages}</span>
          {page < pages && <Link href={link(page + 1)}>Older →</Link>}
        </div>
      </section>
    </>
  );
}
