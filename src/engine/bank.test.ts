import { describe, expect, it } from 'vitest';
import { maskAccount, openFailures, readiness } from './bank';

const full = { holder: 'A B', account: '123456789012', ifsc: 'IDFB0040101', verifiedAt: '2026-10-01T00:00:00Z', upi: null, source: 'admin' as const };

describe('readiness', () => {
  it('is ready only with every detail and a human check', () => {
    expect(readiness(full).state).toBe('ready');
    expect(readiness({ ...full, verifiedAt: null }).state).toBe('needs_check');
    expect(readiness({ ...full, verifiedAt: null, source: 'rider' }).missing[0]).toMatch(/rider entered/);
  });
  it('lists what is missing', () => {
    expect(readiness({ ...full, ifsc: null })).toEqual({ state: 'incomplete', missing: ['IFSC code'] });
    expect(readiness({ ...full, holder: ' ', account: '' }).missing).toEqual(['Account holder name', 'Account number']);
  });
  it('treats no row, or only a UPI id, as no bank details', () => {
    expect(readiness(null).state).toBe('none');
    expect(readiness({ holder: null, account: null, ifsc: null, verifiedAt: null, upi: 'a@upi', source: 'rider' }).state).toBe('none');
  });
});

describe('maskAccount', () => {
  it('shows only the last four digits', () => {
    expect(maskAccount('1111 2222 3333')).toBe('••••••••3333');
    expect(maskAccount('123456')).toBe('••••3456');
    expect(maskAccount(null)).toBe('');
  });
});

describe('openFailures', () => {
  const f = (payoutId: string, createdAt: string, reason = 'x') => ({ payoutId, amountPaise: 100, failedOn: '2026-10-10', reason, createdAt });
  it('keeps failures whose payout still has money outstanding, latest per payout', () => {
    const r = openFailures([f('p1', '1', 'first'), f('p1', '2', 'second'), f('p2', '1')], [{ payoutId: 'p1', outstandingPaise: 500 }, { payoutId: 'p2', outstandingPaise: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ payoutId: 'p1', reason: 'second', outstandingPaise: 500 });
  });
  it('drops a failure once the rider is paid', () => {
    expect(openFailures([f('p1', '1')], [{ payoutId: 'p1', outstandingPaise: 0 }])).toEqual([]);
  });
});
