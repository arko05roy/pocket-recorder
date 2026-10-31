import { deleteDoc, getDoc, updateDoc } from '@/lib/server/db';
import type { DocSection } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const doc = getDoc(Number((await params).id));
  return doc ? Response.json(doc) : Response.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  if (!deleteDoc(Number((await params).id))) return Response.json({ error: 'not found' }, { status: 404 });
  return new Response(null, { status: 204 });
}

// Save an edit from /docs/[id]. Body: { title, sections: [{ heading, body }] }.
export async function PATCH(request: Request, { params }: Ctx) {
  const id = Number((await params).id);
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 160) : '';
  const sections: DocSection[] = (Array.isArray(body?.sections) ? body.sections : [])
    .slice(0, 50)
    .map((s: any) => ({ heading: String(s?.heading ?? '').slice(0, 160), body: String(s?.body ?? '').slice(0, 20000) }));
  if (!title) return Response.json({ error: 'The doc needs a title.' }, { status: 400 });
  if (!updateDoc(id, title, sections)) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(getDoc(id));
}
