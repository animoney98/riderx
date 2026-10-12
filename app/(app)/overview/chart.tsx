// Charts drawn on the server as plain SVG: weekly bars and a donut split.
export interface Bar { label: string; revenuePaise: number; riderPaise: number }

const short = (paise: number) => {
  const r = paise / 100;
  return r >= 100000 ? `₹${(r / 100000).toFixed(1)}L` : r >= 1000 ? `₹${(r / 1000).toFixed(1)}k` : `₹${Math.round(r)}`;
};

export function WeeklyBars({ bars }: { bars: Bar[] }) {
  if (!bars.length) return <p className="note">No weeks imported yet.</p>;
  const W = 520, H = 230, padL = 6, padB = 30, padT = 34;
  const max = Math.max(1, ...bars.flatMap((b) => [b.revenuePaise, b.riderPaise]));
  const slot = (W - padL * 2) / bars.length;
  const bw = Math.min(30, slot * 0.52);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const last = bars.length - 1;
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Zomato payout and rider earnings by week">
        <defs>
          <linearGradient id="gViolet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".5" /><stop offset="1" stopColor="#FFFFFF" stopOpacity=".05" /></linearGradient>
          <linearGradient id="gVioletHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".95" /><stop offset="1" stopColor="#B9C6C8" stopOpacity=".35" /></linearGradient>
          <linearGradient id="gLime" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFC27F" /><stop offset="1" stopColor="#E8741F" /></linearGradient>
        </defs>
        {[0.5, 1].map((f) => <line key={f} x1={padL} x2={W - padL} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,.06)" strokeDasharray="3 5" />)}
        {bars.map((b, i) => {
          const cx = padL + slot * i + slot / 2;
          const isLast = i === last;
          const top = y(b.revenuePaise);
          const rtop = y(b.riderPaise);
          return (
            <g key={b.label}>
              <rect x={cx - bw / 2} y={top} width={bw} height={H - padB - top} rx="9" fill={isLast ? 'url(#gVioletHi)' : 'url(#gViolet)'} />
              <rect x={cx - bw / 2 + 5} y={rtop} width={bw - 10} height={Math.max(0, H - padB - rtop)} rx="5" fill="url(#gLime)" opacity={isLast ? 1 : 0.8} />
              {isLast
                ? <g><rect x={cx - 30} y={top - 28} width="60" height="22" rx="11" fill="rgba(10,12,13,.92)" stroke="rgba(255,255,255,.28)" /><text x={cx} y={top - 13} textAnchor="middle" style={{ fill: '#fff', fontWeight: 700 }}>{short(b.revenuePaise)}</text></g>
                : <text x={cx} y={top - 7} textAnchor="middle">{short(b.revenuePaise)}</text>}
              <text x={cx} y={H - 9} textAnchor="middle">{b.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend"><span><i style={{ background: 'rgba(255,255,255,.6)' }} />Zomato payout</span><span><i style={{ background: '#F39A3D' }} />Rider earnings</span></div>
    </>
  );
}

export interface Slice { label: string; paise: number; color: string }

/** Ring chart. Slices are drawn from the numbers given; nothing is estimated. */
export function Donut({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.paise, 0);
  const R = 62, C = 2 * Math.PI * R, gap = slices.length > 1 ? 5 : 0;
  let acc = 0;
  return (
    <svg viewBox="0 0 170 170" role="img" aria-label={`Split of ${centerLabel}`}>
      <circle cx="85" cy="85" r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="17" />
      {total > 0 && slices.map((s) => {
        const len = (s.paise / total) * C;
        const dash = Math.max(0, len - gap);
        const el = <circle key={s.label} cx="85" cy="85" r={R} fill="none" stroke={s.color} strokeWidth="17" strokeLinecap="round" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 85 85)" />;
        acc += len;
        return el;
      })}
      <text x="85" y="80" textAnchor="middle" className="midl">{centerLabel}</text>
      <text x="85" y="102" textAnchor="middle" className="mid">{centerValue}</text>
    </svg>
  );
}
