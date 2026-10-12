import { supabaseServer } from '@/lib/supabase-server';

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

export default async function ReportsPage() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user?.id ?? '').maybeSingle();
  const role = me?.active ? (me.role as string) : '';
  const admin = role === 'super_admin';
  const finance = admin || role === 'finance_manager';
  const ops = finance || role === 'operations_manager';
  if (!ops) return (<><h1>Reports &amp; Exports</h1><div className="alert warn">Your role cannot download reports. Ask an Admin.</div></>);
  return (
    <>
      <div>
        <h1>Reports &amp; Exports</h1>
        <div className="note">Excel files you can keep, share with your accountant, or use as a safety copy. Every download is recorded in the Audit Log.</div>
      </div>

      {admin && (
        <section className="card">
          <h2>Full backup</h2>
          <p className="note">Everything in RiderX in one Excel file: riders, bank details, every trip and its pay, payroll, payments, Zomato receipts, rates and the audit log. One sheet per table, with a README sheet listing the row counts. Values are exactly as stored (money in paise). Download one every week while you are on the Free Supabase plan, and keep it somewhere private: it contains bank account numbers.</p>
          <a className="btn" href="/reports/export?type=backup">Download full backup</a>
          <p className="note">It can take up to a minute once there is a lot of data.</p>
        </section>
      )}

      {finance && (
        <section className="card">
          <h2>Payroll history</h2>
          <p className="note">Every approved week, one line per rider: gross, additions, deductions, net payable, paid so far and what is still outstanding.</p>
          <a className="btn" href="/reports/export?type=payroll">Download payroll history</a>
        </section>
      )}

      {finance && (
        <section className="card">
          <h2>Payments ledger</h2>
          <p className="note">Every payment you have recorded to riders, with date, method, bank reference and the week it was for. Reversals show as negative amounts.</p>
          <a className="btn" href="/reports/export?type=payments">Download payments ledger</a>
        </section>
      )}

      <form action="/reports/export" method="get" className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Trips &amp; earnings for any dates</h2>
        <input type="hidden" name="type" value="trips" />
        <div className="row">
          <label>From<input type="date" name="from" defaultValue={daysAgo(6)} required /></label>
          <label>To<input type="date" name="to" defaultValue={istToday()} required /></label>
        </div>
        <button type="submit" style={{ alignSelf: 'flex-start' }}>Download trips &amp; earnings</button>
        <p className="note">Two sheets: each rider&apos;s earnings per day, and every trip with its base pay, extra-km pay, batch bonus and total. Up to 93 days at a time. Dates are operational days (the day changes at midnight IST).</p>
      </form>
    </>
  );
}
