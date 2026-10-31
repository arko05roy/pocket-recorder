import { transcribeChunk } from '@/lib/server/transcribe';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024; // a few seconds of 16 kHz WAV is ~100 KB

// POST multipart {audio: WAV, prompt?: text so far} → {text}.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof File) || !audio.size) return Response.json({ error: "missing 'audio' file" }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: 'chunk too large' }, { status: 400 });
  const prompt = form?.get('prompt');
  try {
    return Response.json({ text: await transcribeChunk(audio, typeof prompt === 'string' ? prompt : '') });
  } catch (err) {
    console.error('live chunk failed', err);
    return Response.json({ error: 'Could not transcribe this part.' }, { status: 502 });
  }
}
