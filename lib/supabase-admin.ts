import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-only client with full database access. It bypasses all row-level security, so it is used ONLY for
 * creating rider logins and looking up a rider at sign-in. Never import this into a client component.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
