import { docFromVoice } from '@/lib/server/docgen';
import { getRecording } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// POST { recording_id, transcript } when a voice note is stopped → the Doc.
// Runs to the end on the server even if the page reloads meanwhile; the chat
// finds the doc again by its recording when it next opens.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.recording_id === 'string' ? body.recording_id.slice(0, 200) : '';
  const transcript = typeof body?.transcript === 'string' ? body.transcript.trim().slice(0, 60_000) : '';
  if (!id || !getRecording(id)) return Response.json({ error: 'unknown recording' }, { status: 400 });
  if (!transcript) return Response.json({ error: 'nothing was said' }, { status: 400 });
  try {
    return Response.json(await docFromVoice(id, transcript));
  } catch (err) {
    console.error('doc from voice failed', err);
    return Response.json({ error: 'The doc couldn’t be written. Try asking for it in chat.' }, { status: 502 });
  }
}
