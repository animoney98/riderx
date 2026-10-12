import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseZomatoWorkbook, toTrips } from '../src/import/zomatoParser.js';
import { calculateTrips, DEFAULT_RATE_CARD } from '../src/engine/payout.js';
import { cycleFor } from '../src/engine/calendar.js';

// Real sample is not committed. Point ZOMATO_SAMPLE at it to run these.
const sample = process.env.ZOMATO_SAMPLE;
const run = sample && existsSync(sample) ? describe : describe.skip;

run('Zomato sample file', () => {
  let cache: ReturnType<typeof parseZomatoWorkbook> | undefined;
  const load = () => (cache ??= parseZomatoWorkbook(readFileSync(sample!)));

  it('parses every row with no issues', () => {
    const parsed = load();
    expect(parsed.totalRows).toBe(68);
    expect(parsed.rows).toHaveLength(68);
    expect(parsed.issues).toEqual([]);
  });
  it('finds two FE IDs and 3 batched trips', () => {
    const parsed = load();
    expect(new Set(parsed.rows.map((r) => r.feId)).size).toBe(2);
    expect(parsed.rows.filter((r) => r.ordersInTrip === 2)).toHaveLength(3);
  });
  it('our extra-distance pay equals Zomato Distance Amount on every trip', () => {
    const parsed = load();
    const calc = calculateTrips(toTrips(parsed.rows), DEFAULT_RATE_CARD);
    const byId = new Map(calc.map((c) => [c.tripId, c]));
    for (const r of parsed.rows) expect(byId.get(r.tripId)!.distancePaise).toBe(r.zomatoDistancePaise);
  });
  it('operational date from delivered_at matches Zomato dt on every trip', () => {
    const parsed = load();
    for (const t of toTrips(parsed.rows)) {
      const src = parsed.rows.find((r) => r.tripId === t.tripId)!;
      expect(t.operationalDate).toBe(src.sourceDate);
    }
  });
  it('whole file falls in one Monday-Sunday cycle paid Fri 9 Oct 2026', () => {
    const parsed = load();
    const cycles = new Set(toTrips(parsed.rows).map((t) => cycleFor(t.operationalDate).start));
    expect([...cycles]).toEqual(['2026-09-28']);
    expect(cycleFor('2026-09-28').payDate).toBe('2026-10-09');
  });
});

describe('Zomato parser validation', () => {
  it('reports missing columns instead of guessing', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['dt', 'trip_id'], ['20261001', '1']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const out = parseZomatoWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    expect(out.rows).toHaveLength(0);
    expect(out.issues[0].code).toBe('MISSING_COLUMNS');
  });
});
