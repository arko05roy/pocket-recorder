import { onlineDevices } from '@/lib/server/devices';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(onlineDevices());
}
