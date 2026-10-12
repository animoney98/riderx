// Weekly bars: what Zomato paid vs what riders earned. Plain SVG, drawn on the server.
export interface Bar { label: string; revenuePaise: number; riderPaise: number }

const short = (paise: number) => {
  const r = paise / 100;
  return r >= 100000 ? `₹${(r / 100000).toFixed(1)}L` : r >= 1000 ? `₹${(r / 1000).toFixed(1)}k` : `₹${Math.round(r)}`;
};

export function WeeklyBars({ bars }: { bars: Bar[] }) {
  if (!bars.length) return null;
  const W = 720, H = 240, padL = 8, padB = 28, padT = 22;
  const max = Math.max(1, ...bars.flatMap((b) => [b.revenuePaise, b.riderPaise]));
  const slot = (W - padL * 2) / bars.length;
  const bw = Math.min(26, slot / 3);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Zomato payout and rider earnings by week">
        <defs>
          <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF8F45" /><stop offset="1" stopColor="#F26A1B" stopOpacity=".55" /></linearGradient>
          <linearGradient id="gMuted" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E8D9CC" stopOpacity=".55" /><stop offset="1" stopColor="#E8D9CC" stopOpacity=".12" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={padL} x2={W - padL} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,.06)" />)}
        {bars.map((b, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={b.label}>
              <rect x={cx - bw - 2} y={y(b.revenuePaise)} width={bw} height={H - padB - y(b.revenuePaise)} rx="6" fill="url(#gOrange)" />
              <rect x={cx + 2} y={y(b.riderPaise)} width={bw} height={H - padB - y(b.riderPaise)} rx="6" fill="url(#gMuted)" />
              <text x={cx - bw / 2 - 2} y={y(b.revenuePaise) - 6} textAnchor="middle">{short(b.revenuePaise)}</text>
              <text x={cx} y={H - 8} textAnchor="middle">{b.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend"><span><i style={{ background: '#FF8F45' }} />Zomato payout</span><span><i style={{ background: 'rgba(232,217,204,.5)' }} />Rider earnings</span></div>
    </>
  );
}
