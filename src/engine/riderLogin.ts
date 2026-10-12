// Rider PIN login helpers. Pure so they can be tested.
export type Identifier = { kind: 'fe'; value: string } | { kind: 'phone'; value: string } | null;

/** A rider types either his Zomato FE ID (FE11568286) or his mobile number. */
export function parseIdentifier(raw: string): Identifier {
  const t = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^FE\d+$/.test(t)) return { kind: 'fe', value: t };
  const digits = t.replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(ten) ? { kind: 'phone', value: ten } : null;
}

/** Last ten digits of a stored phone number, for matching. */
export const last10 = (phone: string | null | undefined): string => (phone ?? '').replace(/\D/g, '').slice(-10);

/** 6 digits, and not an obvious one. Returns an error message, or null when fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'The PIN must be exactly 6 digits';
  if (/^(\d)\1{5}$/.test(pin)) return 'Choose a PIN that is not the same digit repeated';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Choose a PIN that is not a simple sequence';
  return null;
}

/** The login the system creates for a rider. It is never shown or used by hand. */
export const riderEmail = (riderId: string): string => `r-${riderId}@riders.riderx.app`;
