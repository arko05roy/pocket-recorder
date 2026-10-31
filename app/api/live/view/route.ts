import { buildLive } from '@/lib/server/liveview';
import type { LiveLine } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST {lines: [{i, text}], previous?: [{kind, title, columns}]} → LiveState.
// Called by the chat each time a new piece of transcript arrives.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lines: LiveLine[] | null = Array.isArray(body?.lines)
    ? body.lines.filter((l: any) => Number.isInteger(l?.i) && typeof l.text === 'string')
      .slice(-400).map((l: any) => ({ i: l.i, text: l.text.slice(0, 1000) }))
    : null;
  if (!lines) return Response.json({ error: 'lines must be an array of {i, text}' }, { status: 400 });
  const previous = (Array.isArray(body.previous) ? body.previous : []).slice(0, 3)
    .filter((c: any) => typeof c?.kind === 'string')
    .map((c: any) => ({
      kind: c.kind,
      title: typeof c.title === 'string' ? c.title.slice(0, 80) : '',
      columns: Array.isArray(c.columns) ? c.columns.filter((x: unknown) => typeof x === 'string').slice(0, 8) : [],
    }));
  try {
    return Response.json(await buildLive(lines, previous));
  } catch (err) {
    console.error('live view failed', err);
    return Response.json({ error: 'Could not update the live view.' }, { status: 502 });
  }
}
