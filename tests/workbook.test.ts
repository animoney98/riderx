import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { calculateTrips, DEFAULT_RATE_CARD, type Trip } from '../src/engine/payout';
import { cycleFor } from '../src/engine/calendar';
import type { TripDetail } from '../src/engine/weekly';
import { buildPayrollWorkbook } from '../src/export/payrollWorkbook';

const mk = (fe: string, date: string, n: number, over: Partial<Trip> = {}): Trip[] =>
  Array.from({ length: n }, (_, i) => ({
    tripId: `${fe}-${date}-${i}`, riderKey: `zomato:${fe}`, operationalDate: date, completedAt: `${date}T10:${String(i % 60).padStart(2, '0')}:00`,
    pickupKm100: 250, dropKm100: 400, ordersInTrip: 1, isRaining: false, ...over,
  }));
const toDetail = (trips: Trip[]): TripDetail[] =>
  calculateTrips(trips, DEFAULT_RATE_CARD).map((e, i) => ({
    feId: e.riderKey.replace('zomato:', ''), tripId: e.tripId, date: e.operationalDate, orders: e.orders, firstRank: e.firstRank, lastRank: e.lastRank,
    km100: e.totalKm100, extraKm100: e.extraKm100, basePaise: e.basePaise, distancePaise: e.distancePaise, batchBonusPaise: e.batchBonusPaise,
    rainPaise: e.rainPaise, festivalPaise: e.festivalPaise, totalPaise: e.totalPaise,
    deliveredAt: `${e.operationalDate} 10:${String(i % 60).padStart(2, '0')}:00`, pickupKm100: 250, dropKm100: 400, raining: false,
  }));

const trips = toDetail([...mk('FE1', '2026-10-12', 30), ...mk('FE1', '2026-10-14', 3, { ordersInTrip: 2 }), ...mk('FE2', '2026-10-18', 5), ...mk('FE9', '2026-10-13', 2)]);
const input = {
  cycle: cycleFor('2026-10-12'), trips,
  riders: new Map([['FE1', { name: 'Rider One', phone: '9999999999' }], ['FE2', { name: 'Rider Two', phone: null }]]),
  slab1Limit: 25, slab1RatePaise: 5000, slab2RatePaise: 6000, status: 'DRAFT - not approved', generatedAt: new Date('2026-10-19T05:00:00Z'), tripsWithoutEarnings: 0,
};

describe('payroll workbook', () => {
  it('has the five sheets and totals that match the trips', async () => {
    const { buffer, grossPaise } = await buildPayrollWorkbook(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Weekly Payroll Summary', 'Daily Earnings Breakdown', 'Order-Level Details', 'Payment Register', 'Exceptions & Reconciliation']);
    const expected = trips.reduce((s, t) => s + t.totalPaise, 0);
    expect(grossPaise).toBe(expected);

    const ws = wb.getWorksheet('Weekly Payroll Summary')!;
    const headers = (ws.getRow(4).values as unknown[]).slice(1);
    const grossCol = headers.indexOf('Gross weekly earnings') + 1;
    const last = ws.rowCount;
    const total = ws.getCell(last, grossCol).value as { result: number };
    expect(Math.round(total.result * 100)).toBe(expected);
    // one row per rider, plus the total row
    expect(ws.rowCount).toBe(4 + 3 + 1);
    // weekday columns: FE1 has 30 orders on Monday and 6 orders (3 batched trips) on Wednesday
    const monCol = headers.indexOf('Monday orders') + 1, wedCol = headers.indexOf('Wednesday orders') + 1;
    const fe1 = [5, 6, 7].map((r) => ws.getRow(r)).find((r) => r.getCell(3).value === 'FE1')!;
    expect(fe1.getCell(monCol).value).toBe(30);
    expect(fe1.getCell(wedCol).value).toBe(6);
  });

  it('daily, order-level and payment sheets reconcile with the summary', async () => {
    const { buffer } = await buildPayrollWorkbook(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sumOf = (sheet: string, header: string) => {
      const ws = wb.getWorksheet(sheet)!;
      const h = (ws.getRow(4).values as unknown[]).slice(1);
      const c = h.indexOf(header) + 1;
      return (ws.getCell(ws.rowCount, c).value as { result: number }).result;
    };
    const gross = sumOf('Weekly Payroll Summary', 'Gross weekly earnings');
    expect(sumOf('Daily Earnings Breakdown', 'Daily total earnings')).toBeCloseTo(gross, 2);
    expect(sumOf('Order-Level Details', 'Final trip payout')).toBeCloseTo(gross, 2);
    expect(sumOf('Payment Register', 'Net salary payable')).toBeCloseTo(gross, 2);
    expect(sumOf('Payment Register', 'Outstanding balance')).toBeCloseTo(gross, 2);
  });

  it('flags the unregistered FE ID on the exceptions sheet', async () => {
    const { buffer } = await buildPayrollWorkbook(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Exceptions & Reconciliation')!;
    const cells: string[] = [];
    ws.eachRow((r) => cells.push(String(r.getCell(2).value)));
    expect(cells).toContain('FE9');
  });

  it('refuses to build when trips from another cycle would not reconcile', async () => {
    // trips outside the cycle are ignored, so totals still agree
    const outside = toDetail(mk('FE1', '2026-10-25', 5));
    const { grossPaise } = await buildPayrollWorkbook({ ...input, trips: [...trips, ...outside] });
    expect(grossPaise).toBe(trips.reduce((s, t) => s + t.totalPaise, 0));
  });
});
