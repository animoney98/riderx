import { describe, it, expect } from 'vitest';
import { loadRateCard } from '../lib/rate-card';
import { DEFAULT_RATE_CARD } from '../src/engine/payout';
import { calculateTrips } from '../src/engine/payout';

// Minimal stand-in for the Supabase query chain.
const fake = (rows: Record<string, unknown>[]) => ({
  from: () => {
    let f: Record<string, unknown>[] = rows;
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, order: () => q,
      lte: (_c: string, d: string) => { f = f.filter((r) => (r.effective_start as string) <= d); return q; },
      limit: () => Promise.resolve({ data: f }),
    };
    return q;
  },
}) as never;

const std = { id: 'std', name: 'RiderX default', effective_start: '2026-01-01', effective_end: null, configuration: DEFAULT_RATE_CARD };
const sp = { id: 'sp', name: 'Special day 2026-10-20', effective_start: '2026-10-20', effective_end: '2026-10-20', configuration: { ...DEFAULT_RATE_CARD, slabs: [{ upToOrder: 25, ratePaise: 7000 }, { upToOrder: null, ratePaise: 8000 }] } };

describe('special day rates', () => {
  it('apply on their date only', async () => {
    const sb = fake([sp, std]);
    expect((await loadRateCard(sb, '2026-10-20')).id).toBe('sp');
    expect((await loadRateCard(sb, '2026-10-21')).id).toBe('std');
    expect((await loadRateCard(sb, '2026-10-19')).id).toBe('std');
  });
  it('standardOnly ignores them', async () => {
    expect((await loadRateCard(fake([sp, std]), '2026-10-20', { standardOnly: true })).id).toBe('std');
  });
  it('pays the special base rate', async () => {
    const c = (await loadRateCard(fake([sp, std]), '2026-10-20')).card;
    const [e] = calculateTrips([{ tripId: 'a', riderKey: 'r', operationalDate: '2026-10-20', completedAt: '2026-10-20T10:00:00', pickupKm100: 100, dropKm100: 100, ordersInTrip: 1, isRaining: false }], c);
    expect(e.totalPaise).toBe(7000);
  });
});
