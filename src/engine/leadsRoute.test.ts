import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: () => ({ from: () => ({ upsert: (...a: unknown[]) => { upsert(...a); return { select: async () => ({ data: upsert.mock.calls.at(-1)![0] ? (upsert.mock.calls.at(-1)![0] as unknown[]).slice(0, 1).map((_, i) => ({ id: String(i) })) : [], error: null }) }; } }) }) }));

import { POST } from '../../app/api/leads/route';

const answers = { 'Full Name': 'Ravi', 'Phone Number': '9876543210', 'What is your Vehicle Type?': 'Scooter' };
const req = (body: unknown, secret = 's3cret') => new Request('http://x/api/leads', { method: 'POST', headers: { 'x-leads-secret': secret }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('lead webhook', () => {
  beforeEach(() => { process.env.LEADS_WEBHOOK_SECRET = 's3cret'; upsert.mockClear(); });
  it('is off without a secret', async () => { delete process.env.LEADS_WEBHOOK_SECRET; expect((await POST(req({ responses: [] }))).status).toBe(503); });
  it('refuses a wrong secret and saves nothing', async () => {
    expect((await POST(req({ responses: [{ answers }] }, 'nope'))).status).toBe(401);
    expect((await POST(req({ responses: [{ answers }] }, ''))).status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });
  it('rejects bad bodies', async () => {
    expect((await POST(req('not json'))).status).toBe(400);
    expect((await POST(req({ responses: [] }))).status).toBe(400);
    expect((await POST(req({ nothing: 1 }))).status).toBe(400);
  });
  it('saves a good response with a stable key and reports rejects', async () => {
    const res = await POST(req({ responses: [{ id: 'R1', timestamp: '2026-10-13T06:00:00Z', answers }, { id: 'R2', answers: { 'Full Name': 'X', 'Phone Number': '123' } }] }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.received).toBe(2);
    expect(j.rejected).toEqual([{ index: 1, reason: 'Phone number looks wrong' }]);
    const rows = upsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source_key: 'gform:R1', phone10: '9876543210', full_name: 'Ravi', vehicle_type: 'Scooter' });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'source_key', ignoreDuplicates: true });
  });
});
