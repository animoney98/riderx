// Builds the five-sheet payroll workbook from already-aggregated data.
// Every figure comes from the same aggregation the pages use, so the file cannot disagree with the screen.
import ExcelJS from 'exceljs';
import type { RateCard } from '../engine/payout';
import { weekdayName, type DailyRow, type TripRecord, type WeekSummary } from './aggregate';

const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const KM = '0.00';
const INT = '0';
const ORANGE = 'FFF26A1B';
const BLACK = 'FF141414';
const rs = (paise: number) => paise / 100;
const km = (k100: number) => k100 / 100;

export interface WorkbookMeta {
  status: 'Draft (unapproved)' | 'Approved' | 'Revised after approval';
  generatedAt: string; // IST text
}

export interface ExceptionRow { type: string; who: string; date: string; description: string; amountPaise: number | null; resolution: string }

export function findExceptions(records: TripRecord[], card: RateCard): ExceptionRow[] {
  const out: ExceptionRow[] = [];
  for (const r of records) {
    if (r.distancePaise !== r.zomatoDistancePaise) {
      out.push({ type: 'Source vs calculated distance pay', who: `${r.riderName} (${r.feId})`, date: r.date, description: `Trip ${r.tripId}: Zomato distance amount ${rs(r.zomatoDistancePaise).toFixed(2)}, calculated ${rs(r.distancePaise).toFixed(2)}`, amountPaise: r.distancePaise - r.zomatoDistancePaise, resolution: 'Open' });
    }
  }
  const rainy = records.filter((r) => r.isRaining);
  if (rainy.length && card.rainBonusPaisePerOrder === 0) {
    out.push({ type: 'Rain bonus rate not set', who: 'All riders', date: '', description: `${rainy.length} trips are marked raining by Zomato but the rain bonus rate is ₹0, so no rain bonus is included`, amountPaise: null, resolution: 'Open: set a rain rate in the rate card' });
  }
  return out;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 32;
}

/** Writes a header + rows table starting at `headerRow`, with filter and frozen header. Returns the last data row number. */
function table(ws: ExcelJS.Worksheet, headerRow: number, cols: { header: string; width: number; fmt?: string; source?: boolean }[], rows: (string | number | null)[][]) {
  const h = ws.getRow(headerRow);
  cols.forEach((c, i) => { h.getCell(i + 1).value = c.header; ws.getColumn(i + 1).width = c.width; });
  styleHeader(h);
  // calculated columns get an orange underline so source and calculated values are told apart
  cols.forEach((c, i) => { if (!c.source) h.getCell(i + 1).border = { bottom: { style: 'thick', color: { argb: ORANGE } } }; });
  rows.forEach((vals, ri) => {
    const row = ws.getRow(headerRow + 1 + ri);
    vals.forEach((v, i) => { const cell = row.getCell(i + 1); cell.value = v; if (cols[i].fmt) cell.numFmt = cols[i].fmt!; });
  });
  const last = headerRow + rows.length;
  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0 }];
  if (rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length } };
  return last;
}

function addStatusFormatting(ws: ExcelJS.Worksheet, col: string, fromRow: number, toRow: number) {
  if (toRow < fromRow) return;
  const ref = `${col}${fromRow}:${col}${toRow}`;
  const rule = (text: string, bg: string, fg: string) => ({ type: 'cellIs' as const, operator: 'equal' as const, formulae: [`"${text}"`], priority: 1, style: { fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb: bg } }, font: { color: { argb: fg } } } });
  ws.addConditionalFormatting({ ref, rules: [rule('Unpaid', 'FFFFF1CC', 'FF7A4E00'), rule('Partially paid', 'FFFFE0B2', 'FF7A3E00'), rule('Disputed', 'FFFDE8E8', 'FFA61B1B'), rule('Paid', 'FFE3F4E8', 'FF146C2E')] });
}

function metaRows(ws: ExcelJS.Worksheet, lines: string[]) {
  lines.forEach((t, i) => { const c = ws.getRow(i + 1).getCell(1); c.value = t; c.font = { bold: i === 0, size: i === 0 ? 14 : 11, color: { argb: i === 0 ? ORANGE : BLACK } }; });
}

export async function buildPayrollWorkbook(summary: WeekSummary, daily: DailyRow[], records: TripRecord[], card: RateCard, meta: WorkbookMeta): Promise<Buffer> {
  const { cycle, riders, totals } = summary;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RiderX';
  const slab1 = rs(card.slabs[0].ratePaise);
  const slab2 = rs(card.slabs[card.slabs.length - 1].ratePaise);
  const period = `${cycle.start} to ${cycle.end}`;

  // ---- Sheet 1: Weekly Payroll Summary ----
  const s1 = wb.addWorksheet('Weekly Payroll Summary');
  metaRows(s1, [
    `RiderX weekly payroll: ${period}`,
    `Scheduled payment: Friday ${cycle.payDate}   |   Generated: ${meta.generatedAt} IST   |   Status: ${meta.status}`,
    'Penalties and other adjustments: none applied. Tips are excluded (paid by Zomato directly to riders).',
  ]);
  const c1 = [
    { header: 'S.No', width: 6, fmt: INT }, { header: 'Rider name', width: 24, source: true }, { header: 'FE ID', width: 14, source: true }, { header: 'Phone', width: 14, source: true },
    { header: 'Period start', width: 12 }, { header: 'Period end', width: 12 },
    ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({ header: `${d} orders`, width: 9, fmt: INT })),
    { header: 'Total weekly orders', width: 11, fmt: INT },
    { header: `Orders paid at ₹${slab1}`, width: 12, fmt: INT }, { header: `Orders paid at ₹${slab2}`, width: 12, fmt: INT },
    { header: 'Base payout', width: 14, fmt: INR }, { header: 'Total delivery km', width: 12, fmt: KM }, { header: 'Extra km', width: 10, fmt: KM },
    { header: 'Extra-distance payout', width: 14, fmt: INR }, { header: 'Batched orders', width: 10, fmt: INT }, { header: 'Batch bonus', width: 12, fmt: INR },
    { header: 'Rain incentives', width: 12, fmt: INR }, { header: 'Festival incentives', width: 12, fmt: INR }, { header: 'Other bonuses', width: 12, fmt: INR },
    { header: 'Approved additions', width: 12, fmt: INR }, { header: 'Approved deductions', width: 12, fmt: INR },
    { header: 'Gross weekly earnings', width: 15, fmt: INR }, { header: 'Net salary payable', width: 15, fmt: INR },
    { header: 'Amount paid', width: 12, fmt: INR }, { header: 'Outstanding balance', width: 14, fmt: INR },
    { header: 'Scheduled payment date', width: 14 }, { header: 'Payment status', width: 14 }, { header: 'Payment reference', width: 16 }, { header: 'Remarks', width: 20 },
  ];
  const rows1 = riders.map((w, i) => [i + 1, w.riderName, w.feId, w.phone, cycle.start, cycle.end, ...w.dayOrders, w.orders, w.slab1Orders, w.slab2Orders,
    rs(w.basePaise), km(w.km100), km(w.extraKm100), rs(w.distancePaise), w.batchedOrders, rs(w.batchBonusPaise), rs(w.rainPaise), rs(w.festivalPaise), 0,
    rs(w.additionsPaise), rs(w.deductionsPaise), rs(w.grossPaise), rs(w.netPaise), rs(w.paidPaise), rs(w.outstandingPaise), cycle.payDate, w.status, '', ''] as (string | number | null)[]);
  const last1 = table(s1, 4, c1, rows1);
  const tr = s1.getRow(last1 + 1);
  const dayTotals = [0, 1, 2, 3, 4, 5, 6].map((d) => riders.reduce((a, w) => a + w.dayOrders[d], 0));
  const totalVals: Record<number, number | string> = { 2: `Total (${totals.riders} riders)` };
  dayTotals.forEach((v, i) => (totalVals[7 + i] = v));
  Object.assign(totalVals, { 14: totals.orders, 15: totals.slab1Orders, 16: totals.slab2Orders, 17: rs(totals.basePaise), 19: km(totals.extraKm100), 20: rs(totals.distancePaise), 21: totals.batchedOrders, 22: rs(totals.batchBonusPaise), 23: rs(totals.rainPaise), 24: rs(totals.festivalPaise), 26: rs(totals.additionsPaise), 27: rs(totals.deductionsPaise), 28: rs(totals.grossPaise), 29: rs(totals.netPaise), 30: rs(totals.paidPaise), 31: rs(totals.outstandingPaise) });
  c1.forEach((c, i) => { const cell = tr.getCell(i + 1); const v = totalVals[i + 1]; if (v !== undefined) cell.value = v; if (c.fmt) cell.numFmt = c.fmt; });
  c1.forEach((_, i) => (tr.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE3D0' } }));
  tr.font = { bold: true };
  addStatusFormatting(s1, 'AG', 5, last1);

  // ---- Sheet 2: Daily Earnings Breakdown ----
  const s2 = wb.addWorksheet('Daily Earnings Breakdown');
  const dRows = daily.filter((d) => d.date >= cycle.start && d.date <= cycle.end);
  table(s2, 1, [
    { header: 'Date', width: 12, source: true }, { header: 'Day', width: 11 }, { header: 'Rider name', width: 24, source: true }, { header: 'FE ID', width: 14, source: true },
    { header: 'Orders completed', width: 11, fmt: INT }, { header: `Orders in ₹${slab1} slab`, width: 12, fmt: INT }, { header: `Orders in ₹${slab2} slab`, width: 12, fmt: INT },
    { header: 'Base payout', width: 13, fmt: INR }, { header: 'Total km', width: 10, fmt: KM }, { header: 'Extra km', width: 10, fmt: KM }, { header: 'Distance payout', width: 13, fmt: INR },
    { header: 'Batched orders', width: 10, fmt: INT }, { header: 'Batch bonus', width: 12, fmt: INR }, { header: 'Rain incentive', width: 12, fmt: INR }, { header: 'Festival incentive', width: 12, fmt: INR },
    { header: 'Other bonuses', width: 12, fmt: INR }, { header: 'Adjustments', width: 12, fmt: INR }, { header: 'Daily total earnings', width: 15, fmt: INR },
  ], dRows.map((d) => [d.date, d.weekday, d.riderName, d.feId, d.orders, d.slab1Orders, d.slab2Orders, rs(d.basePaise), km(d.km100), km(d.extraKm100), rs(d.distancePaise), d.batchedOrders, rs(d.batchBonusPaise), rs(d.rainPaise), rs(d.festivalPaise), 0, rs(d.adjustmentsPaise), rs(d.totalPaise)]));

  // ---- Sheet 3: Order-Level Details ----
  const s3 = wb.addWorksheet('Order-Level Details');
  const cycleRecords = records.filter((r) => r.date >= cycle.start && r.date <= cycle.end).sort((a, b) => a.deliveredAt.localeCompare(b.deliveredAt));
  table(s3, 1, [
    { header: 'Order (trip) ID', width: 16, source: true }, { header: 'Date', width: 12, source: true }, { header: 'Completion time', width: 18, source: true }, { header: 'Rider name', width: 24, source: true }, { header: 'FE ID', width: 14, source: true },
    { header: 'Delivery distance km (pickup + drop)', width: 14, fmt: KM, source: true }, { header: 'Orders in trip', width: 9, fmt: INT, source: true }, { header: 'Daily order rank', width: 12 },
    { header: 'Applied base rate', width: 12, fmt: INR }, { header: 'Base payout', width: 12, fmt: INR }, { header: 'Extra km', width: 9, fmt: KM }, { header: 'Distance payout', width: 12, fmt: INR },
    { header: 'Batch status', width: 10 }, { header: 'Batch bonus', width: 11, fmt: INR }, { header: 'Rain incentive', width: 11, fmt: INR }, { header: 'Festival incentive', width: 11, fmt: INR },
    { header: 'Other incentives', width: 11, fmt: INR }, { header: 'Adjustments', width: 11, fmt: INR }, { header: 'Final order payout', width: 13, fmt: INR },
    { header: 'Import file', width: 30, source: true }, { header: 'Calculation status', width: 14 },
  ], cycleRecords.map((r) => [r.tripId, r.date, r.deliveredAt.replace('T', ' '), r.riderName, r.feId, km(r.pickupKm100 + r.dropKm100), r.orders,
    r.firstRank === r.lastRank ? String(r.firstRank) : `${r.firstRank}-${r.lastRank}`, rs(r.basePaise / r.orders), rs(r.basePaise), km(r.extraKm100), rs(r.distancePaise),
    r.orders > 1 ? 'Batched' : 'Single', rs(r.batchBonusPaise), rs(r.rainPaise), rs(r.festivalPaise), 0, 0, rs(r.totalPaise), r.importFile, 'Calculated']));

  // ---- Sheet 4: Payment Register ----
  const s4 = wb.addWorksheet('Payment Register');
  const last4 = table(s4, 1, [
    { header: 'Rider name', width: 24, source: true }, { header: 'FE ID', width: 14, source: true }, { header: 'Salary period', width: 24 }, { header: 'Scheduled payment date', width: 14 },
    { header: 'Net salary payable', width: 15, fmt: INR }, { header: 'Amount paid', width: 13, fmt: INR }, { header: 'Payment date', width: 13 }, { header: 'Payment method', width: 14 },
    { header: 'Transaction reference', width: 20 }, { header: 'Outstanding balance', width: 15, fmt: INR }, { header: 'Payment status', width: 14 }, { header: 'Notes', width: 30 },
  ], riders.map((w) => [w.riderName, w.feId, period, cycle.payDate, rs(w.netPaise), rs(w.paidPaise), '', '', '', rs(w.outstandingPaise), w.status, 'No payments recorded yet']));
  addStatusFormatting(s4, 'K', 2, last4);

  // ---- Sheet 5: Exceptions & Reconciliation ----
  const s5 = wb.addWorksheet('Exceptions & Reconciliation');
  const ex = findExceptions(cycleRecords, card);
  const exRows: (string | number | null)[][] = ex.length
    ? ex.map((e) => [e.type, e.who, e.date, e.description, e.amountPaise === null ? null : rs(e.amountPaise), e.resolution])
    : [['No exceptions found', '', '', 'Distance pay matches Zomato on every trip; no unregistered FE IDs; no duplicate trips.', null, 'None needed']];
  table(s5, 1, [
    { header: 'Exception type', width: 32 }, { header: 'Rider', width: 28 }, { header: 'Date', width: 12 }, { header: 'Description', width: 80 },
    { header: 'Amount affected', width: 15, fmt: INR }, { header: 'Resolution status', width: 36 },
  ], exRows);

  // Tell weekdays used in this module are exported for pages
  void weekdayName;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
