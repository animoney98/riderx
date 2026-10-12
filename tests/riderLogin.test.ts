import { describe, it, expect } from 'vitest';
import { parseIdentifier, pinProblem, last10, riderEmail } from '../src/engine/riderLogin';

describe('rider login helpers', () => {
  it('reads an FE ID or a phone number', () => {
    expect(parseIdentifier(' fe 11568286 ')).toEqual({ kind: 'fe', value: 'FE11568286' });
    expect(parseIdentifier('+91 98765-43210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(parseIdentifier('09876543210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(parseIdentifier('12345')).toBeNull();
    expect(parseIdentifier('')).toBeNull();
  });
  it('matches stored phones by last 10 digits', () => {
    expect(last10('+91 98765 43210')).toBe('9876543210');
    expect(last10(null)).toBe('');
  });
  it('rejects weak PINs', () => {
    expect(pinProblem('123456')).toMatch(/sequence/);
    expect(pinProblem('111111')).toMatch(/repeated/);
    expect(pinProblem('12345')).toMatch(/6 digits/);
    expect(pinProblem('abcdef')).toMatch(/6 digits/);
    expect(pinProblem('483920')).toBeNull();
  });
  it('builds a stable login name', () => expect(riderEmail('abc')).toBe('r-abc@riders.riderx.app'));
});
