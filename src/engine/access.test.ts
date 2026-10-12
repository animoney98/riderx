import { describe, expect, it } from 'vitest';
import { changeProblem, emailProblem, passwordProblem, type StaffRow } from './access';

const a: StaffRow = { id: 'a', role: 'super_admin', active: true };
const b: StaffRow = { id: 'b', role: 'super_admin', active: true };
const f: StaffRow = { id: 'f', role: 'finance_manager', active: true };

describe('changeProblem', () => {
  it('lets an admin change someone else', () => expect(changeProblem('a', f, { role: 'viewer', active: true }, [a, f])).toBeNull());
  it('refuses changing your own role', () => expect(changeProblem('a', a, { role: 'viewer', active: true }, [a, b])).toMatch(/own role/));
  it('refuses switching yourself off', () => expect(changeProblem('a', a, { role: 'super_admin', active: false }, [a, b])).toMatch(/own role/));
  it('refuses removing the last admin', () => expect(changeProblem('f', a, { role: 'viewer', active: true }, [a, f])).toMatch(/at least one/));
  it('refuses deactivating the last admin', () => expect(changeProblem('f', a, { role: 'super_admin', active: false }, [a, f])).toMatch(/at least one/));
  it('allows removing an admin when another remains', () => expect(changeProblem('a', b, { role: 'viewer', active: true }, [a, b])).toBeNull());
  it('ignores an inactive admin when counting', () => expect(changeProblem('f', a, { role: 'viewer', active: true }, [a, { ...b, active: false }, f])).toMatch(/at least one/));
});

describe('passwords and emails', () => {
  it('needs 10 chars with letters and numbers', () => {
    expect(passwordProblem('short1')).toBeTruthy();
    expect(passwordProblem('onlyletterslong')).toBeTruthy();
    expect(passwordProblem('1234567890')).toBeTruthy();
    expect(passwordProblem('Rider2026ok')).toBeNull();
  });
  it('checks email shape', () => {
    expect(emailProblem('a@b.com')).toBeNull();
    expect(emailProblem('nope')).toBeTruthy();
  });
});
