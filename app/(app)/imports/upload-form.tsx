'use client';
import { useActionState } from 'react';
import { importAction, type Preview } from './actions';

export function UploadForm() {
  const [res, action, pending] = useActionState<Preview | null, FormData>(importAction, null);
  return (
    <>
      <form action={action} className="card">
        <h2>Upload a Zomato payout file</h2>
        <div className="row">
          <label>Excel file (.xlsx)<input type="file" name="file" accept=".xlsx,.xls" required /></label>
          <input type="hidden" name="checksum" value={res?.checksum ?? ''} />
          <button type="submit" name="intent" value="preview" disabled={pending}>{pending ? 'Working…' : 'Check file'}</button>
          {res?.ok && res.canImport && !res.committed && (
            <button type="submit" name="intent" value="commit" disabled={pending}>Import {res.validRows} trips</button>
          )}
        </div>
        <p className="note">"Check file" saves nothing. "Import" saves the trips and calculates earnings. Importing the same file twice never creates duplicates.</p>
      </form>

      {res?.committed && (
        <div className="alert ok" role="status">
          Imported {res.committed.inserted} new trips. {res.committed.identical} were already saved and unchanged.
          {res.committed.conflicts > 0 && ` ${res.committed.conflicts} trips differ from what was saved earlier and were left untouched for review.`}
          {' '}Earnings calculated for {res.committed.earningsWritten} trips.
        </div>
      )}
      {res?.fatal && <div className="alert bad" role="alert">{res.fatal}</div>}

      {res?.ok && !res.committed && (
        <>
          <div className="grid">
            <div className="stat"><span>Rows in file</span><b>{res.totalRows}</b></div>
            <div className="stat"><span>Valid trips</span><b>{res.validRows}</b></div>
            <div className="stat"><span>Rows with problems</span><b>{res.issues?.length}</b></div>
            <div className="stat"><span>Batched trips</span><b>{res.batched}</b></div>
            <div className="stat"><span>Already in system</span><b>{res.alreadyImported}</b></div>
            <div className="stat"><span>Dates</span><b style={{ fontSize: 15 }}>{res.dateRange}</b></div>
          </div>

          {!!res.alreadyImported && <div className="alert warn">{res.alreadyImported} trips in this file were imported before. They will be skipped, never duplicated.</div>}
          {res.cycles?.map((c) => (
            <div key={c.start} className="note">Pay cycle {c.start} to {c.end} · scheduled payment Friday {c.payDate}</div>
          ))}
          {res.riders?.some((r) => !r.matched) && (
            <div className="alert warn">Some FE IDs are not registered as riders yet. Add them on the Riders page before importing, or their earnings can't be assigned.</div>
          )}

          <section className="card">
            <h2>Calculated rider pay (preview)</h2>
            <div className="tbl">
              <table>
                <thead><tr><th>FE ID</th><th>Rider</th><th className="n">Orders</th><th className="n">Extra km</th><th className="n">Base</th><th className="n">Distance</th><th className="n">Batch</th><th className="n">Rain</th><th className="n">Rider pay</th><th className="n">Zomato pays RiderX</th></tr></thead>
                <tbody>
                  {res.riders?.map((r) => (
                    <tr key={r.feId}>
                      <td>{r.feId}</td>
                      <td>{r.matched ? r.name : <span className="pill p-warn">Not registered</span>}</td>
                      <td className="n">{r.orders}</td><td className="n">{r.extraKm}</td><td className="n">{r.base}</td><td className="n">{r.distance}</td>
                      <td className="n">{r.batch}</td><td className="n">{r.rain}</td><td className="n"><b>{r.total}</b></td><td className="n">{r.zomatoPay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Total rider pay {res.totals?.riderPay} against Zomato's {res.totals?.zomatoPay} to RiderX. Tips of {res.totals?.tipsIgnored} are excluded, as Zomato pays them to riders directly. Rain bonus shows ₹0 until a rate is set. Penalties are not applied yet.
            </p>
          </section>

          {!!res.issues?.length && (
            <section className="card">
              <h2>Problems found</h2>
              <div className="tbl">
                <table><thead><tr><th>Row</th><th>Code</th><th>Problem</th></tr></thead>
                  <tbody>{res.issues.slice(0, 50).map((i) => <tr key={i.row + i.code}><td>{i.row}</td><td>{i.code}</td><td>{i.message}</td></tr>)}</tbody></table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
