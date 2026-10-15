import { supabaseServer } from '@/lib/supabase-server';
import { UploadForm } from './upload-form';

const REQUIRED = ['dt', 'trip_id', 'orders', 'pay', 'delivered_at', 'pickup_distance', 'drop_distance', 'FE ID'];
const OPTIONAL: [string, string][] = [
  ['Total Payout', "Zomato's payout for the trip, including batch bonus. If missing, pay is used."],
  ['israining', '1 when it rained, used for the rain bonus.'],
  ['tip_amount', 'Stored but never counted in rider pay. Zomato pays tips to riders directly.'],
  ['DC / final_dc, Distance Amount, vendor_name, dispute_type', 'Stored for reference.'],
];
const ist = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const day = (d: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : '—');

export default async function ImportsPage() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  const { data: batches } = await sb.from('import_batches')
    .select('id, filename, file_checksum, imported_by, imported_at, status, source_period_start, source_period_end, total_rows, inserted_rows, skipped_rows, error_count')
    .order('imported_at', { ascending: false }).limit(50);
  const rows = batches ?? [];
  const who = new Map<string, string>();
  const ids = [...new Set(rows.map((b) => b.imported_by as string).filter(Boolean))];
  if (ids.length) {
    const { data: ps } = await sb.from('profiles').select('id, full_name').in('id', ids);
    for (const p of ps ?? []) who.set(p.id as string, p.full_name as string);
  }
  // The same file imported more than once shows as a repeat.
  const seen = new Map<string, number>();
  for (const b of [...rows].reverse()) seen.set(b.file_checksum as string, (seen.get(b.file_checksum as string) ?? 0) + 1);
  const nth = new Map<string, number>();
  const withRepeat = [...rows].reverse().map((b) => { const n = (nth.get(b.file_checksum as string) ?? 0) + 1; nth.set(b.file_checksum as string, n); return { b, repeat: n > 1 }; }).reverse();

  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Import Center</div>
        <h1>Import Zomato data</h1>
      </div>
      <UploadForm />

      <section className="card">
        <h2>How to import</h2>
        <div className="howto">
          <ol className="steps">
            <li>Get Zomato's <b>per-trip payout sheet</b> as an Excel file (.xlsx or .xls, up to 10 MB). Only the first sheet is read.</li>
            <li>Click <b>Choose file</b>, then <b>Check file</b>. This saves nothing. It shows what would be imported and any problems.</li>
            <li>Fix anything flagged. The FE ID column can hold just the number (11568286) or FE11568286; the system adds the FE itself. Every FE ID must already be a rider on the Riders page, otherwise the import is blocked until you add them.</li>
            <li>Click <b>Import</b>. Trips are saved and earnings are calculated with the rates in force on each day.</li>
            <li>Go to <b>Salary &amp; Payroll</b> to review and approve the week.</li>
          </ol>
          <div>
            <h3>Columns the file must have</h3>
            <p className="chips">{REQUIRED.map((c) => <code key={c}>{c}</code>)}</p>
            <h3>Used if present</h3>
            <ul className="plain">{OPTIONAL.map(([c, d]) => <li key={c}><code>{c}</code> {d}</li>)}</ul>
          </div>
        </div>
        <ul className="plain rules">
          <li><b>Rows are rejected,</b> and listed with the reason, if trip_id is empty or repeated, the FE ID is not a number (or FE followed by a number), distances are missing or negative, or orders is not 1 or 2.</li>
          <li><b>Uploading the same file again is safe.</b> It never creates duplicate trips. It also recalculates earnings for those days with the current rates. Weeks you have already approved keep their approved figures.</li>
          <li><b>A trip that Zomato later changes</b> is left as first saved and flagged for your review, never overwritten.</li>
          <li><b>Days run midnight to midnight (India time),</b> and weeks run Monday to Sunday, paid on the Friday after.</li>
        </ul>
      </section>

      <section className="card">
        <div className="cardhead"><h2>Import history</h2><span className="chipbtn">Latest {rows.length}</span></div>
        {!rows.length ? <p className="note">No files imported yet.</p> : (
          <div className="tbl">
            <table>
              <thead><tr><th>Imported</th><th>File</th><th>Trip dates</th><th className="n">Rows in file</th><th className="n">New trips saved</th><th className="n">Already saved</th><th className="n">Rows with problems</th><th>By</th></tr></thead>
              <tbody>
                {withRepeat.map(({ b, repeat }) => (
                  <tr key={b.id as string}>
                    <td>{ist(b.imported_at as string)}</td>
                    <td><b>{b.filename as string}</b>{repeat && <div className="note">Same file as an earlier import</div>}</td>
                    <td>{day(b.source_period_start as string | null)} to {day(b.source_period_end as string | null)}</td>
                    <td className="n">{b.total_rows as number}</td>
                    <td className="n">{b.inserted_rows as number}</td>
                    <td className="n">{b.skipped_rows as number}</td>
                    <td className="n">{(b.error_count as number) > 0 ? <span className="pill p-warn">{b.error_count as number}</span> : '0'}</td>
                    <td>{b.imported_by === auth.user?.id ? 'You' : who.get(b.imported_by as string) ?? 'Team member'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Every import is kept permanently. “Already saved” counts trips that were in the system before this file, so a repeat upload shows 0 new trips.</p>
      </section>
    </>
  );
}
