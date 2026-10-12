// Turns what the model read from a target picture into form values. Pure so it can be tested without calling any AI service.
export interface ReadTier { min_orders: number; amount_rupees: number; amount_kind: 'total_rate' | 'extra_on_top' }
export interface PictureRead { date: string | null; base_rate_rupees: number | null; tiers: ReadTier[]; notes: string | null }

/** Pulls the JSON object out of a model reply, tolerating code fences or a sentence around it. */
export function parseModelJson(text: string): PictureRead {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The picture could not be read');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const tiersIn = Array.isArray(raw.tiers) ? raw.tiers : [];
  const tiers: ReadTier[] = [];
  for (const t of tiersIn as Record<string, unknown>[]) {
    const min = Number(t.min_orders);
    const amt = Number(t.amount_rupees);
    if (!Number.isInteger(min) || min < 1 || !Number.isFinite(amt) || amt <= 0) continue;
    tiers.push({ min_orders: min, amount_rupees: amt, amount_kind: t.amount_kind === 'extra_on_top' ? 'extra_on_top' : 'total_rate' });
  }
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const base = Number(raw.base_rate_rupees);
  return { date, base_rate_rupees: Number.isFinite(base) && base > 0 ? base : null, tiers, notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 300) : null };
}

/** Form values (in rupees) for up to four tiers, lowest first. "Extra on top" amounts are added to the base rate. */
export function toFormTiers(read: PictureRead, baseRupees: number): { orders: number; rate: number }[] {
  return read.tiers
    .map((t) => ({ orders: t.min_orders, rate: Math.round((t.amount_kind === 'extra_on_top' ? baseRupees + t.amount_rupees : t.amount_rupees) * 100) / 100 }))
    .sort((a, b) => a.orders - b.orders)
    .slice(0, 4);
}
