// Revenue (what Zomato pays RiderX) versus cost (what RiderX owes riders). Pure functions, integer paise.
export interface FinanceTrip { feId: string; orders: number; revenuePaise: number; riderPaise: number }
export interface MarginRow { feId: string; orders: number; trips: number; revenuePaise: number; riderPaise: number; marginPaise: number }
export interface MarginTotals { orders: number; trips: number; revenuePaise: number; riderPaise: number; marginPaise: number; marginPct: number | null }

export function buildMargin(trips: FinanceTrip[]): { rows: MarginRow[]; totals: MarginTotals } {
  const m = new Map<string, MarginRow>();
  for (const t of trips) {
    const r = m.get(t.feId) ?? { feId: t.feId, orders: 0, trips: 0, revenuePaise: 0, riderPaise: 0, marginPaise: 0 };
    r.orders += t.orders; r.trips += 1; r.revenuePaise += t.revenuePaise; r.riderPaise += t.riderPaise;
    r.marginPaise = r.revenuePaise - r.riderPaise;
    m.set(t.feId, r);
  }
  const rows = [...m.values()].sort((a, b) => a.feId.localeCompare(b.feId));
  const sum = (f: (r: MarginRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const revenuePaise = sum((r) => r.revenuePaise);
  const riderPaise = sum((r) => r.riderPaise);
  return {
    rows,
    totals: {
      orders: sum((r) => r.orders), trips: sum((r) => r.trips), revenuePaise, riderPaise, marginPaise: revenuePaise - riderPaise,
      marginPct: revenuePaise > 0 ? Math.round(((revenuePaise - riderPaise) * 10000) / revenuePaise) / 100 : null,
    },
  };
}
