import type { Status } from './types';

// recorded_at is the device's wall-clock time plus its offset. Show the wall
// clock as written, so a 14:32 meeting reads 14:32 whatever the viewer's zone.
function wallClock(iso: string) {
  const [y, mo, d, h, mi, s] = iso.slice(0, 19).split(/[-T:]/).map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

// Fixed locale so the server render and the browser render produce the same text.
const LOCALE = 'en-GB';

export const fmtDay = (iso: string) =>
  wallClock(iso).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtShortDay = (iso: string) =>
  wallClock(iso).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (iso: string) => iso.slice(11, 16);
export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

export function fmtClock(seconds: number | null | undefined) {
  const t = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const STATUS: Record<Status, string> = {
  received: 'Waiting to transcribe',
  transcribing: 'Transcribing',
  transcribed: 'Waiting to analyse',
  analysing: 'Analysing',
  ready: 'Ready',
  error: 'Failed',
};

export const isPending = (status: Status) => status !== 'ready' && status !== 'error';
// The transcript is shown as soon as it exists, even while analysis still runs.
export const hasTranscript = (status: Status) =>
  status === 'transcribed' || status === 'analysing' || status === 'ready';

export const recordingHref = (id: string, t?: number, seg?: number) => {
  const params = new URLSearchParams();
  if (t != null) params.set('t', String(t));
  if (seg != null) params.set('seg', String(seg));
  const q = params.toString();
  return `/r/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
};
