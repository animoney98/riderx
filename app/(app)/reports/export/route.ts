import { supabaseServer } from '@/lib/supabase-server';
import { BACKUP_TABLES, fetchAll, paymentsSheet, payrollHistorySheet, tripsSheets } from '@/lib/reports';
import { buildBackupWorkbook, buildReportWorkbook } from '@/src/export/reportsWorkbook';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const stamp = () => istNow().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new Response('Sign in first', { status: 401 });
  const { data: me } = await sb.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle();
  if (!me?.active) return new Response('No access', { status: 403 });
  const role = me.role as string;
  const q = new URL(req.url).searchParams;
  const type = q.get('type');
  const reply = (buffer: Buffer, filename: string) => new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  });
  const audit = (details: Record<string, unknown>) => sb.from('audit_logs').insert({ actor_id: auth.user!.id, action: 'report.download', entity_type: 'report', entity_id: type, after_values: details });

  try {
    if (type === 'backup') {
      if (role !== 'super_admin') return new Response('Only an Admin can download the full backup', { status: 403 });
      const tables = [];
      for (const [name, order] of BACKUP_TABLES) tables.push({ name, rows: await fetchAll(sb, name, order) });
      const { buffer, counts } = await buildBackupWorkbook(tables, new Date(), 'Contains rider bank details: keep this file private.');
      await audit({ counts });
      return reply(buffer, `RiderX-full-backup-${stamp()}.xlsx`);
    }
    if (type === 'payroll' || type === 'payments') {
      if (!['super_admin', 'finance_manager'].includes(role)) return new Response('Only finance managers and admins can download this report', { status: 403 });
      const sheet = type === 'payroll' ? await payrollHistorySheet(sb) : await paymentsSheet(sb);
      await audit({ rows: sheet.rows.length });
      return reply(await buildReportWorkbook([sheet]), `RiderX-${type === 'payroll' ? 'payroll-history' : 'payments-ledger'}-${stamp()}.xlsx`);
    }
    if (type === 'trips') {
      if (!['super_admin', 'finance_manager', 'operations_manager'].includes(role)) return new Response('No access to this report', { status: 403 });
      const from = q.get('from'); const to = q.get('to');
      if (!isDate(from) || !isDate(to)) return new Response('Choose a valid From and To date', { status: 400 });
      if (from > to) return new Response('The From date must not be after the To date', { status: 400 });
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) return new Response('Choose a range of at most 93 days (about three months)', { status: 400 });
      const { sheets, trips, withoutEarnings } = await tripsSheets(sb, from, to);
      if (!trips) return new Response('No trips with calculated earnings in that range', { status: 404 });
      await audit({ from, to, trips, withoutEarnings });
      return reply(await buildReportWorkbook(sheets), `RiderX-trips-${from}-to-${to}.xlsx`);
    }
    return new Response('Unknown report', { status: 400 });
  } catch (e) {
    return new Response(`Could not build the file: ${(e as Error).message}`, { status: 500 });
  }
}
