import { supabaseAdmin } from '@/lib/supabase-admin';
import { supabaseServer } from '@/lib/supabase-server';
import { last10, parseIdentifier, riderEmail } from '@/src/engine/riderLogin';

/** Sign a rider in with his FE ID (or mobile number) and 6-digit PIN. Returns null when it worked, otherwise a short reason code. */
export async function signInRider(rawId: string, pin: string): Promise<null | 'wrong' | 'off'> {
  const id = parseIdentifier(rawId);
  if (!id || !/^\d{6}$/.test(pin.trim())) return 'wrong';
  const admin = supabaseAdmin();
  if (!admin) return 'off';
  let riderId: string | null = null;
  if (id.kind === 'fe') {
    const { data } = await admin.from('rider_platform_accounts').select('rider_id').eq('platform', 'zomato').eq('platform_rider_id', id.value);
    if (data?.length === 1) riderId = data[0].rider_id as string;
  } else {
    const { data } = await admin.from('riders').select('id, phone').not('phone', 'is', null);
    const hits = (data ?? []).filter((r) => last10(r.phone as string) === id.value);
    if (hits.length === 1) riderId = hits[0].id as string;
  }
  if (!riderId) { console.error('rider sign-in: no single rider found for', id.kind); return 'wrong'; }
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: riderEmail(riderId), password: pin.trim() });
  if (error) { console.error('rider sign-in: password check failed:', error.message); return 'wrong'; }
  return null;
}
