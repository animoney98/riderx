// Builds the five-sheet payroll workbook. Pure: takes data in, returns an .xlsx buffer.
// All sheets are built from the same trip rows, and the totals are cross-checked before the file is returned.
import ExcelJS from 'exceljs';
import { addDays, type PayrollCycle } from '../engine/calendar';
import { buildDaily, buildWeekly, type TripDetail } from '../engine/weekly';

export interface PayrollWorkbookInput {
  cycle: PayrollCycle;
  trips: TripDetail[];
  riders: Map<string, { name: string; phone: string | null }>;
  slab1Limit: number;
  slab1RatePaise: number;
  slab2RatePaise: number;
  status: string; // e.g. "DRAFT - not approved"
  generatedAt: Date;
  tripsWithoutEarnings: number;
}

const ORANGE = 'FFF26A1B';
const BLACK = 'FF141414';
// Indian digit grouping for rupee amounts.
const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';
const KM = '0.00';
const DATE = 'dd-mmm-yyyy';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const rs = (paise: number) => paise / 100;
const km = (km100: number) => km100 / 100;
const toDate = (iso: string) => new Date(iso + 'T00:00:00Z');
const rupeeLabel = (p: number) => `₹${p / 100}`;

interface Col { header: string; key: string; width: number; fmt?: string; total?: boolean }

function addTable(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, cols: Col[], rows: Record<string, unknown>[], withTotals: boolean) {
  const ws = wb.addWorksheet(name);
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: ORANGE } };
  ws.getCell('A2').value = subtitle;
  ws.getCell('A2').font = { color: { argb: 'FF5C5852' } };
  const headerRow = 4;
  cols.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width;
  });
  ws.getRow(headerRow).height = 32;
  rows.forEach((r, ri) => {
    cols.forEach((c, ci) => {
      const cell = ws.getCell(headerRow + 1 + ri, ci + 1);
      const v = r[c.key];
      cell.value = (v === undefined ? null : v) as ExcelJS.CellValue;
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });
  const last = headerRow + rows.length;
  if (rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: cols.length } };
  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0 }];
  if (withTotals && rows.length) {
    const tr = last + 1;
    ws.getCell(tr, 1).value = `Total (${rows.length} rows)`;
    cols.forEach((c, ci) => {
      if (!c.total) return;
      const colLetter = ws.getColumn(ci + 1).letter;
      const result = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      const cell = ws.getCell(tr, ci + 1);
      cell.value = { formula: `SUM(${colLetter}${headerRow + 1}:${colLetter}${last})`, result };
      if (c.fmt) cell.numFmt = c.fmt;
    });
    ws.getRow(tr).font = { bold: true };
    ws.getRow(tr).eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F5F3' } }; });
  }
  return { ws, headerRow, last };
}

function statusFormatting(ws: ExcelJS.Worksheet, colIndex: number, firstRow: number, lastRow: number) {
  if (lastRow < firstRow) return;
  const letter = ws.getColumn(colIndex).letter;
  const ref = `${letter}${firstRow}:${letter}${lastRow}`;
  const fill = (argb: string) => ({ fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb } } });
  ws.addConditionalFormatting({
    ref,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'Partially', style: fill('FFFFE0A3'), priority: 1 },
      { type: 'containsText', operator: 'containsText', text: 'Unpaid', style: fill('FFFFF1CC'), priority: 2 },
      { type: 'containsText', operator: 'containsText', text: 'Disputed', style: fill('FFFDE8E8'), priority: 3 },
      { type: 'containsText', operator: 'containsText', text: 'Paid', style: fill('FFE3F4E8'), priority: 4 },
    ],
  });
}

export async function buildPayrollWorkbook(input: PayrollWorkbookInput): Promise<{ buffer: Buffer; grossPaise: number; riders: number }> {
  const { cycle, trips, riders, slab1Limit } = input;
  const inCycle = trips.filter((t) => t.date >= cycle.start && t.date <= cycle.end);
  const weekly = buildWeekly(inCycle, cycle, slab1Limit);
  const daily = buildDaily(inCycle, slab1Limit);

  // Cross-check: every view of the numbers must agree before a file is offered.
  const grossWeekly = weekly.reduce((s, w) => s + w.grossPaise, 0);
  const grossDaily = daily.reduce((s, d) => s + d.totalPaise, 0);
  const grossTrips = inCycle.reduce((s, t) => s + t.totalPaise, 0);
  const ordersWeekly = weekly.reduce((s, w) => s + w.orders, 0);
  const ordersTrips = inCycle.reduce((s, t) => s + t.orders, 0);
  if (grossWeekly !== grossDaily || grossDaily !== grossTrips || ordersWeekly !== ordersTrips) {
    throw new Error(`Export validation failed: weekly ${grossWeekly}, daily ${grossDaily}, trips ${grossTrips} (orders ${ordersWeekly}/${ordersTrips})`);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'RiderX';
  wb.created = input.generatedAt;
  wb.title = `RiderX payroll ${cycle.start} to ${cycle.end} (${input.status})`;
  const stamp = input.generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const sub = `Salary period ${cycle.start} to ${cycle.end} | Scheduled payment ${cycle.payDate} | Generated ${stamp} IST | Status: ${input.status}`;
  const r1 = rupeeLabel(input.slab1RatePaise);
  const r2 = rupeeLabel(input.slab2RatePaise);

  // ---- Sheet 1: Weekly Payroll Summary
  const summaryRows = weekly.map((w, i) => {
    const info = riders.get(w.feId);
    const row: Record<string, unknown> = {
      sn: i + 1, name: info?.name || 'NOT REGISTERED', fe: w.feId, phone: info?.phone ?? '',
      start: toDate(cycle.start), end: toDate(cycle.end),
      orders: w.orders, s1: w.slab1Orders, s2: w.slab2Orders, base: rs(w.basePaise),
      km: km(w.km100), xkm: km(w.extraKm100), dist: rs(w.distancePaise), batched: w.batchedTrips, batch: rs(w.batchBonusPaise),
      rain: rs(w.rainPaise), fest: rs(w.festivalPaise), other: 0, add: 0, ded: 0,
      gross: rs(w.grossPaise), net: rs(w.grossPaise), paid: 0, out: rs(w.grossPaise),
      pay: toDate(cycle.payDate), status: 'Unpaid', ref: '', remarks: info ? '' : 'FE ID not registered as a rider',
    };
    DAYS.forEach((_, d) => { row[`d${d}`] = w.ordersByDay[d]; });
    return row;
  });
  const sumCols: Col[] = [
    { header: 'S.No', key: 'sn', width: 6 }, { header: 'Rider name', key: 'name', width: 24 }, { header: 'FE ID', key: 'fe', width: 14 }, { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Period start', key: 'start', width: 13, fmt: DATE }, { header: 'Period end', key: 'end', width: 13, fmt: DATE },
    ...DAYS.map((d, i) => ({ header: `${d} orders`, key: `d${i}`, width: 11, total: true })),
    { header: 'Total orders', key: 'orders', width: 11, total: true },
    { header: `Orders paid at ${r1}`, key: 's1', width: 13, total: true }, { header: `Orders paid at ${r2}`, key: 's2', width: 13, total: true },
    { header: 'Base payout', key: 'base', width: 14, fmt: INR, total: true },
    { header: 'Delivery km', key: 'km', width: 11, fmt: KM, total: true }, { header: 'Extra km', key: 'xkm', width: 10, fmt: KM, total: true },
    { header: 'Extra-distance payout', key: 'dist', width: 14, fmt: INR, total: true },
    { header: 'Batched trips', key: 'batched', width: 10, total: true }, { header: 'Batch bonus', key: 'batch', width: 12, fmt: INR, total: true },
    { header: 'Rain incentive', key: 'rain', width: 12, fmt: INR, total: true }, { header: 'Festival incentive', key: 'fest', width: 12, fmt: INR, total: true },
    { header: 'Other bonuses', key: 'other', width: 12, fmt: INR, total: true },
    { header: 'Approved additions', key: 'add', width: 12, fmt: INR, total: true }, { header: 'Approved deductions', key: 'ded', width: 12, fmt: INR, total: true },
    { header: 'Gross weekly earnings', key: 'gross', width: 15, fmt: INR, total: true }, { header: 'Net salary payable', key: 'net', width: 15, fmt: INR, total: true },
    { header: 'Amount paid', key: 'paid', width: 13, fmt: INR, total: true }, { header: 'Outstanding balance', key: 'out', width: 15, fmt: INR, total: true },
    { header: 'Scheduled payment date', key: 'pay', width: 14, fmt: DATE }, { header: 'Payment status', key: 'status', width: 14 },
    { header: 'Payment reference', key: 'ref', width: 18 }, { header: 'Remarks / dispute', key: 'remarks', width: 28 },
  ];
  const s1 = addTable(wb, 'Weekly Payroll Summary', 'RiderX Weekly Payroll Summary', sub, sumCols, summaryRows, true);
  statusFormatting(s1.ws, sumCols.findIndex((c) => c.key === 'status') + 1, s1.headerRow + 1, s1.last);
  s1.ws.views = [{ state: 'frozen', ySplit: s1.headerRow, xSplit: 3 }];

  // ---- Sheet 2: Daily Earnings Breakdown
  const dayName = (d: string) => DAYS[(new Date(toDate(d)).getUTCDay() + 6) % 7];
  const dailyRows = daily.map((d) => ({
    date: toDate(d.date), dow: dayName(d.date), name: riders.get(d.feId)?.name || 'NOT REGISTERED', fe: d.feId, orders: d.orders, s1: d.slab1Orders, s2: d.slab2Orders,
    base: rs(d.basePaise), km: km(d.km100), xkm: km(d.extraKm100), dist: rs(d.distancePaise), batched: d.batchedTrips, batch: rs(d.batchBonusPaise),
    rain: rs(d.rainPaise), fest: rs(d.festivalPaise), other: 0, adj: 0, total: rs(d.totalPaise),
  }));
  const dailyCols: Col[] = [
    { header: 'Date', key: 'date', width: 13, fmt: DATE }, { header: 'Day', key: 'dow', width: 11 }, { header: 'Rider name', key: 'name', width: 24 }, { header: 'FE ID', key: 'fe', width: 14 },
    { header: 'Orders completed', key: 'orders', width: 11, total: true }, { header: `Orders in ${r1} slab`, key: 's1', width: 12, total: true }, { header: `Orders in ${r2} slab`, key: 's2', width: 12, total: true },
    { header: 'Base payout', key: 'base', width: 13, fmt: INR, total: true }, { header: 'Delivery km', key: 'km', width: 11, fmt: KM, total: true }, { header: 'Extra km', key: 'xkm', width: 10, fmt: KM, total: true },
    { header: 'Distance payout', key: 'dist', width: 13, fmt: INR, total: true }, { header: 'Batched trips', key: 'batched', width: 10, total: true }, { header: 'Batch bonus', key: 'batch', width: 12, fmt: INR, total: true },
    { header: 'Rain incentive', key: 'rain', width: 12, fmt: INR, total: true }, { header: 'Festival incentive', key: 'fest', width: 12, fmt: INR, total: true },
    { header: 'Other bonuses', key: 'other', width: 12, fmt: INR, total: true }, { header: 'Adjustments', key: 'adj', width: 12, fmt: INR, total: true }, { header: 'Daily total earnings', key: 'total', width: 15, fmt: INR, total: true },
  ];
  addTable(wb, 'Daily Earnings Breakdown', 'RiderX Daily Earnings Breakdown', sub, dailyCols, dailyRows, true);

  // ---- Sheet 3: Order-Level Details (one row per Zomato trip; a batched trip carries 2 orders)
  const tripRows = [...inCycle].sort((a, b) => a.date.localeCompare(b.date) || a.deliveredAt.localeCompare(b.deliveredAt)).map((t) => ({
    id: t.tripId, date: toDate(t.date), time: t.deliveredAt.slice(11, 19), name: riders.get(t.feId)?.name || 'NOT REGISTERED', fe: t.feId,
    pk: km(t.pickupKm100), dk: km(t.dropKm100), tk: km(t.km100), orders: t.orders, rank: t.firstRank === t.lastRank ? String(t.firstRank) : `${t.firstRank}-${t.lastRank}`,
    base: rs(t.basePaise), xkm: km(t.extraKm100), dist: rs(t.distancePaise), batch: t.orders > 1 ? 'Batched' : 'Single', bonus: rs(t.batchBonusPaise),
    rain: rs(t.rainPaise), fest: rs(t.festivalPaise), other: 0, adj: 0, total: rs(t.totalPaise), calc: 'Calculated',
  }));
  const tripCols: Col[] = [
    { header: 'Trip ID', key: 'id', width: 16 }, { header: 'Date', key: 'date', width: 13, fmt: DATE }, { header: 'Delivered at (IST)', key: 'time', width: 12 },
    { header: 'Rider name', key: 'name', width: 24 }, { header: 'FE ID', key: 'fe', width: 14 },
    { header: 'Pickup km', key: 'pk', width: 10, fmt: KM }, { header: 'Drop km', key: 'dk', width: 10, fmt: KM }, { header: 'Total km', key: 'tk', width: 10, fmt: KM },
    { header: 'Orders in trip', key: 'orders', width: 9, total: true }, { header: 'Daily order rank', key: 'rank', width: 10 },
    { header: 'Base payout', key: 'base', width: 12, fmt: INR, total: true }, { header: 'Extra km', key: 'xkm', width: 9, fmt: KM, total: true },
    { header: 'Distance payout', key: 'dist', width: 12, fmt: INR, total: true }, { header: 'Batch status', key: 'batch', width: 10 }, { header: 'Batch bonus', key: 'bonus', width: 11, fmt: INR, total: true },
    { header: 'Rain incentive', key: 'rain', width: 11, fmt: INR, total: true }, { header: 'Festival incentive', key: 'fest', width: 11, fmt: INR, total: true },
    { header: 'Other incentives', key: 'other', width: 11, fmt: INR, total: true }, { header: 'Adjustments', key: 'adj', width: 11, fmt: INR, total: true },
    { header: 'Final trip payout', key: 'total', width: 13, fmt: INR, total: true }, { header: 'Calculation status', key: 'calc', width: 13 },
  ];
  addTable(wb, 'Order-Level Details', 'RiderX Order-Level Details', sub, tripCols, tripRows, true);

  // ---- Sheet 4: Payment Register
  const payRows = weekly.map((w) => ({
    name: riders.get(w.feId)?.name || 'NOT REGISTERED', fe: w.feId, period: `${cycle.start} to ${cycle.end}`, due: toDate(cycle.payDate),
    net: rs(w.grossPaise), paid: 0, pdate: null, method: '', ref: '', out: rs(w.grossPaise), status: 'Unpaid', notes: 'No payment recorded yet',
  }));
  const payCols: Col[] = [
    { header: 'Rider name', key: 'name', width: 24 }, { header: 'FE ID', key: 'fe', width: 14 }, { header: 'Salary period', key: 'period', width: 24 },
    { header: 'Scheduled payment date', key: 'due', width: 14, fmt: DATE }, { header: 'Net salary payable', key: 'net', width: 15, fmt: INR, total: true },
    { header: 'Amount paid', key: 'paid', width: 13, fmt: INR, total: true }, { header: 'Payment date', key: 'pdate', width: 13, fmt: DATE },
    { header: 'Payment method', key: 'method', width: 14 }, { header: 'Transaction reference', key: 'ref', width: 20 },
    { header: 'Outstanding balance', key: 'out', width: 15, fmt: INR, total: true }, { header: 'Payment status', key: 'status', width: 14 }, { header: 'Notes', key: 'notes', width: 26 },
  ];
  const s4 = addTable(wb, 'Payment Register', 'RiderX Payment Register', sub, payCols, payRows, true);
  statusFormatting(s4.ws, payCols.findIndex((c) => c.key === 'status') + 1, s4.headerRow + 1, s4.last);

  // ---- Sheet 5: Exceptions & Reconciliation
  const exc: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const t of inCycle) {
    if (!riders.has(t.feId) && !seen.has(t.feId)) {
      seen.add(t.feId);
      const w = weekly.find((x) => x.feId === t.feId);
      exc.push({ type: 'Unregistered FE ID', who: t.feId, date: null, desc: 'FE ID in the Zomato file is not registered as a rider', amt: w ? rs(w.grossPaise) : null, status: 'Open' });
    }
  }
  if (input.tripsWithoutEarnings > 0) exc.push({ type: 'Incomplete earnings', who: 'Several riders', date: null, desc: `${input.tripsWithoutEarnings} trips this week have no calculated earnings and are not in these totals`, amt: null, status: 'Open' });
  exc.push({ type: 'Penalties', who: 'All riders', date: null, desc: 'Penalty data not supplied yet; no deductions applied', amt: null, status: 'Pending data' });
  exc.push({ type: 'Reconciliation', who: 'All riders', date: null, desc: `Summary, daily and trip-level gross all equal ₹${(grossWeekly / 100).toFixed(2)}`, amt: rs(grossWeekly), status: 'Reconciled' });
  const excCols: Col[] = [
    { header: 'Exception type', key: 'type', width: 22 }, { header: 'Rider / FE ID', key: 'who', width: 18 }, { header: 'Date', key: 'date', width: 13, fmt: DATE },
    { header: 'Description', key: 'desc', width: 70 }, { header: 'Amount affected', key: 'amt', width: 15, fmt: INR }, { header: 'Resolution status', key: 'status', width: 16 },
  ];
  addTable(wb, 'Exceptions & Reconciliation', 'RiderX Exceptions & Reconciliation', sub, excCols, exc, false);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, grossPaise: grossWeekly, riders: weekly.length };
}
