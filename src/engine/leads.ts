// Rules for rider leads from the "RiderX Job Enquiry Form". Pure so they can be tested.
export type VehicleType = 'EV 2 Wheeler' | 'Scooter' | 'Motorcycle' | 'None' | string;
export type StartWhen = 'Immediately' | '2-3 Days' | '1 week' | 'After 1 week' | string;

export interface ParsedLead {
  fullName: string;
  email: string | null;
  phone: string;       // as typed
  phone10: string;     // last ten digits, used for matching
  dob: string | null;  // YYYY-MM-DD
  vehicleType: VehicleType | null;
  hasLicenseInsurance: boolean | null;
  workType: string | null;
  priorExperience: boolean | null;
  priorPlatforms: string[];
  hasZomatoAccount: boolean | null;
  startWhen: StartWhen | null;
  wantsOnboarding: boolean | null;
}

/** Everything the segment rules need from a saved lead. */
export interface LeadFacts {
  dob: string | null;
  vehicleType: string | null;
  hasLicenseInsurance: boolean | null;
  hasZomatoAccount: boolean | null;
  startWhen: string | null;
  wantsOnboarding: boolean | null;
  status: 'new' | 'contacted' | 'onboarded' | 'dropped';
  urgentManual: boolean;
}

const text = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(', ') : v == null ? '' : String(v)).trim();
const yesNo = (v: unknown): boolean | null => { const t = text(v).toLowerCase(); return /^y/.test(t) ? true : /^n/.test(t) ? false : null; };

/** Finds the answer whose question title matches. Titles may change slightly, so match on key words. */
function pick(answers: Record<string, unknown>, re: RegExp): unknown {
  for (const [k, v] of Object.entries(answers)) if (re.test(k.toLowerCase())) return v;
  return undefined;
}

export function normalizeVehicle(raw: string): VehicleType | null {
  const t = raw.trim();
  if (!t) return null;
  const l = t.toLowerCase();
  if (/^none|^no vehicle|^no$/.test(l)) return 'None';
  if (/\bev\b|electric/.test(l)) return 'EV 2 Wheeler';
  if (/scooter|scooty/.test(l)) return 'Scooter';
  if (/motor|bike/.test(l)) return 'Motorcycle';
  return t;
}

export function normalizeStart(raw: string): StartWhen | null {
  const l = raw.trim().toLowerCase();
  if (!l) return null;
  if (/immediate|today|now/.test(l)) return 'Immediately';
  if (/after/.test(l)) return 'After 1 week';
  if (/2\s*-?\s*(to)?\s*3/.test(l)) return '2-3 Days';
  if (/1\s*week|one week/.test(l)) return '1 week';
  return raw.trim();
}

/** Accepts YYYY-MM-DD (what Google's script sends) or MM/DD/YYYY (what the form shows). Returns null if unusable. */
export function parseDob(raw: string, today = new Date()): string | null {
  const t = raw.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; } else {
    r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (!r) return null;
    m = +r[1]; d = +r[2]; y = +r[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const age = ageOn(dt.toISOString().slice(0, 10), today);
  if (age === null || age < 14 || age > 80) return null;
  return dt.toISOString().slice(0, 10);
}

export function ageOn(dob: string | null, today = new Date()): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}

export function parseAnswers(answers: Record<string, unknown>): { ok: true; lead: ParsedLead } | { ok: false; error: string } {
  const fullName = text(pick(answers, /full name|^name/));
  if (!fullName) return { ok: false, error: 'Name is missing' };
  const phone = text(pick(answers, /phone|mobile/));
  const digits = phone.replace(/\D/g, '');
  const phone10 = digits.length >= 10 ? digits.slice(-10) : '';
  if (!/^[6-9]\d{9}$/.test(phone10)) return { ok: false, error: 'Phone number looks wrong' };
  const platformsRaw = pick(answers, /platform/);
  const platforms = (Array.isArray(platformsRaw) ? platformsRaw.map(String) : text(platformsRaw).split(/[,;]/)).map((s) => s.trim()).filter(Boolean);
  return {
    ok: true,
    lead: {
      fullName, phone, phone10,
      email: text(pick(answers, /e-?mail/)) || null,
      dob: parseDob(text(pick(answers, /date of birth|dob/))),
      vehicleType: normalizeVehicle(text(pick(answers, /vehicle type/))),
      hasLicenseInsurance: yesNo(pick(answers, /licen[cs]e|insurance/)),
      workType: text(pick(answers, /full time or part time|full time|part time/)) || null,
      priorExperience: yesNo(pick(answers, /previously worked/)),
      priorPlatforms: platforms,
      hasZomatoAccount: yesNo(pick(answers, /zomato delivery partner account|zomato.*account/)),
      startWhen: normalizeStart(text(pick(answers, /when can you start|start/))),
      wantsOnboarding: yesNo(pick(answers, /interested in proceeding|onboarding/)),
    },
  };
}

// ---------- Segments ----------
export const hasVehicle = (l: Pick<LeadFacts, 'vehicleType'>): boolean => !!l.vehicleType && l.vehicleType !== 'None';
export const isOpen = (l: Pick<LeadFacts, 'status'>): boolean => l.status === 'new' || l.status === 'contacted';
export const isInterested = (l: Pick<LeadFacts, 'wantsOnboarding'>): boolean => l.wantsOnboarding === true;

/** RiderX does not take people who already hold a Zomato delivery partner account. They are kept on record but never worked. */
export const isRejected = (l: Pick<LeadFacts, 'status' | 'hasZomatoAccount'>): boolean => isOpen(l) && l.hasZomatoAccount === true;

/** Has a vehicle, licence and insurance, and can start immediately. */
export const isReady = (l: LeadFacts): boolean =>
  isOpen(l) && !isRejected(l) && l.wantsOnboarding !== false && hasVehicle(l) && l.hasLicenseInsurance === true && l.startWhen === 'Immediately';

/** Start times that still count as urgent. */
export const URGENT_STARTS = ['Immediately', '2-3 Days', '1 week'];

/**
 * Urgent: 18 or older, has a vehicle, no Zomato account, said yes to onboarding, and can start immediately, in 2-3 days or in a week.
 * A licence is not required. A lead you flag by hand is also urgent, unless they hold a Zomato account.
 */
export function urgentReason(l: LeadFacts, today = new Date()): 'manual' | 'auto' | null {
  if (!isOpen(l) || isRejected(l)) return null;
  if (l.urgentManual) return 'manual';
  const age = ageOn(l.dob, today);
  const auto = age !== null && age >= 18 && hasVehicle(l) && l.hasZomatoAccount === false && l.wantsOnboarding === true && !!l.startWhen && URGENT_STARTS.includes(l.startWhen);
  return auto ? 'auto' : null;
}

export type Tab = 'urgent' | 'ready' | 'interested' | 'vehicle' | 'onboarded' | 'rejected' | 'all';
export const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'urgent', label: 'Urgent', hint: '18 or older, has a vehicle, no Zomato account, interested, and can start immediately, in 2-3 days or in a week. A licence is not required. Leads you flag by hand also appear here.' },
  { key: 'ready', label: 'Ready to join', hint: 'Have a vehicle, licence and insurance, and can start immediately.' },
  { key: 'interested', label: 'Interested', hint: 'Said yes to continuing with RiderX onboarding.' },
  { key: 'vehicle', label: 'With vehicle', hint: 'Own an EV, scooter or motorcycle.' },
  { key: 'onboarded', label: 'Added as riders', hint: 'Already added to the rider list.' },
  { key: 'rejected', label: 'Rejected', hint: 'Already hold a Zomato delivery partner account, so RiderX does not take them. Kept here for your records.' },
  { key: 'all', label: 'All', hint: 'Every enquiry, including rejected, not interested and dropped.' },
];

/** Which tabs a lead appears in. Added riders, rejected and dropped leads never appear in the working tabs. */
export function tabsFor(l: LeadFacts, today = new Date()): Set<Tab> {
  const t = new Set<Tab>(['all']);
  if (l.status === 'onboarded') { t.add('onboarded'); return t; }
  if (l.status === 'dropped') return t;
  if (isRejected(l)) { t.add('rejected'); return t; }
  if (urgentReason(l, today)) t.add('urgent');
  if (isReady(l)) t.add('ready');
  if (isInterested(l)) t.add('interested');
  if (hasVehicle(l)) t.add('vehicle');
  return t;
}

/** Most pressing first: urgent, then ready, then interested, then the rest. */
export function sortRank(l: LeadFacts, today = new Date()): number {
  return (urgentReason(l, today) ? 0 : isReady(l) ? 1 : isInterested(l) ? 2 : 3);
}

export function sourceKey(id: string | undefined, timestamp: string | undefined, phone10: string): string {
  return id ? `gform:${id}` : `gform:${timestamp ?? 'na'}|${phone10}`;
}
