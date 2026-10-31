import { searchSegments } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 200);
  return Response.json(searchSegments(q));
}
