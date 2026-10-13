import { createHash, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseAnswers, sourceKey } from '@/src/engine/leads';

export const dynamic = 'force-dynamic';

const sha = (s: string) => createHash('sha256').update(s).digest();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * Receives Google Form responses. Google's script posts here each time someone submits the form.
 * The shared secret is the only credential; without it nothing is saved.
 */
export async function POST(req: Request) {
  const secret = process.env.LEADS_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Lead capture is not switched on yet (LEADS_WEBHOOK_SECRET missing)' }, 503);
  const given = req.headers.get('x-leads-secret') ?? '';
  if (!timingSafeEqual(sha(given), sha(secret))) return json({ error: 'Wrong secret' }, 401);

  const raw = await req.text();
  if (raw.length > 1_000_000) return json({ error: 'Request too large' }, 413);
  let body: { responses?: { id?: string; timestamp?: string; answers?: Record<string, unknown> }[] };
  try { body = JSON.parse(raw); } catch { return json({ error: 'Not valid JSON' }, 400); }
  const list = body.responses;
  if (!Array.isArray(list) || !list.length) return json({ error: 'Send {"responses":[...]}' }, 400);
  if (list.length > 200) return json({ error: 'At most 200 responses per request' }, 400);

  const rows: Record<string, unknown>[] = [];
  const rejected: { index: number; reason: string }[] = [];
  list.forEach((r, index) => {
    if (!r || typeof r.answers !== 'object' || r.answers === null) { rejected.push({ index, reason: 'No answers' }); return; }
    const p = parseAnswers(r.answers);
    if (!p.ok) { rejected.push({ index, reason: p.error }); return; }
    const l = p.lead;
    const ts = r.timestamp && !Number.isNaN(Date.parse(r.timestamp)) ? new Date(r.timestamp).toISOString() : new Date().toISOString();
    rows.push({
      source_key: sourceKey(r.id, r.timestamp, l.phone10), submitted_at: ts,
      full_name: l.fullName, email: l.email, phone: l.phone, phone10: l.phone10, date_of_birth: l.dob, vehicle_type: l.vehicleType,
      has_license_insurance: l.hasLicenseInsurance, work_type: l.workType, prior_experience: l.priorExperience, prior_platforms: l.priorPlatforms,
      has_zomato_account: l.hasZomatoAccount, start_when: l.startWhen, wants_onboarding: l.wantsOnboarding, raw_answers: r.answers,
    });
  });

  const admin = supabaseAdmin();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY missing' }, 503);
  let inserted = 0;
  if (rows.length) {
    // A response that was already saved is skipped, so the script can safely be re-run.
    const { data, error } = await admin.from('leads').upsert(rows, { onConflict: 'source_key', ignoreDuplicates: true }).select('id');
    if (error) return json({ error: 'Could not save: ' + error.message }, 500);
    inserted = data?.length ?? 0;
  }
  return json({ received: list.length, inserted, duplicates: rows.length - inserted, rejected });
}

export async function GET() {
  return json({ ok: true, note: 'Post form responses here with the x-leads-secret header.' });
}
