import { checkEvent, realMoment } from '@/lib/server/actions';
import { insertEvent, listEvents } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(listEvents());
}

// Confirm on a proposal card. The proposal came back from the browser, so it
// is checked again, against the recording itself this time.
export async function POST(request: Request) {
  const result = checkEvent(await request.json().catch(() => null), realMoment);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  const { kind, ...event } = result.value;
  return Response.json({ id: insertEvent(event) }, { status: 201 });
}
