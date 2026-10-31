import { saveVoiceNote } from '@/lib/server/graph';

// POST {source: "chat:<id>:<n>", lines, entities, relations}: a voice note
// finished; add what it established to the knowledge graph.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.source !== 'string' || !/^chat:[\w-]{8,64}:\d{1,5}$/.test(body.source)) {
    return Response.json({ error: 'source must look like chat:<id>:<n>' }, { status: 400 });
  }
  return Response.json(saveVoiceNote(body.source, body.lines, body.entities, body.relations));
}
