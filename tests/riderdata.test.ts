import { describe, it, expect } from 'vitest';
import { groupDays, type RiderTrip } from '../lib/rider-data';

const t = (date: string, orders: number, total: number, isFinal = false): RiderTrip => ({
  tripId: Math.random().toString(), date, deliveredAt: date + ' 10:00', orders, raining: false, pickupKm100: 300, dropKm100: 400,
  basePaise: 5000, extraKm100: 100, distancePaise: 500, batchBonusPaise: orders > 1 ? 3000 : 0, rainPaise: 0, festivalPaise: 0, totalPaise: total, isFinal,
});

describe('rider day view', () => {
  it('sums a day and counts batched trips', () => {
    const [d] = groupDays([t('2026-10-13', 1, 5500), t('2026-10-13', 2, 8500)]);
    expect(d.orders).toBe(3);
    expect(d.trips).toBe(2);
    expect(d.batchedTrips).toBe(1);
    expect(d.totalPaise).toBe(14000);
    expect(d.batchBonusPaise).toBe(3000);
  });
  it('is final only when every trip is final', () => {
    expect(groupDays([t('2026-10-13', 1, 1, true), t('2026-10-13', 1, 1, false)])[0].isFinal).toBe(false);
    expect(groupDays([t('2026-10-13', 1, 1, true)])[0].isFinal).toBe(true);
  });
  it('lists newest day first', () => {
    expect(groupDays([t('2026-10-12', 1, 1), t('2026-10-14', 1, 1)]).map((d) => d.date)).toEqual(['2026-10-14', '2026-10-12']);
  });
});
