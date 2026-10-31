import { checkDraft, realMoment } from '@/lib/server/actions';
import { insertDraft, listDrafts } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(listDrafts());
}

// Saves a draft. There is no route that sends email.
export async function POST(request: Request) {
  const result = checkDraft(await request.json().catch(() => null), realMoment);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  const { kind, ...draft } = result.value;
  return Response.json({ id: insertDraft(draft) }, { status: 201 });
}
