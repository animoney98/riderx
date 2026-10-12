import { describe, it, expect } from 'vitest';
import { buildMargin } from '../src/engine/finance';

describe('margin', () => {
  const trips = [
    { feId: 'FE1', orders: 1, revenuePaise: 6000, riderPaise: 5000 },
    { feId: 'FE1', orders: 2, revenuePaise: 9000, riderPaise: 8000 },
    { feId: 'FE2', orders: 1, revenuePaise: 6500, riderPaise: 5000 },
  ];
  it('sums per rider and in total', () => {
    const { rows, totals } = buildMargin(trips);
    expect(rows.map((r) => [r.feId, r.orders, r.marginPaise])).toEqual([['FE1', 3, 2000], ['FE2', 1, 1500]]);
    expect(totals).toMatchObject({ orders: 4, revenuePaise: 21500, riderPaise: 18000, marginPaise: 3500 });
    expect(totals.marginPct).toBe(16.28);
  });
  it('rider margins add up to the total', () => {
    const { rows, totals } = buildMargin(trips);
    expect(rows.reduce((s, r) => s + r.marginPaise, 0)).toBe(totals.marginPaise);
  });
  it('empty week has no percentage', () => expect(buildMargin([]).totals.marginPct).toBeNull());
});
