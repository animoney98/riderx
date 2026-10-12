// Payroll calendar. Dates are plain YYYY-MM-DD strings in Asia/Kolkata,
// so no timezone arithmetic can shift a day.

const DAY = 86400000;
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * DAY);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(date: string): number {
  return (new Date(toMs(date)).getUTCDay() + 6) % 7;
}

export interface PayrollCycle {
  start: string; // Monday
  end: string; // Sunday
  /** Friday of the following week. */
  payDate: string;
}

export function cycleFor(date: string): PayrollCycle {
  const start = addDays(date, -weekdayIndex(date));
  return { start, end: addDays(start, 6), payDate: addDays(start, 11) };
}
