// Generic Excel builders for the Reports & Exports page. Pure: rows in, .xlsx buffer out.
import ExcelJS from 'exceljs';

export interface RCol { header: string; key: string; width: number; fmt?: string; total?: boolean }
export interface RSheet { name: string; title: string; subtitle: string; cols: RCol[]; rows: Record<string, unknown>[] }

const ORANGE = 'FFF26A1B';
const BLACK = 'FF141414';
export const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';
export const DATE = 'dd-mmm-yyyy';
export const KM = '0.00';
const MAX_CELL = 32000; // Excel allows 32,767 characters per cell

const safeName = (n: string) => n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

function sheet(wb: ExcelJS.Workbook, s: RSheet) {
  const ws = wb.addWorksheet(safeName(s.name));
  ws.getCell('A1').value = s.title;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: ORANGE } };
  ws.getCell('A2').value = s.subtitle;
  ws.getCell('A2').font = { color: { argb: 'FF5C5852' } };
  const h = 4;
  s.cols.forEach((c, i) => {
    const cell = ws.getCell(h, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width;
  });
  ws.getRow(h).height = 30;
  s.rows.forEach((r, ri) => s.cols.forEach((c, ci) => {
    const cell = ws.getCell(h + 1 + ri, ci + 1);
    const v = r[c.key];
    cell.value = (v === undefined ? null : v) as ExcelJS.CellValue;
    if (c.fmt) cell.numFmt = c.fmt;
  }));
  const last = h + s.rows.length;
  if (s.rows.length) ws.autoFilter = { from: { row: h, column: 1 }, to: { row: last, column: s.cols.length } };
  ws.views = [{ state: 'frozen', ySplit: h, xSplit: 0 }];
  if (s.rows.length && s.cols.some((c) => c.total)) {
    const t = last + 1;
    ws.getCell(t, 1).value = 'TOTAL';
    ws.getCell(t, 1).font = { bold: true };
    s.cols.forEach((c, ci) => {
      if (!c.total) return;
      const col = ws.getColumn(ci + 1).letter;
      const cell = ws.getCell(t, ci + 1);
      cell.value = { formula: `SUBTOTAL(109,${col}${h + 1}:${col}${last})` };
      cell.font = { bold: true };
      if (c.fmt) cell.numFmt = c.fmt;
    });
  }
}

/** A readable report: one or more formatted sheets. */
export async function buildReportWorkbook(sheets: RSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RiderX';
  sheets.forEach((s) => sheet(wb, s));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface BackupTable { name: string; rows: Record<string, unknown>[] }

/** Raw copy of every table, exactly as stored (money in paise, distances in hundredths of a km). */
export async function buildBackupWorkbook(tables: BackupTable[], generatedAt: Date, note: string): Promise<{ buffer: Buffer; counts: Record<string, number> }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RiderX';
  const counts: Record<string, number> = {};
  const readme = wb.addWorksheet('README');
  readme.getColumn(1).width = 34;
  readme.getColumn(2).width = 90;
  readme.getCell('A1').value = 'RiderX full backup';
  readme.getCell('A1').font = { bold: true, size: 16, color: { argb: ORANGE } };
  readme.getCell('A2').value = `Created ${generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC. ${note}`;
  readme.getCell('A3').value = 'Values are exactly as stored: money columns ending _paise are in paise (100 paise = ₹1), distances ending _km100 are in hundredths of a km, times are IST unless the column says otherwise.';
  readme.getCell('A5').value = 'Sheet';
  readme.getCell('B5').value = 'Rows';
  readme.getRow(5).font = { bold: true };
  tables.forEach((t, i) => {
    counts[t.name] = t.rows.length;
    readme.getCell(6 + i, 1).value = t.name;
    readme.getCell(6 + i, 2).value = t.rows.length;
    readme.getCell(6 + i, 2).alignment = { horizontal: 'left' };
    const keys = [...new Set(t.rows.flatMap((r) => Object.keys(r)))];
    const ws = wb.addWorksheet(safeName(t.name));
    keys.forEach((k, ci) => {
      const c = ws.getCell(1, ci + 1);
      c.value = k;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
      ws.getColumn(ci + 1).width = Math.min(40, Math.max(12, k.length + 2));
    });
    t.rows.forEach((r, ri) => keys.forEach((k, ci) => {
      let v = r[k];
      if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'string' && v.length > MAX_CELL) v = v.slice(0, MAX_CELL) + ' …[cut: too long for one Excel cell]';
      ws.getCell(ri + 2, ci + 1).value = (v === undefined ? null : v) as ExcelJS.CellValue;
    }));
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
  });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  // Read it back: every sheet must hold exactly the rows we fetched, or the backup is refused.
  const check = new ExcelJS.Workbook();
  await check.xlsx.load(buffer as unknown as ArrayBuffer);
  for (const t of tables) {
    const ws = check.getWorksheet(safeName(t.name));
    const got = ws ? Math.max(0, ws.rowCount - 1) : -1;
    if (got !== t.rows.length) throw new Error(`Backup check failed for ${t.name}: expected ${t.rows.length} rows, file has ${got}`);
  }
  return { buffer, counts };
}
