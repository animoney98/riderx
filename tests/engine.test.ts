import { describe, it, expect } from 'vitest';
import { calculateTrips, dailyTotals, DEFAULT_RATE_CARD, formatINR, type Trip } from '../src/engine/payout';
import { cycleFor, weekdayIndex } from '../src/engine/calendar';

const mk = (n: number, over: Partial<Trip> = {}, km100 = 400): Trip[] =>
  Array.from({ length: n }, (_, i) => ({
    tripId: `T${String(i).padStart(3, '0')}`,
    riderKey: 'zomato:FE1',
    operationalDate: '2026-10-12',
    completedAt: `2026-10-12T10:${String(i % 60).padStart(2, '0')}:00`,
    pickupKm100: km100 / 2,
    dropKm100: km100 / 2,
    ordersInTrip: 1,
    isRaining: false,
    ...over,
  }));
const total = (t: Trip[], card = DEFAULT_RATE_CARD) => calculateTrips(t, card).reduce((s, e) => s + e.totalPaise, 0);

describe('payout engine (spec examples)', () => {
  it('20 orders at 4 km = ₹1,000', () => expect(total(mk(20))).toBe(100000));
  it('25 orders = ₹1,250 (last of first slab)', () => expect(total(mk(25))).toBe(125000));
  it('26 orders = ₹1,310 (first at ₹60)', () => expect(total(mk(26))).toBe(131000));
  it('30 orders at 4 km = ₹1,550', () => expect(total(mk(30))).toBe(155000));
  it('exactly 6 km has no extra distance', () => expect(total(mk(1, {}, 600))).toBe(5000));
  it('8 km order = ₹50 + ₹10', () => expect(total(mk(1, {}, 800))).toBe(6000));
  it('8 km batched trip: 2 orders ₹100 + ₹10 + ₹30', () => expect(total(mk(1, { ordersInTrip: 2 }, 800))).toBe(14000));
  it('7.5 km = ₹57.50', () => expect(total(mk(1, {}, 750))).toBe(5750));
  it('distance is pickup + drop combined (3.74 + 2.46 = 6.20 -> 0.20 km = ₹1)', () => {
    const [e] = calculateTrips(mk(1, { pickupKm100: 246, dropKm100: 374 }), DEFAULT_RATE_CARD);
    expect(e.extraKm100).toBe(20);
    expect(e.distancePaise).toBe(100);
  });
  it('batched trip straddling the 25/26 boundary uses each order rank', () => {
    const t = [...mk(24), ...mk(1, { tripId: 'Z', ordersInTrip: 2, completedAt: '2026-10-12T20:00:00' })];
    const e = calculateTrips(t, DEFAULT_RATE_CARD).find((x) => x.tripId === 'Z')!;
    expect(e.basePaise).toBe(5000 + 6000);
    expect(e.firstRank).toBe(25);
    expect(e.lastRank).toBe(26);
  });
  it('rain bonus is per order and only when raining', () => {
    const card = { ...DEFAULT_RATE_CARD, rainBonusPaisePerOrder: 2500 };
    expect(total(mk(2, { isRaining: true }), card)).toBe(2 * (5000 + 2500));
    expect(total(mk(2), card)).toBe(2 * 5000);
  });
  it('daily slab resets each day and each rider', () => {
    const t = [...mk(26), ...mk(26, { operationalDate: '2026-10-13' }), ...mk(26, { riderKey: 'zomato:FE2' })];
    const days = dailyTotals(calculateTrips(t, DEFAULT_RATE_CARD));
    expect(days).toHaveLength(3);
    for (const d of days) expect(d.totalPaise).toBe(131000);
  });
  it('is deterministic regardless of input order', () => {
    const t = mk(30);
    const a = calculateTrips(t, DEFAULT_RATE_CARD).map((e) => [e.tripId, e.totalPaise]);
    const b = calculateTrips([...t].reverse(), DEFAULT_RATE_CARD).map((e) => [e.tripId, e.totalPaise]);
    expect(b.sort()).toEqual(a.sort());
  });
  it('rejects negative distance', () => {
    expect(() => calculateTrips(mk(1, { pickupKm100: -1 }), DEFAULT_RATE_CARD)).toThrow();
  });
  it('formats INR with Indian grouping', () => {
    expect(formatINR(12500000)).toBe('₹1,25,000.00');
    expect(formatINR(5750)).toBe('₹57.50');
  });
});

describe('payroll calendar', () => {
  it('Mon 12 Oct 2026 cycle pays Fri 23 Oct 2026', () => {
    expect(cycleFor('2026-10-12')).toEqual({ start: '2026-10-12', end: '2026-10-18', payDate: '2026-10-23' });
  });
  it('Sunday belongs to the cycle that started the Monday before', () => {
    expect(cycleFor('2026-10-18').start).toBe('2026-10-12');
    expect(cycleFor('2026-10-19').start).toBe('2026-10-19');
  });
  it('pay date is always a Friday', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-12-31', '2027-03-15']) expect(weekdayIndex(cycleFor(d).payDate)).toBe(4);
  });
});
