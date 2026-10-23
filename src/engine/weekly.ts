// Aggregation of stored per-trip earnings into daily rows and Monday-Sunday payroll rows.
// Pure functions: the same code feeds the screens and (later) the Excel export, so totals cannot disagree.
import { addDays, cycleFor, weekdayIndex, type PayrollCycle } from './calendar';

export interface EarnedTrip {
  feId: string;
  tripId: string;
  date: string; // operational date, YYYY-MM-DD
  orders: number;
  firstRank: number;
  lastRank: number;
  km100: number;
  extraKm100: number;
  basePaise: number;
  distancePaise: number;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  totalPaise: number;
}

export interface TripDetail extends EarnedTrip {
  deliveredAt: string;
  pickupKm100: number;
  dropKm100: number;
  raining: boolean;
}

export interface DailyRow {
  feId: string;
  date: string;
  orders: number;
  slab1Orders: number;
  slab2Orders: number;
  trips: number;
  batchedTrips: number;
  km100: number;
  extraKm100: number;
  basePaise: number;
  distancePaise: number;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  totalPaise: number;
}

export interface WeeklyRow {
  feId: string;
  /** Orders per weekday, Monday first. */
  ordersByDay: number[];
  orders: number;
  slab1Orders: number;
  slab2Orders: number;
  /** Orders delivered alone (not in a batched trip). */
  singleOrders: number;
  batchedTrips: number;
  km100: number;
  extraKm100: number;
  basePaise: number;
  distancePaise: number;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  incentivesPaise: number;
  grossPaise: number;
}

/** Orders in a trip whose daily rank is within the first slab. */
export function slab1Count(t: Pick<EarnedTrip, 'firstRank' | 'lastRank'>, slab1Limit: number): number {
  const top = Math.min(t.lastRank, slab1Limit);
  return Math.max(0, top - t.firstRank + 1);
}

export function buildDaily(trips: EarnedTrip[], slab1Limit: number): DailyRow[] {
  const m = new Map<string, DailyRow>();
  for (const t of trips) {
    const key = `${t.feId}|${t.date}`;
    let d = m.get(key);
    if (!d) {
      d = { feId: t.feId, date: t.date, orders: 0, slab1Orders: 0, slab2Orders: 0, trips: 0, batchedTrips: 0, km100: 0, extraKm100: 0, basePaise: 0, distancePaise: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, totalPaise: 0 };
      m.set(key, d);
    }
    const s1 = slab1Count(t, slab1Limit);
    d.orders += t.orders; d.slab1Orders += s1; d.slab2Orders += t.orders - s1;
    d.trips += 1; d.batchedTrips += t.orders > 1 ? 1 : 0;
    d.km100 += t.km100; d.extraKm100 += t.extraKm100;
    d.basePaise += t.basePaise; d.distancePaise += t.distancePaise; d.batchBonusPaise += t.batchBonusPaise;
    d.rainPaise += t.rainPaise; d.festivalPaise += t.festivalPaise; d.totalPaise += t.totalPaise;
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.feId.localeCompare(b.feId));
}

export function buildWeekly(trips: EarnedTrip[], cycle: PayrollCycle, slab1Limit: number): WeeklyRow[] {
  const m = new Map<string, WeeklyRow>();
  for (const t of trips) {
    if (t.date < cycle.start || t.date > cycle.end) continue;
    let w = m.get(t.feId);
    if (!w) {
      w = { feId: t.feId, ordersByDay: [0, 0, 0, 0, 0, 0, 0], orders: 0, slab1Orders: 0, slab2Orders: 0, singleOrders: 0, batchedTrips: 0, km100: 0, extraKm100: 0, basePaise: 0, distancePaise: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, incentivesPaise: 0, grossPaise: 0 };
      m.set(t.feId, w);
    }
    const s1 = slab1Count(t, slab1Limit);
    w.ordersByDay[weekdayIndex(t.date)] += t.orders;
    w.orders += t.orders; w.slab1Orders += s1; w.slab2Orders += t.orders - s1;
    w.singleOrders += t.orders === 1 ? 1 : 0;
    w.batchedTrips += t.orders > 1 ? 1 : 0;
    w.km100 += t.km100; w.extraKm100 += t.extraKm100;
    w.basePaise += t.basePaise; w.distancePaise += t.distancePaise; w.batchBonusPaise += t.batchBonusPaise;
    w.rainPaise += t.rainPaise; w.festivalPaise += t.festivalPaise;
    w.incentivesPaise += t.batchBonusPaise + t.rainPaise + t.festivalPaise;
    w.grossPaise += t.totalPaise;
  }
  return [...m.values()].sort((a, b) => a.feId.localeCompare(b.feId));
}

export function weekStartFor(date: string): string {
  return cycleFor(date).start;
}
export { addDays, cycleFor };
