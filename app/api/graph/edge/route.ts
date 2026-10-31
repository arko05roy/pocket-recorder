import { deleteEdge } from '@/lib/server/db';

export function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  return Number.isInteger(id) && deleteEdge(id) ? new Response(null, { status: 204 }) : Response.json({ error: 'not found' }, { status: 404 });
}
