import { listChats } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(listChats());
}
