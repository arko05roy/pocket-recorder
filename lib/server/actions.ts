import type { Citation, DraftProposal, EventProposal, PrintProposal } from '../types';
import { getActionItems, getMentions, getRecording, getSegments } from './db';
import { date, str, time } from './validate';

// Given a recording and a second, the allowed moment it refers to, or null.
export type SourceCheck = (recordingId: string, t: number) => number | null;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Any real moment of the recording: the start of a line, an extracted item,
// or 0 for the recording as a whole. Used when the browser sends a proposal back.
export const realMoment: SourceCheck = (id, t) => {
  const moments = [0, ...getSegments(id).map((s) => s.start_s), ...getActionItems(id).map((i) => i.source_s),
    ...getMentions(id).map((m) => m.source_s)];
  let best: number | null = null;
  for (const s of moments) if (Math.abs(s - t) <= 1.5 && (best == null || Math.abs(s - t) < Math.abs(best - t))) best = s;
  return best;
};

function source(raw: any, check: SourceCheck): Citation | null {
  const id = str(raw?.recording_id, 200);
  const t = Number(raw?.t ?? raw?.start_s);
  if (!id || !Number.isFinite(t)) return null;
  const rec = getRecording(id);
  const start = rec ? check(id, t) : null;
  if (!rec || start == null) return null;
  return {
    recording_id: rec.id,
    label: rec.title ?? `${rec.device_id} ${rec.recorded_at.slice(11, 16)}`,
    recorded_at: rec.recorded_at,
    start_s: start,
  };
}

const NO_SOURCE = 'source must be a recording_id and t that a tool returned, where this was said';

export function checkEvent(raw: any, check: SourceCheck): Result<EventProposal> {
  const title = str(raw?.title, 120);
  const day = date(raw?.date);
  const start_time = raw?.start_time == null ? null : time(raw.start_time);
  const end_time = raw?.end_time == null ? null : time(raw.end_time);
  const src = source(raw?.source, check);
  if (!title) return { ok: false, error: 'title is required' };
  if (!day) return { ok: false, error: 'date must be a real YYYY-MM-DD date' };
  if (raw?.start_time != null && !start_time) return { ok: false, error: 'start_time must be HH:MM or null' };
  if (raw?.end_time != null && !end_time) return { ok: false, error: 'end_time must be HH:MM or null' };
  if (end_time && (!start_time || end_time <= start_time)) return { ok: false, error: 'end_time needs a start_time before it' };
  if (!src) return { ok: false, error: NO_SOURCE };
  const attendees = (Array.isArray(raw?.attendees) ? raw.attendees : [])
    .map((a: unknown) => str(a, 80)).filter(Boolean).slice(0, 20) as string[];
  return { ok: true, value: { kind: 'event', title, date: day, start_time, end_time, attendees, source: src } };
}

export function checkDraft(raw: any, check: SourceCheck): Result<DraftProposal> {
  const to = str(raw?.to, 200);
  const subject = str(raw?.subject, 200);
  const body = str(raw?.body, 5000);
  const src = source(raw?.source, check);
  if (!to) return { ok: false, error: 'to is required (a name or address as said in the recording)' };
  if (!subject) return { ok: false, error: 'subject is required' };
  if (!body) return { ok: false, error: 'body is required' };
  if (!src) return { ok: false, error: NO_SOURCE };
  return { ok: true, value: { kind: 'draft', to, subject, body, source: src } };
}

export function checkPrint(raw: any, check: SourceCheck): Result<PrintProposal> {
  const title = str(raw?.title, 120);
  const body = str(raw?.body, 8000);
  const src = source(raw?.source, check);
  if (!title) return { ok: false, error: 'title is required' };
  if (!body) return { ok: false, error: 'body is required (the text to print)' };
  if (!src) return { ok: false, error: NO_SOURCE };
  return { ok: true, value: { kind: 'print', title, body, source: src } };
}
