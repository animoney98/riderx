import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildBankFile, transactionType, ddmmyyyy } from '../src/export/bankFile';

const pay = (o = {}) => ({ feId: 'FE1', name: 'Rider One', accountNumber: '123456789012', ifsc: 'HDFC0001234', amountPaise: 79350, remarks: 'RiderX payout', ...o });

describe('bank file', () => {
  it('fills the template from row 3 and keeps the headers', async () => {
    const { buffer, totalPaise, count } = await buildBankFile({ payments: [pay(), pay({ feId: 'FE2', name: 'Two', ifsc: 'IDFB0080123', amountPaise: 286000 })], debitAccount: '10012345678', valueDate: '2026-10-16' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Beneficiary Name');
    expect(ws.getCell('A3').value).toBe('Rider One');
    expect(ws.getCell('B3').value).toBe('123456789012');
    expect(ws.getCell('D3').value).toBe('NEFT');
    expect(ws.getCell('D4').value).toBe('IFT');
    expect(ws.getCell('E3').value).toBe('10012345678');
    expect(ws.getCell('F3').value).toBe('16/10/2026');
    expect(ws.getCell('G3').value).toBe(793.5);
    expect(ws.getCell('H3').value).toBe('INR');
    expect(ws.getCell('A5').value).toBeNull();
    expect(totalPaise).toBe(79350 + 286000);
    expect(count).toBe(2);
  });
  it('rejects bad data instead of producing a file', async () => {
    const base = { debitAccount: '10012345678', valueDate: '2026-10-16' };
    await expect(buildBankFile({ ...base, payments: [pay({ ifsc: 'BAD' })] })).rejects.toThrow(/IFSC/);
    await expect(buildBankFile({ ...base, payments: [pay({ accountNumber: '12ab' })] })).rejects.toThrow(/account/);
    await expect(buildBankFile({ ...base, payments: [pay({ amountPaise: 0 })] })).rejects.toThrow(/amount/);
    await expect(buildBankFile({ ...base, debitAccount: '', payments: [pay()] })).rejects.toThrow(/Debit/);
  });
  it('picks transaction type', () => {
    expect(transactionType('IDFB0080123', 1000)).toBe('IFT');
    expect(transactionType('SBIN0001234', 1000)).toBe('NEFT');
    expect(transactionType('SBIN0001234', 20000000)).toBe('RTGS');
    expect(ddmmyyyy('2026-10-09')).toBe('09/10/2026');
  });
});
