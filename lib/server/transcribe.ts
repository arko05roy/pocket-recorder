import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { groqFetch } from './groq';

// Full recordings use large-v3: on a real Hindi/English call, turbo guessed
// English, translated badly and looped ("I will tell you about the time" x3),
// while large-v3 transcribed it faithfully. Live chunks stay on turbo, where
// speed matters more. Both can be changed in .env.
const MODEL = process.env.WHISPER_MODEL || 'whisper-large-v3';
const LIVE_MODEL = process.env.WHISPER_LIVE_MODEL || 'whisper-large-v3-turbo';

// Whisper detects the language itself, so English and Hindi both work. But it
// often writes spoken Hindi in Urdu (Arabic) script. When that happens we ask
// again with language=hi, which forces Devanagari.
const URDU_SCRIPT = /\p{Script=Arabic}/u;

// Bengali works through auto-detection too, but Whisper sometimes hears
// Bengali as Hindi and writes it in Devanagari, mostly on short live chunks.
// WHISPER_LANGUAGE (e.g. "bn", "hi", "en") pins one language for every call;
// leave it empty to auto-detect, which mixed-language calls need.
const PINNED = process.env.WHISPER_LANGUAGE?.trim() || undefined;
const BENGALI_SCRIPT = /\p{Script=Bengali}/u;
const DEVANAGARI_SCRIPT = /\p{Script=Devanagari}/u;

// Returns [{ start, end, text }] with times in seconds from the start of the clip.
export async function transcribe(path: string): Promise<{ start: number; end: number; text: string }[]> {
  const audio = new Blob([await readFile(path)], { type: 'audio/wav' });
  const run = (language?: string) => groqFetch('/audio/transcriptions', () => {
    const form = new FormData();
    form.append('file', audio, basename(path));
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json'); // includes segment timestamps
    form.append('temperature', '0');
    if (language) form.append('language', language);
    return form;
  });
  let body = await run(PINNED);
  if (!PINNED && URDU_SCRIPT.test(String(body.text ?? ''))) body = await run('hi');
  return (body.segments ?? [])
    .map((s: { start: number; end: number; text: string }) => ({ start: s.start, end: s.end, text: s.text.trim() }))
    .filter((s: { text: string }) => s.text);
}

// What Whisper tends to write when a chunk holds no real speech.
const STOCK = /^(you|thank you|thanks|thanks for watching|thank you for watching|bye|okay|so|धन्यवाद|शुक्रिया|ठीक है|ধন্যবাদ|আচ্ছা|ঠিক আছে)[.!।]?$/iu;

// Loudness of a 16-bit PCM WAV, 0..1. Reads the samples after the 44-byte header.
function wavRms(buf: ArrayBuffer) {
  const view = new DataView(buf);
  let sum = 0, n = 0;
  for (let at = 44; at + 1 < buf.byteLength; at += 2, n++) sum += (view.getInt16(at, true) / 32768) ** 2;
  return n ? Math.sqrt(sum / n) : 0;
}

// A few seconds of live audio from the record page. `prompt` is the text so
// far, which helps Whisper continue sentences across chunk boundaries.
export async function transcribeChunk(audio: Blob, prompt: string): Promise<string> {
  // Whisper invents text on silence, and Groq's no_speech_prob reads 0 even
  // then, so check loudness ourselves and skip the call for quiet chunks.
  if (wavRms(await audio.arrayBuffer()) < 0.004) return '';
  const run = (language?: string) => groqFetch('/audio/transcriptions', () => {
    const form = new FormData();
    form.append('file', audio, 'chunk.wav');
    form.append('model', LIVE_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt.slice(-200));
    return form;
  });
  let body = await run(PINNED);
  if (!PINNED) {
    const got = String(body.text ?? '');
    // The conversation so far is Bengali but this chunk came back as Hindi:
    // ask again as Bengali.
    if (BENGALI_SCRIPT.test(prompt.slice(-200)) && DEVANAGARI_SCRIPT.test(got) && !BENGALI_SCRIPT.test(got)) body = await run('bn');
    else if (URDU_SCRIPT.test(got)) body = await run('hi');
  }
  const text = String(body.text ?? '').trim();
  return /[\p{L}\p{N}]/u.test(text) && !STOCK.test(text) ? text : '';
}
