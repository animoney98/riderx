import { describe, it, expect } from 'vitest';
import { parseModelJson, toFormTiers } from '../src/engine/targetPicture';

describe('target picture reading', () => {
  it('parses a fenced reply', () => {
    const r = parseModelJson('Here you go:\n```json\n{"date":"2026-10-14","base_rate_rupees":60,"tiers":[{"min_orders":50,"amount_rupees":70,"amount_kind":"total_rate"},{"min_orders":30,"amount_rupees":5,"amount_kind":"extra_on_top"}],"notes":null}\n```');
    expect(r.date).toBe('2026-10-14');
    expect(toFormTiers(r, 60)).toEqual([{ orders: 30, rate: 65 }, { orders: 50, rate: 70 }]);
  });
  it('drops unusable tiers and bad dates', () => {
    const r = parseModelJson('{"date":"tomorrow","tiers":[{"min_orders":0,"amount_rupees":70},{"min_orders":"x","amount_rupees":5},{"min_orders":40,"amount_rupees":-1}]}');
    expect(r.date).toBeNull();
    expect(r.tiers).toEqual([]);
  });
  it('rejects a reply with no JSON', () => expect(() => parseModelJson('I cannot read this')).toThrow());
});
