import { getGraph } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(getGraph());
}
