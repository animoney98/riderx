import { describe, expect, it } from 'vitest';
import { ageOn, isReady, parseAnswers, parseDob, sortRank, sourceKey, tabsFor, urgentReason, type LeadFacts } from './leads';

const full = {
  'Full Name': ' Ravi Kumar ', 'Email Address': 'ravi@example.com', 'Phone Number': '+91 98765-43210', 'Date of Birth': '1998-04-12',
  'What is your Vehicle Type?': 'EV 2 Wheeler', 'Do you have a valid driver license and vehicle insurance?': 'Yes', 'Are you looking for Full time or Part time?': 'Full time',
  'Have you previously worked as a delivery partner?': 'Yes', 'If yes, which platforms have you worked with?': ['Zepto', 'Zomato'],
  'Do you currently have a Zomato delivery partner account?': 'Yes', 'When can you start?': 'Immediately', 'Are you interested in proceeding with the RiderX rider onboarding process?': 'Yes',
};
const facts = (o: Partial<LeadFacts> = {}): LeadFacts => ({ vehicleType: 'Scooter', hasLicenseInsurance: true, hasZomatoAccount: false, startWhen: 'Immediately', wantsOnboarding: true, status: 'new', urgentManual: false, ...o });

describe('parseAnswers', () => {
  it('reads every form question', () => {
    const r = parseAnswers(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead).toMatchObject({ fullName: 'Ravi Kumar', phone10: '9876543210', dob: '1998-04-12', vehicleType: 'EV 2 Wheeler', hasLicenseInsurance: true, workType: 'Full time', priorExperience: true, hasZomatoAccount: true, startWhen: 'Immediately', wantsOnboarding: true });
    expect(r.lead.priorPlatforms).toEqual(['Zepto', 'Zomato']);
  });
  it('accepts platforms as comma text and the Other write-in', () => {
    const r = parseAnswers({ ...full, 'If yes, which platforms have you worked with?': 'Blinkit, Dunzo' });
    expect(r.ok && r.lead.priorPlatforms).toEqual(['Blinkit', 'Dunzo']);
  });
  it('rejects a missing name or a bad phone', () => {
    expect(parseAnswers({ ...full, 'Full Name': ' ' })).toEqual({ ok: false, error: 'Name is missing' });
    expect(parseAnswers({ ...full, 'Phone Number': '12345' })).toEqual({ ok: false, error: 'Phone number looks wrong' });
    expect(parseAnswers({ ...full, 'Phone Number': '5876543210' })).toEqual({ ok: false, error: 'Phone number looks wrong' });
  });
  it('keeps unanswered optional questions as null', () => {
    const r = parseAnswers({ 'Full Name': 'A', 'Phone Number': '9876543210' });
    expect(r.ok && r.lead).toMatchObject({ email: null, dob: null, vehicleType: null, hasLicenseInsurance: null, startWhen: null, wantsOnboarding: null, priorPlatforms: [] });
  });
  it('normalises start times and vehicles', () => {
    const r = parseAnswers({ ...full, 'When can you start?': '2-3 Days', 'What is your Vehicle Type?': 'None' });
    expect(r.ok && [r.lead.startWhen, r.lead.vehicleType]).toEqual(['2-3 Days', 'None']);
    const r2 = parseAnswers({ ...full, 'When can you start?': 'After 1 week', 'What is your Vehicle Type?': 'Motorcycle' });
    expect(r2.ok && [r2.lead.startWhen, r2.lead.vehicleType]).toEqual(['After 1 week', 'Motorcycle']);
  });
});

describe('dates', () => {
  const today = new Date('2026-10-13T00:00:00Z');
  it('parses ISO and US dates', () => {
    expect(parseDob('1998-04-12', today)).toBe('1998-04-12');
    expect(parseDob('04/12/1998', today)).toBe('1998-04-12');
  });
  it('rejects impossible or implausible dates', () => {
    expect(parseDob('02/31/1998', today)).toBeNull();
    expect(parseDob('2020-01-01', today)).toBeNull();
    expect(parseDob('1900-01-01', today)).toBeNull();
    expect(parseDob('garbage', today)).toBeNull();
  });
  it('computes age', () => {
    expect(ageOn('1998-10-13', today)).toBe(28);
    expect(ageOn('1998-10-14', today)).toBe(27);
    expect(ageOn(null, today)).toBeNull();
  });
});

describe('segments', () => {
  it('ready needs vehicle, licence+insurance and immediate start', () => {
    expect(tabsFor(facts()).has('ready')).toBe(true);
    expect(tabsFor(facts({ vehicleType: 'None' })).has('ready')).toBe(false);
    expect(tabsFor(facts({ hasLicenseInsurance: false })).has('ready')).toBe(false);
    expect(tabsFor(facts({ hasLicenseInsurance: null })).has('ready')).toBe(false);
    expect(tabsFor(facts({ startWhen: '1 week' })).has('ready')).toBe(false);
  });
  it('urgent is ready plus a Zomato account, or flagged by hand', () => {
    expect(urgentReason(facts())).toBeNull();
    expect(urgentReason(facts({ hasZomatoAccount: true }))).toBe('auto');
    expect(urgentReason(facts({ urgentManual: true, vehicleType: 'None' }))).toBe('manual');
    expect(urgentReason(facts({ hasZomatoAccount: true, startWhen: '2-3 Days' }))).toBeNull();
  });
  it('someone who said no is not interested and not ready', () => {
    const t = tabsFor(facts({ wantsOnboarding: false }));
    expect(t.has('interested')).toBe(false);
    expect(t.has('ready')).toBe(false);
    expect(t.has('vehicle')).toBe(true);
  });
  it('unanswered interest does not count as interested but can still be ready', () => {
    const t = tabsFor(facts({ wantsOnboarding: null }));
    expect(t.has('interested')).toBe(false);
    expect(t.has('ready')).toBe(true);
  });
  it('onboarded and dropped leads leave the working tabs', () => {
    expect([...tabsFor(facts({ status: 'onboarded', hasZomatoAccount: true }))].sort()).toEqual(['all', 'onboarded']);
    expect([...tabsFor(facts({ status: 'dropped', hasZomatoAccount: true }))]).toEqual(['all']);
  });
  it('onboarded or dropped leads are never urgent or ready, even if flagged', () => {
    for (const status of ['onboarded', 'dropped'] as const) {
      expect(urgentReason(facts({ status, urgentManual: true, hasZomatoAccount: true }))).toBeNull();
      expect(isReady(facts({ status }))).toBe(false);
    }
  });
  it('sorts urgent before ready before interested before the rest', () => {
    const r = [facts({ hasZomatoAccount: true }), facts(), facts({ startWhen: '1 week' }), facts({ wantsOnboarding: false, startWhen: '1 week' })].map(sortRank);
    expect(r).toEqual([0, 1, 2, 3]);
  });
});

describe('sourceKey', () => {
  it('prefers the form response id', () => {
    expect(sourceKey('abc', 't', '9876543210')).toBe('gform:abc');
    expect(sourceKey(undefined, '2026-10-13T00:00:00Z', '9876543210')).toBe('gform:2026-10-13T00:00:00Z|9876543210');
  });
});
