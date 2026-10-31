import { checkPrint, realMoment } from '@/lib/server/actions';
import { printViaEsp32 } from '@/lib/server/printer';

export const dynamic = 'force-dynamic';

// Runs only when the user presses Confirm on a print card.
export async function POST(request: Request) {
  const result = checkPrint(await request.json().catch(() => null), realMoment);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  const sent = await printViaEsp32(result.value.title, result.value.body);
  if (!sent.ok) return Response.json({ error: sent.error }, { status: 502 });
  return Response.json({ printed: true, bytes: sent.bytes });
}
