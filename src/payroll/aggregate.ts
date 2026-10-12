// Pure aggregation for daily earnings and weekly payroll. No database access here,
// so every number can be tested. All money is integer paise.
import { addDays, cycleFor, weekdayIndex, type PayrollCycle } from '../engine/calendar';
import { rateForRank, type RateCard } from '../engine/payout';

/** One saved trip joined with its current calculated earnings. */
export interface TripRecord {
  tripId: string;
  feId: string;
  riderName: string;
  phone: string;
  date: string; // operational date
  deliveredAt: string;
  orders: number;
  pickupKm100: number;
  dropKm100: number;
  firstRank: number;
  lastRank: number;
  basePaise: number;
  extraKm100: number;
  distancePaise: number;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  totalPaise: number;
  isRaining: boolean;
  zomatoDistancePaise: number;
  zomatoPayPaise: number;
  importFile: string;
}

export interface DailyRow {
  date: string;
  weekday: string;
  riderName: string;
  feId: string;
  orders: number;
  slab1Orders: number;
  slab2Orders: number;
  batchedOrders: number; // orders that were part of a batched trip
  km100: number;
  extraKm100: number;
  basePaise: number;
  distancePaise: number;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  adjustmentsPaise: number;
  totalPaise: number;
}

export interface RiderWeek {
  riderName: string;
  feId: string;
  phone: string;
  dayOrders: number[]; // Mon..Sun
  orders: number;
  slab1Orders: number;
  slab2Orders: number;
  basePaise: number;
  km100: number;
  extraKm100: number;
  distancePaise: number;
  batchedOrders: number;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  grossPaise: number;
  additionsPaise: number;
  deductionsPaise: number;
  netPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  status: string;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekdayName = (date: string) => WEEKDAYS[weekdayIndex(date)];

/** Orders in a trip split by slab (by daily rank). */
function slabSplit(r: TripRecord, card: RateCard): [number, number] {
  const first = card.slabs[0].ratePaise;
  let s1 = 0, s2 = 0;
  for (let k = r.firstRank; k <= r.lastRank; k++) (rateForRank(card, k) === first ? s1++ : s2++);
  return [s1, s2];
}

export function dailyRows(records: TripRecord[], card: RateCard): DailyRow[] {
  const m = new Map<string, DailyRow>();
  for (const r of records) {
    const key = `${r.date}|${r.feId}`;
    let d = m.get(key);
    if (!d) {
      d = { date: r.date, weekday: weekdayName(r.date), riderName: r.riderName, feId: r.feId, orders: 0, slab1Orders: 0, slab2Orders: 0, batchedOrders: 0, km100: 0, extraKm100: 0, basePaise: 0, distancePaise: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, adjustmentsPaise: 0, totalPaise: 0 };
      m.set(key, d);
    }
    const [s1, s2] = slabSplit(r, card);
    d.orders += r.orders; d.slab1Orders += s1; d.slab2Orders += s2;
    d.batchedOrders += r.orders > 1 ? r.orders : 0;
    d.km100 += r.pickupKm100 + r.dropKm100; d.extraKm100 += r.extraKm100;
    d.basePaise += r.basePaise; d.distancePaise += r.distancePaise; d.batchBonusPaise += r.batchBonusPaise;
    d.rainPaise += r.rainPaise; d.festivalPaise += r.festivalPaise; d.totalPaise += r.totalPaise;
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.feId.localeCompare(b.feId));
}

export interface WeekSummary {
  cycle: PayrollCycle;
  riders: RiderWeek[];
  totals: Omit<RiderWeek, 'riderName' | 'feId' | 'phone' | 'dayOrders' | 'status'> & { riders: number };
}

export function weekSummary(records: TripRecord[], card: RateCard, cycleStart: string): WeekSummary {
  const cycle = cycleFor(cycleStart);
  const inCycle = records.filter((r) => r.date >= cycle.start && r.date <= cycle.end);
  const map = new Map<string, RiderWeek>();
  for (const r of inCycle) {
    let w = map.get(r.feId);
    if (!w) {
      w = { riderName: r.riderName, feId: r.feId, phone: r.phone, dayOrders: [0, 0, 0, 0, 0, 0, 0], orders: 0, slab1Orders: 0, slab2Orders: 0, basePaise: 0, km100: 0, extraKm100: 0, distancePaise: 0, batchedOrders: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, grossPaise: 0, additionsPaise: 0, deductionsPaise: 0, netPaise: 0, paidPaise: 0, outstandingPaise: 0, status: 'Unpaid' };
      map.set(r.feId, w);
    }
    const [s1, s2] = slabSplit(r, card);
    w.dayOrders[weekdayIndex(r.date)] += r.orders;
    w.orders += r.orders; w.slab1Orders += s1; w.slab2Orders += s2;
    w.basePaise += r.basePaise; w.km100 += r.pickupKm100 + r.dropKm100; w.extraKm100 += r.extraKm100;
    w.distancePaise += r.distancePaise; w.batchedOrders += r.orders > 1 ? r.orders : 0; w.batchBonusPaise += r.batchBonusPaise;
    w.rainPaise += r.rainPaise; w.festivalPaise += r.festivalPaise;
  }
  const riders = [...map.values()].sort((a, b) => a.riderName.localeCompare(b.riderName));
  const t = { riders: riders.length, orders: 0, slab1Orders: 0, slab2Orders: 0, basePaise: 0, km100: 0, extraKm100: 0, distancePaise: 0, batchedOrders: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, grossPaise: 0, additionsPaise: 0, deductionsPaise: 0, netPaise: 0, paidPaise: 0, outstandingPaise: 0 };
  for (const w of riders) {
    w.grossPaise = w.basePaise + w.distancePaise + w.batchBonusPaise + w.rainPaise + w.festivalPaise;
    w.netPaise = w.grossPaise + w.additionsPaise - w.deductionsPaise;
    w.outstandingPaise = w.netPaise - w.paidPaise;
    for (const k of Object.keys(t) as (keyof typeof t)[]) if (k !== 'riders') t[k] += w[k as keyof RiderWeek] as number;
  }
  return { cycle, riders, totals: t };
}

export function latestCycleStart(records: TripRecord[]): string | null {
  if (!records.length) return null;
  return cycleFor(records.map((r) => r.date).sort().pop()!).start;
}
export { addDays };
