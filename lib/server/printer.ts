import type { FoundPrinter, SavedPrinter } from '../types';
import { getSetting, setSetting } from './db';
import { printBridge } from './devices';

// The app never talks to a printer itself. Everything goes through the ESP32
// print bridge (firmware/printer), which says hello every 30 s with its IP.
// ESP32_URL in .env is a fallback for when the hello hasn't arrived yet.

function bridgeUrl(): string | null {
  const bridge = printBridge();
  if (bridge?.ip) return `http://${bridge.ip}`;
  return process.env.ESP32_URL || null;
}

const NO_BRIDGE = 'The ESP32 print bridge is not connected. Power it on and wait for "ESP32 printer bridge connected".';

// The printer picked with Connect in the sidebar, else PRINTER_HOST from .env.
export function savedPrinter(): SavedPrinter | null {
  const raw = getSetting('printer');
  if (raw) return JSON.parse(raw);
  const host = process.env.PRINTER_HOST;
  return host ? { host, port: Number(process.env.PRINTER_PORT ?? 9100), name: '', queue: process.env.PRINTER_QUEUE || undefined } : null;
}

// Ask the ESP32 to look for printers on its Wi-Fi. Takes 10-30 s.
export async function scanPrinters(): Promise<{ ok: true; printers: FoundPrinter[] } | { ok: false; error: string }> {
  const url = bridgeUrl();
  if (!url) return { ok: false, error: NO_BRIDGE };
  try {
    const res = await fetch(`${url}/scan`, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return { ok: false, error: `ESP32: ${(await res.text()).trim() || res.status}` };
    return { ok: true, printers: await res.json() };
  } catch (err) {
    return { ok: false, error: `Could not reach the ESP32 at ${url}: ${(err as Error).message}` };
  }
}

// Connect = the ESP32 can open the printer's port. Only then is it saved.
export async function connectPrinter(p: SavedPrinter): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = bridgeUrl();
  if (!url) return { ok: false, error: NO_BRIDGE };
  try {
    const res = await fetch(`${url}/probe?host=${encodeURIComponent(p.host)}&port=${p.port}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: (await res.text()).trim() || 'The printer did not answer.' };
  } catch (err) {
    return { ok: false, error: `Could not reach the ESP32 at ${url}: ${(err as Error).message}` };
  }
  setSetting('printer', JSON.stringify(p));
  return { ok: true };
}

export async function printViaEsp32(title: string, body: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const url = bridgeUrl();
  if (!url) return { ok: false, error: NO_BRIDGE };
  const printer = savedPrinter();
  if (!printer) return { ok: false, error: 'No printer connected. Open Printers in the sidebar, scan, and press Connect.' };
  if (printer.port === 631 && !printer.queue) return { ok: false, error: 'This printer is an IPP queue but has no queue name (PRINTER_QUEUE in .env).' };
  if (printer.port !== 9100 && printer.port !== 631) return { ok: false, error: `Printing needs port 9100 (raw) or 631 (IPP), not ${printer.port}.` };
  const text = `${title}\n${'='.repeat(Math.min(title.length, 60))}\n\n${body}\n`;
  try {
    const q = new URLSearchParams({ host: printer.host, port: String(printer.port), title });
    if (printer.queue) q.set('queue', printer.queue);
    const res = await fetch(`${url}/print?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
      signal: AbortSignal.timeout(15_000),
    });
    const reply = (await res.text()).trim();
    if (!res.ok) return { ok: false, error: `ESP32: ${reply || res.status}` };
    return { ok: true, bytes: Number(reply.match(/\d+/)?.[0] ?? text.length) };
  } catch (err) {
    return { ok: false, error: `Could not reach the ESP32 at ${url}: ${(err as Error).message}` };
  }
}
