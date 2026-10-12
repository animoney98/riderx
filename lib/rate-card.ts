import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_RATE_CARD, type RateCard } from '@/src/engine/payout';

export const SPECIAL_PREFIX = 'Special day ';

/**
 * The rate card in force on a date. A one-day special card wins over the standard rates for its date.
 * With standardOnly, special days are ignored (used for week-level labels and the order limit of the first rate).
 * Falls back to the built-in default (with no id) if none is stored.
 */
export async function loadRateCard(sb: SupabaseClient, onDate: string, opts: { standardOnly?: boolean } = {}): Promise<{ id: string | null; card: RateCard; special: boolean }> {
  const { data } = await sb
    .from('rate_cards')
    .select('id, name, configuration, effective_end')
    .eq('status', 'active')
    .lte('effective_start', onDate)
    .order('effective_start', { ascending: false })
    .limit(20);
  const hits = (data ?? []).filter((r) => (!r.effective_end || r.effective_end >= onDate) && (!opts.standardOnly || !String(r.name).startsWith(SPECIAL_PREFIX)));
  const hit = hits.find((r) => String(r.name).startsWith(SPECIAL_PREFIX)) ?? hits[0];
  return hit ? { id: hit.id as string, card: hit.configuration as RateCard, special: String(hit.name).startsWith(SPECIAL_PREFIX) } : { id: null, card: DEFAULT_RATE_CARD, special: false };
}
