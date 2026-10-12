import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildBackupWorkbook, buildReportWorkbook } from './reportsWorkbook';

describe('backup workbook', () => {
  it('keeps every row and stringifies json', async () => {
    const { buffer, counts } = await buildBackupWorkbook([
      { name: 'riders', rows: [{ id: 'a', name: 'X' }, { id: 'b', name: 'Y', extra: { k: 1 } }] },
      { name: 'empty', rows: [] },
    ], new Date('2026-10-13T00:00:00Z'), 'test');
    expect(counts).toEqual({ riders: 2, empty: 0 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.getWorksheet('riders')!.getCell('C3').value).toBe('{"k":1}');
    expect(wb.getWorksheet('README')!.getCell('B6').value).toBe(2);
  });
  it('cuts oversize text visibly, never silently', async () => {
    const { buffer } = await buildBackupWorkbook([{ name: 't', rows: [{ v: 'x'.repeat(40000) }] }], new Date(), '');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(String(wb.getWorksheet('t')!.getCell('A2').value)).toContain('[cut');
  });
});

describe('report workbook', () => {
  it('adds a SUBTOTAL row for total columns', async () => {
    const buf = await buildReportWorkbook([{ name: 'S', title: 'T', subtitle: 's', cols: [{ header: 'A', key: 'a', width: 10 }, { header: 'N', key: 'n', width: 10, total: true }], rows: [{ a: 'x', n: 2 }, { a: 'y', n: 3 }] }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const f = wb.getWorksheet('S')!.getCell('B7').value as { formula: string };
    expect(f.formula).toBe('SUBTOTAL(109,B5:B6)');
  });
});
