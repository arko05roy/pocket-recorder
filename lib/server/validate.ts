// Checks for values that came from the model or the browser: both untrusted.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
// Date.parse quietly rolls 2026-02-30 over to March 2, so check the date
// survives a round trip unchanged.
export const date = (v: unknown): string | null => {
  if (typeof v !== 'string' || !DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};
export const time = (v: unknown): string | null => (typeof v === 'string' && TIME.test(v) ? v : null);
