import { clearGraph, getGraph } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(getGraph());
}

// Wipes every node, connection and mention. Recordings and chats are kept.
export function DELETE() {
  clearGraph();
  return new Response(null, { status: 204 });
}
