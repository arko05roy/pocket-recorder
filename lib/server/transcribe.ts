import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { groqFetch } from './groq';

const MODEL = 'whisper-large-v3-turbo';

// Returns [{ start, end, text }] with times in seconds from the start of the clip.
export async function transcribe(path: string): Promise<{ start: number; end: number; text: string }[]> {
  const audio = new Blob([await readFile(path)], { type: 'audio/wav' });
  const body = await groqFetch('/audio/transcriptions', () => {
    const form = new FormData();
    form.append('file', audio, basename(path));
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json'); // includes segment timestamps
    form.append('temperature', '0');
    return form;
  });
  return (body.segments ?? [])
    .map((s: { start: number; end: number; text: string }) => ({ start: s.start, end: s.end, text: s.text.trim() }))
    .filter((s: { text: string }) => s.text);
}
