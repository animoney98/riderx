import { describe, it, expect } from 'vitest';
import { buildRateCard, rupeesToPaise, kmToKm100 } from '../src/engine/rateCardForm';
import { calculateTrips } from '../src/engine/payout';

const base = { name: 'RiderX default', version: 2, firstSlabOrders: '25', firstSlabRate: '50', laterRate: '60', includedKm: '6', extraKmRate: '5', batchBonus: '30', festivalPerOrder: '0', batchedTripBaseOrders: 1 };

describe('rate card form', () => {
  it('parses rupees and km exactly', () => {
    expect(rupeesToPaise('2,500.50', 'x')).toBe(250050);
    expect(rupeesToPaise('12.5', 'x')).toBe(1250);
    expect(kmToKm100('6.5', 'x')).toBe(650);
    expect(() => rupeesToPaise('abc', 'x')).toThrow();
    expect(() => rupeesToPaise('-5', 'x')).toThrow();
    expect(() => rupeesToPaise('1.234', 'x')).toThrow();
  });
  it('builds the current rates', () => {
    const c = buildRateCard(base);
    expect(c.slabs).toEqual([{ upToOrder: 25, ratePaise: 5000 }, { upToOrder: null, ratePaise: 6000 }]);
    expect(c.includedKm100).toBe(600);
    expect(c.batchedTripBaseOrders).toBe(1);
  });
  it('rain is fixed at 25 whatever the form says', () => {
    const c = buildRateCard({ ...base, rainPerOrder: '10', rainBatchedTrip: '99' });
    const [e] = calculateTrips([{ tripId: 'a', riderKey: 'r', operationalDate: '2026-10-12', completedAt: '2026-10-12T10:00:00', pickupKm100: 100, dropKm100: 100, ordersInTrip: 1, isRaining: true }], c);
    expect(e.totalPaise).toBe(5000 + 2500);
  });
  it('rejects a bad first slab', () => expect(() => buildRateCard({ ...base, firstSlabOrders: '0' })).toThrow());
});
