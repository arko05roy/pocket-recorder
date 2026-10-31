import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_DIR, insertRecording, saveSegments, setDuration, setStatus } from '@/lib/server/db';
import { enqueue } from '@/lib/server/ingest';
import { parseTranscript } from '@/lib/transcript';

// POST /api/transcripts, multipart/form-data with `file` and optional `recorded_at`.
// A transcript (.txt, .srt, .vtt) skips transcription and goes straight to
// analysis. An audio file (mp3, m4a, wav, ...) is converted to WAV and goes
// through the same pipeline as a recorder upload.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac|mp4|mpeg|mpga)$/i;
const run = promisify(execFile);
const fail = (error: string) => Response.json({ error }, { status: 400 });

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail("missing 'file'");

  const given = form!.get('recorded_at');
  const recorded_at = typeof given === 'string' && !isNaN(Date.parse(given)) ? given : new Date().toISOString();
  const id = `upload_${recorded_at.slice(0, 19).replaceAll(':', '-')}_${Math.random().toString(36).slice(2, 6)}`;

  if (file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXT.test(file.name)) {
    if (file.size > MAX_AUDIO_BYTES) return fail('audio file is larger than 200 MB');
    // Convert to WAV so the player and the pipeline only ever see one format.
    const tmp = join(AUDIO_DIR, `${id}.upload`);
    const file_path = join(AUDIO_DIR, `${id}.wav`);
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()));
    try {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-vn', '-ac', '1', '-ar', '16000', file_path]);
    } catch {
      return fail("couldn't read that audio file");
    } finally {
      await rm(tmp, { force: true });
    }
    insertRecording({ id, device_id: 'upload', recorded_at, duration_ms: null, battery_pct: null, file_path });
    enqueue(id);
    return Response.json({ id }, { status: 201 });
  }

  if (file.size > MAX_BYTES) return fail('transcript is larger than 2 MB');
  const segments = parseTranscript(await file.text());
  if (!segments.length) return fail('no text found in that file');

  // file_path '' marks a recording with no audio behind it.
  insertRecording({ id, device_id: 'upload', recorded_at, duration_ms: null, battery_pct: null, file_path: '' });
  saveSegments(id, segments);
  setDuration(id, Math.round(segments.at(-1)!.end * 1000));
  setStatus(id, 'transcribed');
  enqueue(id); // analysis only, since it's already transcribed
  return Response.json({ id, segments: segments.length }, { status: 201 });
}
