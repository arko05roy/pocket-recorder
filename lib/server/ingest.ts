import { rm } from 'node:fs/promises';
import { normalise, probeDurationMs, soundRanges } from './audio';
import { transcribe } from './transcribe';
import { analyse } from './analyse';
import {
  getRecording, getSegments, saveAnalysis, saveSegments, setDuration, setStatus, unfinishedRecordingIds,
  type RecordingRow,
} from './db';

// One job at a time: keeps us under Groq's rate limits and keeps logs readable.
// Lives on globalThis so every Next.js bundle shares the same queue.
const g = globalThis as unknown as { __ingest?: { queue: string[]; running: boolean } };
const state = (g.__ingest ??= { queue: [], running: false });

export function enqueue(id: string) {
  if (!state.queue.includes(id)) state.queue.push(id);
  drain();
}

// Pick up anything left half-done by a crash or restart.
export function resumeUnfinished() {
  unfinishedRecordingIds().forEach(enqueue);
}

async function drain() {
  if (state.running) return;
  state.running = true;
  while (state.queue.length) {
    const id = state.queue.shift()!;
    try {
      await processRecording(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('ingest failed', id, message);
      setStatus(id, 'error', message);
    }
  }
  state.running = false;
}

async function processRecording(id: string) {
  const rec = getRecording(id);
  if (!rec) return;

  if (rec.file_path && rec.duration_ms == null) setDuration(id, await probeDurationMs(rec.file_path));

  // After a restart, a recording that was already transcribed only needs analysing.
  if (rec.file_path && rec.status !== 'transcribed' && rec.status !== 'analysing') await transcribeRecording(rec);

  setStatus(id, 'analysing');
  const segments = getSegments(id);
  if (segments.length) {
    const result = await analyse(rec, segments);
    if (result.dropped) console.log(`dropped ${result.dropped} extracted item(s) citing missing lines`, id);
    saveAnalysis(id, result);
  } else {
    saveAnalysis(id, { title: null, summary: null, action_items: [], mentions: [] });
  }
  setStatus(id, 'ready');
  console.log('ready', id);
}

async function transcribeRecording(rec: RecordingRow) {
  const id = rec.id;
  setStatus(id, 'transcribing');
  const clean = rec.file_path.replace(/\.wav$/, '.16k.wav');
  try {
    await normalise(rec.file_path, clean);
    const durationS = (await probeDurationMs(clean)) / 1000;
    const [raw, sound] = await Promise.all([transcribe(clean), soundRanges(clean, durationS)]);
    const segments = keepRealSpeech(raw, sound, durationS);
    if (segments.length < raw.length) {
      console.log(`dropped ${raw.length - segments.length} segment(s) with no audio behind them`, id);
    }
    saveSegments(id, segments);
  } finally {
    await rm(clean, { force: true });
  }

  setStatus(id, 'transcribed');
  console.log('transcribed', id);
}

const MIN_OVERLAP_S = 0.2;

// Clamp timestamps to the real clip length, then keep a segment only if it has
// actual words and overlaps audible sound.
type RawSegment = { start: number; end: number; text: string };

export function keepRealSpeech(
  segments: RawSegment[],
  sound: { start: number; end: number }[],
  durationS: number,
): RawSegment[] {
  return segments
    .map((s) => ({ ...s, start: Math.min(s.start, durationS), end: Math.min(s.end, durationS) }))
    .filter((s) => /\p{L}|\p{N}/u.test(s.text))
    .filter((s) => sound.some((r) => Math.min(s.end, r.end) - Math.max(s.start, r.start) >= MIN_OVERLAP_S))
    // A line repeated word for word right after itself is Whisper looping,
    // not speech (seen on a real call: the same sentence three times).
    .filter((s, n, all) => n === 0 || norm(s.text) !== norm(all[n - 1].text));
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
