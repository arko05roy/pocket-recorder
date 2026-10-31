import { getDoc, markDocPrinted } from '@/lib/server/db';
import { printViaEsp32 } from '@/lib/server/printer';
import type { Doc } from '@/lib/types';

// Finalize & print: the only route that prints a document. It goes to the
// ESP32, which hands it to the printer picked in the sidebar.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const doc = getDoc(Number((await params).id));
  if (!doc) return Response.json({ error: 'not found' }, { status: 404 });
  const sent = await printViaEsp32(doc.title, docText(doc));
  if (!sent.ok) return Response.json({ error: sent.error }, { status: 502 });
  markDocPrinted(doc.id);
  return Response.json({ printed: true });
}

// The page as plain text: each heading in capitals with a rule under it.
function docText(doc: Doc) {
  return doc.sections
    .filter((s) => s.heading.trim() || s.body.trim())
    .map((s) => `${s.heading.toUpperCase()}\n${'-'.repeat(Math.min(s.heading.length, 60))}\n${s.body}`)
    .join('\n\n');
}
