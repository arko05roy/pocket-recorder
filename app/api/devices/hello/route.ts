import { deviceSeen } from '@/lib/server/devices';

// POST from the recorder when it joins Wi-Fi, then every 30 s as a heartbeat.
// JSON or form fields: device_id (required), battery_pct, rssi (both optional).
export async function POST(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  const body: Record<string, unknown> = type.includes('json')
    ? await request.json().catch(() => ({}))
    : Object.fromEntries(await request.formData().catch(() => new FormData()));
  const device_id = body.device_id;
  if (typeof device_id !== 'string' || !/^[\w-]{1,64}$/.test(device_id)) {
    return Response.json({ error: 'invalid device_id' }, { status: 400 });
  }
  const num = (v: unknown, lo: number, hi: number) => {
    const n = v === '' || v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
  };
  const isNew = deviceSeen(device_id, num(body.battery_pct, 0, 100), num(body.rssi, -120, 0));
  return Response.json({ ok: true, announced: isNew });
}
