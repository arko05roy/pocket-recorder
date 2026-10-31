import { connectPrinter } from '@/lib/server/printer';

// Body: { host, port, name, queue? }. The ESP32 checks the printer answers before it's saved.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const host = typeof body?.host === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(body.host) ? body.host : null;
  const port = [9100, 631, 515].includes(Number(body?.port)) ? Number(body.port) : null;
  if (!host || !port) return Response.json({ error: 'host must be an IP address and port 9100, 631 or 515' }, { status: 400 });
  const name = typeof body?.name === 'string' ? body.name.slice(0, 80) : '';
  const queue = typeof body?.queue === 'string' && /^[\w.-]{1,127}$/.test(body.queue) ? body.queue : undefined;
  if (port === 631 && !queue) return Response.json({ error: 'This printer has no print queue name, so it can only be used on port 9100.' }, { status: 400 });
  const result = await connectPrinter({ host, port, name, queue });
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
  return Response.json({ connected: true });
}
