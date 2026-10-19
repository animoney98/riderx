import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) },
    from: (t: string) => t === 'profiles'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'super_admin', active: true } }) }) }) }
      : { select: () => ({ eq: () => ({ in: async () => ({ data: [{ platform_rider_id: 'FE22345' }] }) }) }) },
  }),
}));

describe('processed workbook', () => {
  it('one sheet, FE ID = ID + 10000, rules applied, unregistered flagged', async () => {
    const { POST } = await import('../app/(app)/imports/processed/route');
    const rows = [
      { ID: 12345, trip_id: 'a', orders: 1, pickup_distance: 3, drop_distance: 5.5, isRaining: false },
      { ID: 12345, trip_id: 'b', orders: 2, pickup_distance: 2, drop_distance: 2, isRaining: true },
      { ID: 12345, trip_id: 'c', orders: 1, pickup_distance: 1, drop_distance: 1, isRaining: true },
      { ID: 99999, trip_id: 'd', orders: 1, pickup_distance: 1, drop_distance: 1, isRaining: false },
      { ID: 12345, trip_id: 'e', orders: 1, pickup_distance: '', drop_distance: 1, isRaining: '' },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'S');
    const fd = new FormData();
    fd.set('file', new File([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })], 'raw.xlsx'));
    const res = await POST(new Request('http://x/imports/processed', { method: 'POST', body: fd }));
    expect(res.status).toBe(200);
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(await res.arrayBuffer());
    expect(out.worksheets).toHaveLength(1);
    const ws = out.worksheets[0];
    const header = (ws.getRow(1).values as string[]).slice(1);
    expect(header).toEqual(['Raw ID', 'trip_id', 'orders', 'pickup_distance', 'drop_distance', 'isRaining', 'FE ID', 'Pay', 'Total Distance', 'Extra KM Charge', 'Rain Surge', 'Batched Order Fee', 'Review Flag']);
    const v = (r: number, c: string) => { const cell = ws.getRow(r).getCell(header.indexOf(c) + 1).value as { result?: unknown } | number | string; return typeof cell === 'object' && cell !== null ? (cell.result ?? 0) : cell; };
    expect(v(2, 'FE ID')).toBe(22345); expect(v(2, 'Pay')).toBe(60); expect(v(2, 'Total Distance')).toBe(8.5); expect(v(2, 'Extra KM Charge')).toBe(12.5); expect(v(2, 'Rain Surge')).toBe(0); expect(v(2, 'Batched Order Fee')).toBe(0);
    expect(v(3, 'Rain Surge')).toBe(35); expect(v(3, 'Batched Order Fee')).toBe(30); expect(v(3, 'Extra KM Charge')).toBe(0);
    expect(v(4, 'Rain Surge')).toBe(25);
    expect(String(v(5, 'Review Flag'))).toContain('not a registered rider');
    expect(String(v(6, 'Review Flag'))).toContain('distance'); expect(String(v(6, 'Review Flag'))).toContain('isRaining');
    expect(ws.rowCount).toBe(6);
  });
});
