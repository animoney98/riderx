// RiderX payout engine. The single source of truth for rider earnings.
// All money is integer paise. All distances are integer hundredths of a km
// (Zomato reports 2 decimals), so no floating-point error can creep in.

export interface RateCard {
  name: string;
  version: number;
  /** Slabs by daily order rank. Last slab must have upToOrder = null (no limit). */
  slabs: { upToOrder: number | null; ratePaise: number }[];
  /** Allowance per trip, pickup + drop combined, in hundredths of km. */
  includedKm100: number;
  /** Paid per extra km, in paise. */
  extraKmRatePaise: number;
  /** Paid once per batched trip. */
  batchBonusPaise: number;
  /** Rain bonus per order in a trip flagged as raining. Varies; set per rate card. */
  rainBonusPaisePerOrder: number;
  /** Festival bonus per order (0 when no festival). */
  festivalBonusPaisePerOrder: number;
}

export const DEFAULT_RATE_CARD: RateCard = {
  name: 'RiderX default',
  version: 1,
  slabs: [
    { upToOrder: 25, ratePaise: 5000 },
    { upToOrder: null, ratePaise: 6000 },
  ],
  includedKm100: 600,
  extraKmRatePaise: 500,
  batchBonusPaise: 3000,
  rainBonusPaisePerOrder: 0,
  festivalBonusPaisePerOrder: 0,
};

export interface Trip {
  tripId: string;
  riderKey: string; // platform + FE ID
  /** Operational date (IST) the trip belongs to, YYYY-MM-DD. */
  operationalDate: string;
  /** Sort key within the day, e.g. delivered time as ISO text. */
  completedAt: string;
  pickupKm100: number;
  dropKm100: number;
  /** 1 for a normal trip, 2 for a batched trip. */
  ordersInTrip: number;
  isRaining: boolean;
}

export interface TripEarning {
  tripId: string;
  riderKey: string;
  operationalDate: string;
  firstRank: number;
  lastRank: number;
  orders: number;
  slabOrders: { ratePaise: number; count: number }[];
  basePaise: number;
  totalKm100: number;
  extraKm100: number;
  distancePaise: number;
  batched: boolean;
  batchBonusPaise: number;
  rainPaise: number;
  festivalPaise: number;
  totalPaise: number;
}

export function rateForRank(card: RateCard, rank: number): number {
  for (const s of card.slabs) {
    if (s.upToOrder === null || rank <= s.upToOrder) return s.ratePaise;
  }
  throw new Error('Rate card has no open-ended final slab');
}

/** Integer division rounding half up (amounts are never negative here). */
function divRound(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export function validateRateCard(card: RateCard): void {
  if (!card.slabs.length) throw new Error('Rate card needs at least one slab');
  const last = card.slabs[card.slabs.length - 1];
  if (last.upToOrder !== null) throw new Error('Final slab must have no upper limit');
  let prev = 0;
  for (const s of card.slabs.slice(0, -1)) {
    if (s.upToOrder === null || s.upToOrder <= prev) throw new Error('Slab limits must increase');
    prev = s.upToOrder;
  }
}

/**
 * Calculates earnings for every trip. Order within a rider-day is
 * deterministic: completedAt, then tripId. A batched trip consumes
 * `ordersInTrip` ranks, each paid at the slab rate for its rank.
 */
export function calculateTrips(trips: Trip[], card: RateCard): TripEarning[] {
  validateRateCard(card);
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const key = `${t.riderKey}|${t.operationalDate}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: TripEarning[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) =>
      a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : a.tripId < b.tripId ? -1 : a.tripId > b.tripId ? 1 : 0,
    );
    let rank = 0;
    for (const t of list) {
      if (!Number.isInteger(t.pickupKm100) || !Number.isInteger(t.dropKm100) || t.pickupKm100 < 0 || t.dropKm100 < 0)
        throw new Error(`Invalid distance on trip ${t.tripId}`);
      const firstRank = rank + 1;
      const slabs = new Map<number, number>();
      let base = 0;
      for (let i = 0; i < t.ordersInTrip; i++) {
        rank += 1;
        const r = rateForRank(card, rank);
        base += r;
        slabs.set(r, (slabs.get(r) ?? 0) + 1);
      }
      const totalKm100 = t.pickupKm100 + t.dropKm100;
      const extraKm100 = Math.max(0, totalKm100 - card.includedKm100);
      const distancePaise = divRound(extraKm100 * card.extraKmRatePaise, 100);
      const batched = t.ordersInTrip > 1;
      const batchBonusPaise = batched ? card.batchBonusPaise : 0;
      const rainPaise = t.isRaining ? card.rainBonusPaisePerOrder * t.ordersInTrip : 0;
      const festivalPaise = card.festivalBonusPaisePerOrder * t.ordersInTrip;
      out.push({
        tripId: t.tripId,
        riderKey: t.riderKey,
        operationalDate: t.operationalDate,
        firstRank,
        lastRank: rank,
        orders: t.ordersInTrip,
        slabOrders: [...slabs].map(([ratePaise, count]) => ({ ratePaise, count })),
        basePaise: base,
        totalKm100,
        extraKm100,
        distancePaise,
        batched,
        batchBonusPaise,
        rainPaise,
        festivalPaise,
        totalPaise: base + distancePaise + batchBonusPaise + rainPaise + festivalPaise,
      });
    }
  }
  return out;
}

export interface DailyTotals {
  riderKey: string;
  operationalDate: string;
  orders: number;
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

export function dailyTotals(earnings: TripEarning[]): DailyTotals[] {
  const m = new Map<string, DailyTotals>();
  for (const e of earnings) {
    const key = `${e.riderKey}|${e.operationalDate}`;
    let d = m.get(key);
    if (!d) {
      d = { riderKey: e.riderKey, operationalDate: e.operationalDate, orders: 0, trips: 0, batchedTrips: 0, km100: 0, extraKm100: 0, basePaise: 0, distancePaise: 0, batchBonusPaise: 0, rainPaise: 0, festivalPaise: 0, totalPaise: 0 };
      m.set(key, d);
    }
    d.orders += e.orders; d.trips += 1; d.batchedTrips += e.batched ? 1 : 0;
    d.km100 += e.totalKm100; d.extraKm100 += e.extraKm100;
    d.basePaise += e.basePaise; d.distancePaise += e.distancePaise; d.batchBonusPaise += e.batchBonusPaise;
    d.rainPaise += e.rainPaise; d.festivalPaise += e.festivalPaise; d.totalPaise += e.totalPaise;
  }
  return [...m.values()].sort((a, b) => (a.riderKey + a.operationalDate).localeCompare(b.riderKey + b.operationalDate));
}

export function formatINR(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  // Indian digit grouping: last 3, then groups of 2
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `${neg ? '-' : ''}₹${grouped}.${frac}`;
}
