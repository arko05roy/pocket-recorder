import { deleteChat, getChat, saveChat } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

const ID = /^[\w-]{8,64}$/;
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const chat = getChat((await params).id);
  return chat ? Response.json(chat) : Response.json({ error: 'chat not found' }, { status: 404 });
}

// The chat page saves its whole thread after each change. The id is made by
// the browser (a UUID), so the first save creates the chat.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ error: 'invalid chat id' }, { status: 400 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'chat is too large to save' }, { status: 413 });
  let body: any;
  try { body = JSON.parse(text); } catch { return Response.json({ error: 'expected JSON' }, { status: 400 }); }
  if (!Array.isArray(body?.turns)) return Response.json({ error: 'turns must be an array' }, { status: 400 });
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'New chat';
  saveChat(id, title, body.turns);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return deleteChat((await params).id) ? new Response(null, { status: 204 }) : Response.json({ error: 'chat not found' }, { status: 404 });
}
