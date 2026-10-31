import { deleteEvent } from '@/lib/server/db';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!deleteEvent(Number((await params).id))) return Response.json({ error: 'not found' }, { status: 404 });
  return new Response(null, { status: 204 });
}
