import { writeReport } from '@/lib/server/recap';

export const dynamic = 'force-dynamic';

// POST {turns: [{speaker, text}], recorded_at?} → Recap. Opus.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const turns = Array.isArray(body?.turns)
    ? body.turns.filter((t: any) => typeof t?.text === 'string' && t.text.trim()).slice(0, 300)
      .map((t: any) => ({ speaker: t.speaker === 1 ? 1 : 0, text: t.text.slice(0, 4000) }))
    : [];
  if (!turns.length) return Response.json({ error: 'turns must be a non-empty array' }, { status: 400 });
  const recordedAt = typeof body.recorded_at === 'string' ? body.recorded_at.slice(0, 40) : new Date().toISOString();
  try {
    return Response.json(await writeReport(turns, recordedAt));
  } catch (err) {
    console.error('recap report failed', err);
    return Response.json({ error: 'The report couldn’t be written.' }, { status: 502 });
  }
}
