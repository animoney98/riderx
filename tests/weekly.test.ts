import { describe, it, expect } from 'vitest';
import { calculateTrips, DEFAULT_RATE_CARD, type Trip } from '../src/engine/payout';
import { buildDaily, buildWeekly, type EarnedTrip } from '../src/engine/weekly';
import { cycleFor } from '../src/engine/calendar';

const trip = (i: number, date: string, over: Partial<Trip> = {}): Trip => ({
  tripId: `T${date}-${String(i).padStart(3, '0')}`, riderKey: 'zomato:FE1', operationalDate: date,
  completedAt: `${date}T10:${String(i % 60).padStart(2, '0')}:00`, pickupKm100: 200, dropKm100: 200, ordersInTrip: 1, isRaining: false, ...over,
});
const earned = (trips: Trip[]): EarnedTrip[] =>
  calculateTrips(trips, DEFAULT_RATE_CARD).map((e) => ({
    feId: e.riderKey.replace('zomato:', ''), tripId: e.tripId, date: e.operationalDate, orders: e.orders,
    firstRank: e.firstRank, lastRank: e.lastRank, km100: e.totalKm100, extraKm100: e.extraKm100, basePaise: e.basePaise,
    distancePaise: e.distancePaise, batchBonusPaise: e.batchBonusPaise, rainPaise: e.rainPaise, festivalPaise: e.festivalPaise, totalPaise: e.totalPaise,
  }));

describe('daily and weekly aggregation', () => {
  it('30 orders in a day: 25 in slab 1, 5 in slab 2, ₹1,550', () => {
    const d = buildDaily(earned(Array.from({ length: 30 }, (_, i) => trip(i, '2026-10-12'))), 25);
    expect(d).toHaveLength(1);
    expect([d[0].orders, d[0].slab1Orders, d[0].slab2Orders, d[0].totalPaise]).toEqual([30, 25, 5, 155000]);
  });
  it('a batched trip straddling order 25/26 splits across slabs', () => {
    const t = [...Array.from({ length: 24 }, (_, i) => trip(i, '2026-10-12')), trip(99, '2026-10-12', { ordersInTrip: 2, completedAt: '2026-10-12T20:00:00' })];
    const d = buildDaily(earned(t), 25)[0];
    expect([d.orders, d.slab1Orders, d.slab2Orders, d.batchedTrips]).toEqual([26, 25, 1, 1]);
  });
  it('weekly rows put orders on the right weekday and ignore trips outside the cycle', () => {
    const t = [trip(1, '2026-10-12'), trip(2, '2026-10-12'), trip(3, '2026-10-18'), trip(4, '2026-10-19')];
    const w = buildWeekly(earned(t), cycleFor('2026-10-12'), 25);
    expect(w).toHaveLength(1);
    expect(w[0].ordersByDay).toEqual([2, 0, 0, 0, 0, 0, 1]);
    expect(w[0].orders).toBe(3);
    expect(w[0].grossPaise).toBe(15000);
  });
  it('weekly gross equals the sum of daily totals', () => {
    const t = [...Array.from({ length: 27 }, (_, i) => trip(i, '2026-10-13')), ...Array.from({ length: 5 }, (_, i) => trip(i, '2026-10-15', { pickupKm100: 500, dropKm100: 300, ordersInTrip: i === 0 ? 2 : 1 }))];
    const e = earned(t);
    const daily = buildDaily(e, 25).reduce((s, d) => s + d.totalPaise, 0);
    expect(buildWeekly(e, cycleFor('2026-10-13'), 25)[0].grossPaise).toBe(daily);
  });
});
