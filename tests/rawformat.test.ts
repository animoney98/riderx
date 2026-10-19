import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseZomatoWorkbook, companyPayKm100, parseRain } from '../src/import/zomatoParser';
import { calculateTrips, DEFAULT_RATE_CARD } from '../src/engine/payout';
import { toTrips } from '../src/import/zomatoParser';

const book = (rows: Record<string, unknown>[]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const base = { dt: '20261012', orders: 1, delivered_at: 46307.5, pickup_distance: 2, drop_distance: 3, isRaining: false };

describe('raw delivery file (ID column)', () => {
  it('adds 10,000 to ID to make the FE ID', () => {
    const r = parseZomatoWorkbook(book([{ ...base, trip_id: 'A', ID: 11558286 }, { ...base, trip_id: 'B', ID: ' 12345 ' }]));
    expect(r.format).toBe('raw_id');
    expect(r.rows.map((x) => x.feId)).toEqual(['FE11568286', 'FE22345']);
    expect(r.rows.map((x) => x.rawId)).toEqual(['11558286', '12345']);
  });
  it('matches the column name ignoring case and spaces', () => {
    const r = parseZomatoWorkbook(book([{ ...base, trip_id: 'A', ' id ': 100 }]));
    expect(r.rows[0].feId).toBe('FE10100');
  });
  it('never adds 10,000 when FE ID is present, even with an ID column too', () => {
    const r = parseZomatoWorkbook(book([{ ...base, trip_id: 'A', pay: 60, ID: 100, 'FE ID': 11568286 }]));
    expect(r.format).toBe('fe_id');
    expect(r.rows[0].feId).toBe('FE11568286');
  });
  it('flags a non-numeric ID and keeps going', () => {
    const r = parseZomatoWorkbook(book([{ ...base, trip_id: 'A', ID: 'abc' }, { ...base, trip_id: 'B', ID: 5 }]));
    expect(r.rows).toHaveLength(1);
    expect(r.issues[0].code).toBe('BAD_FE_ID');
  });
  it('flags missing or invalid rain status instead of assuming false', () => {
    const r = parseZomatoWorkbook(book([{ ...base, trip_id: 'A', ID: 1, isRaining: '' }, { ...base, trip_id: 'B', ID: 2, isRaining: 'maybe' }, { ...base, trip_id: 'C', ID: 3, isRaining: 'TRUE' }]));
    expect(r.issues.map((i) => i.code)).toEqual(['BAD_RAIN', 'BAD_RAIN']);
    expect(r.rows[0].isRaining).toBe(true);
  });
});

describe('company pay for raw files', () => {
  it('₹60 base, nothing extra within 6 km', () => expect(companyPayKm100(600, 1, false)).toBe(6000));
  it('₹5 per km over 6, fractions proportional', () => {
    expect(companyPayKm100(650, 1, false)).toBe(6250);
    expect(companyPayKm100(800, 1, false)).toBe(6000 + 1000);
    expect(companyPayKm100(1000, 1, false)).toBe(6000 + 2000);
  });
  it('rain 25 normal, 35 batched in total, batch fee 30 only for 2 orders', () => {
    expect(companyPayKm100(500, 1, true)).toBe(6000 + 2500);
    expect(companyPayKm100(500, 2, true)).toBe(6000 + 3500 + 3000);
    expect(companyPayKm100(500, 2, false)).toBe(6000 + 3000);
  });
  it('parseRain', () => {
    expect([true, 'TRUE', 1, 'yes'].map(parseRain)).toEqual([true, true, true, true]);
    expect([false, 'FALSE', 0].map(parseRain)).toEqual([false, false, false]);
    expect([null, '', 'x', 2].map(parseRain)).toEqual([null, null, null, null]);
  });
});

describe('rider rain pay with a batched-trip rate', () => {
  const card = { ...DEFAULT_RATE_CARD, rainBonusPaisePerOrder: 2500, rainBonusBatchedTripPaise: 3500 };
  const t = (id: string, orders: number, rain: boolean) => ({ tripId: id, riderKey: 'z:FE1', operationalDate: '2026-10-12', completedAt: `2026-10-12T1${id}:00:00`, pickupKm100: 100, dropKm100: 100, ordersInTrip: orders, isRaining: rain });
  it('25 for a rainy trip, 35 for a rainy batched trip, 0 when dry', () => {
    const out = calculateTrips([t('1', 1, true), t('2', 2, true), t('3', 1, false)], card);
    expect(out.map((e) => e.rainPaise)).toEqual([2500, 3500, 0]);
  });
  it('without a batched rate it stays per order', () => {
    const out = calculateTrips([t('2', 2, true)], { ...DEFAULT_RATE_CARD, rainBonusPaisePerOrder: 2500 });
    expect(out[0].rainPaise).toBe(5000);
  });
  it('rider base stays 50 then 60 with batch +30', () => {
    const out = calculateTrips([t('1', 2, false)], card);
    expect(out[0].totalPaise).toBe(5000 + 3000);
  });
});
