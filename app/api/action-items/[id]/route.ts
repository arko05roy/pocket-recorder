import { setActionItemStatus } from '@/lib/server/db';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (status !== 'open' && status !== 'done') {
    return Response.json({ error: "status must be 'open' or 'done'" }, { status: 400 });
  }
  if (!setActionItemStatus(Number((await params).id), status)) {
    return Response.json({ error: 'action item not found' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
