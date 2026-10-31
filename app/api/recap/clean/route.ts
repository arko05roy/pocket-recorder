import { cleanTranscript } from '@/lib/server/recap';

export const dynamic = 'force-dynamic';

// POST {lines: [{i, text}]} → {turns: [{speaker, text}]}. Sonnet.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lines = Array.isArray(body?.lines)
    ? body.lines.filter((l: any) => typeof l?.text === 'string').slice(0, 600)
      .map((l: any, i: number) => ({ i, text: l.text.slice(0, 1000) }))
    : [];
  if (!lines.length) return Response.json({ error: 'lines must be a non-empty array' }, { status: 400 });
  try {
    return Response.json({ turns: await cleanTranscript(lines) });
  } catch (err) {
    console.error('recap clean failed', err);
    return Response.json({ error: 'The transcript couldn’t be cleaned up.' }, { status: 502 });
  }
}
