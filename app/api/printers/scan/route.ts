import { scanPrinters } from '@/lib/server/printer';

export const dynamic = 'force-dynamic';

// The ESP32 sweeps its Wi-Fi for printers. Slow (10-30 s), so it's a POST
// the sidebar sends only when you press Scan.
export async function POST() {
  const result = await scanPrinters();
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
  return Response.json(result.printers);
}
