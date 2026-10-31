import { printBridge } from '@/lib/server/devices';
import { savedPrinter } from '@/lib/server/printer';

export const dynamic = 'force-dynamic';

// The print bridge (if online) and the printer it prints to.
export function GET() {
  return Response.json({ bridge: printBridge(), printer: savedPrinter() });
}
