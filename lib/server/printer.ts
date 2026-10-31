// The app never talks to the printer itself. It hands the page to the ESP32.
//  - firmware/usbprinter: the printer is plugged into the ESP32 over USB (no PRINTER_HOST needed)
//  - firmware/printer: the ESP32 forwards to a network printer at PRINTER_HOST:9100

const ESP32_URL = () => process.env.ESP32_URL ?? 'http://esp-printer.local';

export async function printViaEsp32(title: string, body: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const host = process.env.PRINTER_HOST;
  const port = process.env.PRINTER_PORT ?? '9100';
  const text = `${title}\n${'='.repeat(Math.min(title.length, 60))}\n\n${body}\n`;
  const url = `${ESP32_URL()}/print` + (host ? `?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}` : '');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
      signal: AbortSignal.timeout(15_000),
    });
    const reply = (await res.text()).trim();
    if (!res.ok) return { ok: false, error: `ESP32: ${reply || res.status}` };
    return { ok: true, bytes: Number(reply.match(/\d+/)?.[0] ?? text.length) };
  } catch (err) {
    return { ok: false, error: `Could not reach the ESP32 at ${ESP32_URL()}: ${(err as Error).message}` };
  }
}
