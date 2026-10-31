import { deleteNode, getNodeProfile } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// GET ?name=Paruk → the node, its connections and the sentences it came up in.
export function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  const profile = name ? getNodeProfile(name.slice(0, 80)) : null;
  return profile ? Response.json(profile) : Response.json({ error: 'not in the graph' }, { status: 404 });
}

export function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  return Number.isInteger(id) && deleteNode(id) ? new Response(null, { status: 204 }) : Response.json({ error: 'not found' }, { status: 404 });
}
