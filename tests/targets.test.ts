import { describe, it, expect } from 'vitest';
import { applyTargets, tierFor, validateTarget, type DayTarget } from '../src/engine/targets';

const t: DayTarget = { date: '2026-10-14', baseRatePaise: 6000, batchBonusPaise: 3000, tiers: [{ minOrders: 30, ratePaise: 6500 }, { minOrders: 50, ratePaise: 7000 }] };

describe('daily targets', () => {
  it('picks the highest tier reached', () => {
    expect(tierFor(t, 29)).toEqual({ ratePaise: 6000, tierMin: null });
    expect(tierFor(t, 30)).toEqual({ ratePaise: 6500, tierMin: 30 });
    expect(tierFor(t, 49).ratePaise).toBe(6500);
    expect(tierFor(t, 50).ratePaise).toBe(7000);
    expect(tierFor(t, 80).ratePaise).toBe(7000);
  });
  it('pays every trip of the day at the tier rate, batch bonus on top', () => {
    const [r] = applyTargets([{ feId: 'FE1', date: '2026-10-14', orders: 52, trips: 50, batchedTrips: 2, actualPaise: 50 * 7000 + 2 * 3000 }], [t]);
    expect(r.expectedPaise).toBe(50 * 7000 + 6000);
    expect(r.extraPaise).toBe(50 * 1000);
    expect(r.differencePaise).toBe(0);
  });
  it('shows a difference when the file paid less than the tier says', () => {
    const [r] = applyTargets([{ feId: 'FE1', date: '2026-10-14', orders: 50, trips: 50, batchedTrips: 0, actualPaise: 50 * 6000 }], [t]);
    expect(r.differencePaise).toBe(-50 * 1000);
  });
  it('ignores days without a target', () => {
    expect(applyTargets([{ feId: 'FE1', date: '2026-10-15', orders: 5, trips: 5, batchedTrips: 0, actualPaise: 0 }], [t])).toEqual([]);
  });
  it('validates tiers', () => {
    expect(() => validateTarget(t)).not.toThrow();
    expect(() => validateTarget({ ...t, tiers: [{ minOrders: 30, ratePaise: 5500 }] })).toThrow();
    expect(() => validateTarget({ ...t, tiers: [{ minOrders: 30, ratePaise: 6500 }, { minOrders: 30, ratePaise: 7000 }] })).toThrow();
    expect(() => validateTarget({ ...t, tiers: [{ minOrders: 30, ratePaise: 7000 }, { minOrders: 50, ratePaise: 6500 }] })).toThrow();
  });
});
