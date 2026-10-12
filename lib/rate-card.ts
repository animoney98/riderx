import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_RATE_CARD, type RateCard } from '@/src/engine/payout';

/** The active rate card effective on a date. Falls back to the built-in default (with no id) if none is stored. */
export async function loadRateCard(sb: SupabaseClient, onDate: string): Promise<{ id: string | null; card: RateCard }> {
  const { data } = await sb
    .from('rate_cards')
    .select('id, configuration, effective_end')
    .eq('status', 'active')
    .lte('effective_start', onDate)
    .order('effective_start', { ascending: false })
    .limit(5);
  const hit = (data ?? []).find((r) => !r.effective_end || r.effective_end >= onDate);
  return hit ? { id: hit.id as string, card: hit.configuration as RateCard } : { id: null, card: DEFAULT_RATE_CARD };
}
