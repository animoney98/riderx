// Zomato daily target tiers: reach N orders in a day and ALL of that rider's orders that day pay a higher Zomato rate.
// This is RiderX revenue only; rider pay is unchanged.
export interface Tier { minOrders: number; ratePaise: number }
export interface DayTarget { date: string; baseRatePaise: number; batchBonusPaise: number; tiers: Tier[] }
export interface RiderDay { feId: string; date: string; orders: number; trips: number; batchedTrips: number; actualPaise: number }
export interface TargetResult extends RiderDay { ratePaise: number; tierMin: number | null; expectedPaise: number; extraPaise: number; differencePaise: number }

export function tierFor(t: DayTarget, orders: number): { ratePaise: number; tierMin: number | null } {
  let best: Tier | null = null;
  for (const x of t.tiers) if (orders >= x.minOrders && (!best || x.minOrders > best.minOrders)) best = x;
  return best ? { ratePaise: best.ratePaise, tierMin: best.minOrders } : { ratePaise: t.baseRatePaise, tierMin: null };
}

export function validateTarget(t: DayTarget): void {
  if (t.baseRatePaise <= 0) throw new Error('The standard Zomato rate must be above zero');
  const seen = new Set<number>();
  for (const x of t.tiers) {
    if (!Number.isInteger(x.minOrders) || x.minOrders < 1) throw new Error('Each tier needs a whole number of orders, 1 or more');
    if (seen.has(x.minOrders)) throw new Error('Two tiers have the same number of orders');
    seen.add(x.minOrders);
    if (x.ratePaise <= t.baseRatePaise) throw new Error('A tier rate must be higher than the standard rate');
  }
  const sorted = [...t.tiers].sort((a, b) => a.minOrders - b.minOrders);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].ratePaise <= sorted[i - 1].ratePaise) throw new Error('A tier with more orders must pay a higher rate');
}

/**
 * Per rider-day: the rate the tiers say Zomato should pay, what that comes to (rate per TRIP, plus the batch bonus per batched trip),
 * the extra earned over the standard rate, and the difference from what the Zomato file actually paid.
 */
export function applyTargets(days: RiderDay[], targets: DayTarget[]): TargetResult[] {
  const byDate = new Map(targets.map((t) => [t.date, t]));
  const out: TargetResult[] = [];
  for (const d of days) {
    const t = byDate.get(d.date);
    if (!t) continue;
    const { ratePaise, tierMin } = tierFor(t, d.orders);
    const expectedPaise = d.trips * ratePaise + d.batchedTrips * t.batchBonusPaise;
    out.push({ ...d, ratePaise, tierMin, expectedPaise, extraPaise: d.trips * (ratePaise - t.baseRatePaise), differencePaise: d.actualPaise - expectedPaise });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.feId.localeCompare(b.feId));
}
