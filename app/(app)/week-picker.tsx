import Link from 'next/link';
import { addDays } from '@/src/engine/calendar';

const label = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDate = label;

export function WeekPicker({ path, start, payDate }: { path: string; start: string; payDate?: string }) {
  const end = addDays(start, 6);
  return (
    <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <Link className="btn" style={{ display: 'inline-flex', alignItems: 'center', background: '#fff', border: '1px solid #CFCBC4' }} href={`${path}?week=${addDays(start, -7)}`} aria-label="Previous week">&larr;</Link>
        <div>
          <div className="note">Week (Monday to Sunday)</div>
          <b style={{ fontSize: 18 }}>{label(start)} to {label(end)}</b>
        </div>
        <Link className="btn" style={{ display: 'inline-flex', alignItems: 'center', background: '#fff', border: '1px solid #CFCBC4' }} href={`${path}?week=${addDays(start, 7)}`} aria-label="Next week">&rarr;</Link>
      </div>
      {payDate && (
        <div>
          <div className="note">Scheduled payment (Friday of the following week)</div>
          <b style={{ fontSize: 18 }}>{label(payDate)}</b>
        </div>
      )}
    </div>
  );
}
