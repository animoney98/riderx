// Rules for "can this rider be paid by bank file?" and "which failed payments still need attention?". Pure so they can be tested.

export interface BankFacts {
  holder: string | null;
  account: string | null;
  ifsc: string | null;
  verifiedAt: string | null;
  upi: string | null;
  source: 'admin' | 'rider' | null;
}

export type Readiness = 'ready' | 'needs_check' | 'incomplete' | 'none';

/** The bank file needs holder, account number, IFSC and a human check (verified). Anything less keeps the rider out of the file. */
export function readiness(f: BankFacts | null): { state: Readiness; missing: string[] } {
  const has = (v: string | null | undefined) => !!v && v.trim() !== '';
  if (!f || (!has(f.holder) && !has(f.account) && !has(f.ifsc))) return { state: 'none', missing: ['Bank details'] };
  const missing: string[] = [];
  if (!has(f.holder)) missing.push('Account holder name');
  if (!has(f.account)) missing.push('Account number');
  if (!has(f.ifsc)) missing.push('IFSC code');
  if (missing.length) return { state: 'incomplete', missing };
  if (!f.verifiedAt) return { state: 'needs_check', missing: [f.source === 'rider' ? 'Your check (rider entered these)' : 'Your check'] };
  return { state: 'ready', missing: [] };
}

export function maskAccount(acct: string | null | undefined): string {
  const a = (acct ?? '').replace(/\s/g, '');
  return a ? `${'•'.repeat(Math.max(4, a.length - 4))}${a.slice(-4)}` : '';
}

export interface FailureFact { payoutId: string; amountPaise: number; failedOn: string; reason: string; createdAt: string }
export interface PayoutFact { payoutId: string; outstandingPaise: number }

/** A failure still needs attention while its payout has money outstanding. Latest failure per payout wins. Paying the rider later clears it by itself. */
export function openFailures<T extends FailureFact>(failures: T[], payouts: PayoutFact[]): (T & { outstandingPaise: number })[] {
  const out = new Map(payouts.map((p) => [p.payoutId, p.outstandingPaise]));
  const latest = new Map<string, T>();
  for (const f of failures) {
    const cur = latest.get(f.payoutId);
    if (!cur || f.createdAt > cur.createdAt) latest.set(f.payoutId, f);
  }
  return [...latest.values()].filter((f) => (out.get(f.payoutId) ?? 0) > 0).map((f) => ({ ...f, outstandingPaise: out.get(f.payoutId)! }));
}
