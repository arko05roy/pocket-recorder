import { listRecordings } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(listRecordings());
}
