// Fills the IDFC FIRST Bank bulk-payment template (TBW3). Pure: data in, .xlsx buffer out.
import ExcelJS from 'exceljs';
import { IDFC_TEMPLATE_BASE64 } from './idfcTemplate';

export interface BankPayment {
  feId: string;
  name: string; // beneficiary name as on the bank account
  accountNumber: string;
  ifsc: string;
  amountPaise: number;
  remarks: string;
}

export const FIRST_DATA_ROW = 3; // rows 1-2 of the template are headers and instructions

export function transactionType(ifsc: string, amountPaise: number): 'IFT' | 'NEFT' | 'RTGS' {
  if (ifsc.toUpperCase().startsWith('IDFB')) return 'IFT';
  return amountPaise >= 200000 * 100 ? 'RTGS' : 'NEFT';
}

/** DD/MM/YYYY, as the template requires. */
export function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function buildBankFile(input: { payments: BankPayment[]; debitAccount: string; valueDate: string }): Promise<{ buffer: Buffer; totalPaise: number; count: number }> {
  const { payments, debitAccount, valueDate } = input;
  if (!/^[0-9]{6,20}$/.test(debitAccount)) throw new Error('Debit account number is not set or not valid');
  if (!payments.length) throw new Error('No riders to pay');
  for (const p of payments) {
    if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) throw new Error(`Invalid amount for ${p.feId}`);
    if (!/^[0-9]{6,20}$/.test(p.accountNumber)) throw new Error(`Invalid account number for ${p.feId}`);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p.ifsc)) throw new Error(`Invalid IFSC for ${p.feId}`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(IDFC_TEMPLATE_BASE64, 'base64') as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  // Clear any sample rows, keep each column's existing formatting and the pre-filled INR currency.
  payments.forEach((p, i) => {
    const r = FIRST_DATA_ROW + i;
    const set = (c: number, v: ExcelJS.CellValue, fmt?: string) => { const cell = ws.getCell(r, c); cell.value = v; if (fmt) cell.numFmt = fmt; };
    set(1, p.name);
    set(2, p.accountNumber, '@');
    set(3, p.ifsc);
    set(4, transactionType(p.ifsc, p.amountPaise));
    set(5, debitAccount, '@');
    set(6, ddmmyyyy(valueDate), '@');
    set(7, p.amountPaise / 100, '0.00');
    set(8, 'INR');
    set(10, p.remarks);
    set(11, p.feId);
  });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const totalPaise = payments.reduce((s, p) => s + p.amountPaise, 0);
  return { buffer, totalPaise, count: payments.length };
}
