import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { supabaseServer } from '@/lib/supabase-server';
import { parseRain } from '@/src/import/zomatoParser';

export const dynamic = 'force-dynamic';

const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const INR = '"₹"#,##0.00';
const KM = '0.00" km"';

/**
 * Turns an uploaded delivery file into one worksheet: every original column untouched, plus
 * FE ID (when the file only has ID, 10,000 is added), Pay, Total Distance, Extra KM Charge, Rain Surge,
 * Batched Order Fee and a Review Flag. Calculated cells are Excel formulas so they can be checked.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new Response('Sign in first', { status: 401 });
  const { data: profile } = await sb.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle();
  if (!profile?.active) return new Response('Only RiderX staff can use this', { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return new Response('Choose an Excel file first', { status: 400 });
  if (file.size > 10 * 1024 * 1024) return new Response('File is larger than 10 MB', { status: 400 });

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  const headers = (grid[0] ?? []).map((h) => String(h ?? '').trim());
  const data = grid.slice(1).filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined));
  if (!headers.length || !data.length) return new Response('No data rows found', { status: 400 });

  const idx = (...names: string[]) => headers.findIndex((h) => names.includes(norm(h)));
  const feI = idx('feid');
  const idI = idx('id');
  const pI = idx('pickupdistance', 'pickupdistancekm', 'pickupkm');
  const dI = idx('dropdistance', 'dropdistancekm', 'dropkm');
  const oI = idx('orders');
  const rI = idx('israining');
  const missing = [feI < 0 && idI < 0 ? 'ID (or FE ID)' : '', pI < 0 ? 'pickup distance' : '', dI < 0 ? 'drop distance' : '', oI < 0 ? 'orders' : '', rI < 0 ? 'isRaining' : ''].filter(Boolean);
  if (missing.length) return new Response(`Could not find these columns: ${missing.join(', ')}. Nothing was guessed.`, { status: 400 });
  // The identifier column is "FE ID" when present, otherwise "ID". A bare number gets 10,000 added; a value that starts with FE is final.
  const srcI = feI >= 0 ? feI : idI;
  const isFeText = (v: unknown) => /^FE-?\s*\d+$/i.test(String(v ?? '').trim());
  const rawFormat = data.some((r) => !isFeText(r[srcI]));

  // Which of the resulting FE IDs are registered riders.
  const feOf = (r: unknown[]): number | null => {
    const t = String(r[srcI] ?? '').trim().replace(/\s+/g, '');
    if (isFeText(t)) return Number(t.replace(/\D/g, ''));
    const m = t.match(/^(\d+)(?:\.0+)?$/);
    return m ? Number(m[1]) + 10000 : null;
  };
  const wanted = [...new Set(data.map(feOf).filter((n): n is number => n !== null).map((n) => `FE${n}`))];
  const known = new Set<string>();
  for (let i = 0; i < wanted.length; i += 200) {
    const { data: acc } = await sb.from('rider_platform_accounts').select('platform_rider_id').eq('platform', 'zomato').in('platform_rider_id', wanted.slice(i, i + 200));
    for (const a of acc ?? []) known.add(a.platform_rider_id as string);
  }

  const out = new ExcelJS.Workbook();
  const sheet = out.addWorksheet('Processed');
  const n0 = headers.length;
  const calcHeaders = [...(rawFormat ? ['FE ID'] : []), 'Pay', 'Total Distance', 'Extra KM Charge', 'Rain Surge', 'Batched Order Fee', 'Review Flag'];
  // The raw ID stays where it was, labelled so it is not mistaken for the FE ID.
  const shown = headers.map((h, i) => (rawFormat && i === srcI ? 'Raw ID' : h));
  sheet.addRow([...shown, ...calcHeaders]);

  const col = (i: number) => sheet.getColumn(i + 1).letter;
  const cFe = rawFormat ? n0 : srcI;
  const cPay = n0 + (rawFormat ? 1 : 0);
  const cTd = cPay + 1, cEx = cPay + 2, cRain = cPay + 3, cBatch = cPay + 4, cFlag = cPay + 5;

  data.forEach((r, k) => {
    const row = k + 2;
    const flags: string[] = [];
    const fe = feOf(r);
    if (fe === null) flags.push(`ID "${String(r[srcI] ?? '')}" is not a number`);
    else if (!known.has(`FE${fe}`)) flags.push(`${rawFormat ? `Raw ID ${String(r[srcI]).trim()} -> ` : ''}FE ID ${fe} is not a registered rider`);
    const p = typeof r[pI] === 'number' ? (r[pI] as number) : Number(String(r[pI] ?? '').trim() === '' ? NaN : r[pI]);
    const d = typeof r[dI] === 'number' ? (r[dI] as number) : Number(String(r[dI] ?? '').trim() === '' ? NaN : r[dI]);
    const o = Number(r[oI]);
    const rain = parseRain(r[rI]);
    const goodDist = Number.isFinite(p) && Number.isFinite(d) && p >= 0 && d >= 0;
    if (!goodDist) flags.push('Pickup or drop distance is missing or invalid');
    if (rain === null) flags.push('isRaining is blank or not TRUE/FALSE');
    const td = goodDist ? p + d : null;
    const ex = td === null ? null : Math.max(0, td - 6) * 5;
    const rs = rain === null ? null : rain ? (o === 2 ? 35 : 25) : 0;
    const bf = o === 2 ? 30 : 0;
    const P = `${col(pI)}${row}`, D = `${col(dI)}${row}`, O = `${col(oI)}${row}`, R = `${col(rI)}${row}`, T = `${col(cTd)}${row}`;
    const cells: unknown[] = [...r.slice(0, n0).map((v) => (v === '' ? null : v))];
    while (cells.length < n0) cells.push(null);
    if (rawFormat) cells.push({ formula: `IF(ISNUMBER(${col(srcI)}${row}),${col(srcI)}${row}+10000,"")`, result: fe ?? '' });
    cells.push(60);
    cells.push({ formula: `IF(AND(ISNUMBER(${P}),ISNUMBER(${D})),${P}+${D},"")`, result: td ?? '' });
    cells.push({ formula: `IF(ISNUMBER(${T}),MAX(0,${T}-6)*5,"")`, result: ex ?? '' });
    cells.push({ formula: `IF(OR(${R}=TRUE,UPPER(${R}&"")="TRUE"),IF(${O}=2,35,25),IF(OR(${R}=FALSE,UPPER(${R}&"")="FALSE"),0,""))`, result: rs ?? '' });
    cells.push({ formula: `IF(${O}=2,30,0)`, result: bf });
    cells.push(flags.join('; '));
    sheet.addRow(cells as ExcelJS.CellValue[]);
  });

  // Formatting: bold frozen header, filters, readable widths, rupee and km formats.
  const head = sheet.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.eachCell((c, i) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i > n0 ? 'FFE3EAFB' : 'FFF1F3F7' } }; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.length + 1, column: n0 + calcHeaders.length } };
  for (let i = 0; i < n0 + calcHeaders.length; i++) {
    const c = sheet.getColumn(i + 1);
    const longest = Math.max(String(sheet.getRow(1).getCell(i + 1).value ?? '').length, ...data.slice(0, 200).map((r) => String(i < n0 ? r[i] ?? '' : '').length));
    c.width = Math.min(40, Math.max(11, longest + 3));
  }
  sheet.getColumn(cFlag + 1).width = 46;
  for (const i of [cPay, cEx, cRain, cBatch]) sheet.getColumn(i + 1).numFmt = INR;
  sheet.getColumn(cTd + 1).numFmt = KM;
  sheet.getColumn(pI + 1).numFmt = KM; sheet.getColumn(dI + 1).numFmt = KM;
  if (rawFormat) sheet.getColumn(cFe + 1).numFmt = '0';

  const buf = await out.xlsx.writeBuffer();
  const name = file.name.replace(/\.xlsx?$/i, '') + '-processed.xlsx';
  return new Response(buf as ArrayBuffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"` } });
}
