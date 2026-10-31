import { getRecordingDetail } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const detail = getRecordingDetail((await params).id);
  if (!detail) return Response.json({ error: 'recording not found' }, { status: 404 });
  return Response.json(detail);
}
