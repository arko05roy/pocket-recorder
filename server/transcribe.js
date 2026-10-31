import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';
const MAX_ATTEMPTS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns [{ start, end, text }] with times in seconds from the start of the clip.
export async function transcribe(path) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
  const audio = new Blob([await readFile(path)], { type: 'audio/wav' });

  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append('file', audio, basename(path));
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json'); // includes segment timestamps
    form.append('temperature', '0');

    const res = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });

    if (res.ok) {
      const body = await res.json();
      return (body.segments ?? [])
        .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
        .filter((s) => s.text);
    }

    // 429 = rate limited, 5xx = Groq-side problem: both are worth retrying.
    const retryable = res.status === 429 || res.status >= 500;
    const detail = await res.text();
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Groq transcription failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 1000;
    console.warn(`transcribe: ${res.status}, retrying in ${wait} ms`);
    await sleep(wait);
  }
}
