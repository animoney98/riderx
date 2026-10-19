import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { normalizeFeId, parseZomatoWorkbook } from '../src/import/zomatoParser';

describe('FE ID normalising', () => {
  it('adds FE to a bare number', () => {
    expect(normalizeFeId(11568286)).toBe('FE11568286');
    expect(normalizeFeId('11568286')).toBe('FE11568286');
    expect(normalizeFeId(' 11568286 ')).toBe('FE11568286');
    expect(normalizeFeId('11568286.0')).toBe('FE11568286');
  });
  it('keeps IDs that already have FE, any case or spacing', () => {
    expect(normalizeFeId('FE11568286')).toBe('FE11568286');
    expect(normalizeFeId('fe11568286')).toBe('FE11568286');
    expect(normalizeFeId('FE 11568286')).toBe('FE11568286');
    expect(normalizeFeId('FE-11568286')).toBe('FE11568286');
  });
  it('leaves junk alone so it is still rejected', () => {
    expect(normalizeFeId('')).toBe('');
    expect(normalizeFeId('abc')).toBe('abc');
    expect(normalizeFeId('12a')).toBe('12a');
  });
});

describe('parser with bare-number FE IDs', () => {
  it('adds 10,000 to a bare number and leaves FE-prefixed IDs alone', () => {
    const rows = [
      { dt: '20261012', trip_id: 'T1', orders: 1, pay: 50, delivered_at: 46307.5, pickup_distance: 2, drop_distance: 3, 'FE ID': 11568286 },
      { dt: '20261012', trip_id: 'T2', orders: 1, pay: 50, delivered_at: 46307.6, pickup_distance: 2, drop_distance: 3, 'FE ID': 'FE22222' },
      { dt: '20261012', trip_id: 'T3', orders: 1, pay: 50, delivered_at: 46307.7, pickup_distance: 2, drop_distance: 3, 'FE ID': 'oops' },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'S');
    const res = parseZomatoWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    expect(res.rows.map((r) => r.feId)).toEqual(['FE11578286', 'FE22222']);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].code).toBe('BAD_FE_ID');
  });
});
