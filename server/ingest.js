import { rm } from 'node:fs/promises';
import { normalise, probeDurationMs, soundRanges } from './audio.js';
import { transcribe } from './transcribe.js';
import { analyse } from './analyse.js';
import {
  getRecording, getSegments, saveAnalysis, saveSegments, setDuration, setStatus, unfinishedRecordingIds,
} from './db.js';

// One job at a time: keeps us under Groq's rate limits and keeps logs readable.
const queue = [];
let running = false;

export function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  drain();
}

// Pick up anything left half-done by a crash or restart.
export function resumeUnfinished() {
  unfinishedRecordingIds().forEach(enqueue);
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await processRecording(id);
    } catch (err) {
      console.error('ingest failed', id, err.message);
      setStatus(id, 'error', err.message);
    }
  }
  running = false;
}

async function processRecording(id) {
  const rec = getRecording(id);
  if (!rec) return;

  if (rec.duration_ms == null) setDuration(id, await probeDurationMs(rec.file_path));

  // After a restart, a recording that was already transcribed only needs analysing.
  if (rec.status !== 'transcribed' && rec.status !== 'analysing') await transcribeRecording(rec);

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

async function transcribeRecording(rec) {
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
export function keepRealSpeech(segments, sound, durationS) {
  return segments
    .map((s) => ({ ...s, start: Math.min(s.start, durationS), end: Math.min(s.end, durationS) }))
    .filter((s) => /\p{L}|\p{N}/u.test(s.text))
    .filter((s) => sound.some((r) => Math.min(s.end, r.end) - Math.max(s.start, r.start) >= MIN_OVERLAP_S));
}
