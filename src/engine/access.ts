// Staff roles and the safety rules for changing them. Pure so they can be tested.
export type Role = 'super_admin' | 'operations_manager' | 'finance_manager' | 'viewer';

export const ROLES: { value: Role; label: string; can: string }[] = [
  { value: 'super_admin', label: 'Admin', can: 'Everything: users, rates, payroll, payments, bank details, audit log.' },
  { value: 'operations_manager', label: 'Operations manager', can: 'Add and edit riders, import Zomato files, set rider logins, view everything except bank details and audit log.' },
  { value: 'finance_manager', label: 'Finance manager', can: 'Approve payroll, record payments and Zomato receipts, see bank details and download the bank file.' },
  { value: 'viewer', label: 'Viewer', can: 'Look only. Cannot change anything.' },
];

export const roleLabel = (r: string): string => ROLES.find((x) => x.value === r)?.label ?? r;

export type StaffRow = { id: string; role: Role; active: boolean };

/**
 * Returns a message when the change must be refused, or null when it is allowed.
 * Rules: you cannot change your own role or switch yourself off, and at least one active Admin must always remain.
 */
export function changeProblem(actorId: string, target: StaffRow, next: { role: Role; active: boolean }, all: StaffRow[]): string | null {
  if (actorId === target.id && (next.role !== target.role || next.active !== target.active)) {
    return 'You cannot change your own role or switch yourself off. Ask another Admin to do it.';
  }
  const wasAdmin = target.role === 'super_admin' && target.active;
  const stillAdmin = next.role === 'super_admin' && next.active;
  if (wasAdmin && !stillAdmin) {
    const others = all.filter((r) => r.id !== target.id && r.role === 'super_admin' && r.active).length;
    if (others === 0) return 'There must always be at least one active Admin.';
  }
  return null;
}

/** Staff passwords: 10+ characters with letters and numbers. Returns a message, or null when fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'The password must be at least 10 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'The password must contain both letters and numbers';
  return null;
}

export const emailProblem = (e: string): string | null => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? null : 'That email address looks wrong');
