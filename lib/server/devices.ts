import type { DeviceEvent } from '../types';
import { publishDevice } from './live';

// A device that hasn't been heard from for this long counts as gone.
const STALE_MS = 90_000;

interface Seen { lastSeen: number; battery_pct: number | null; rssi: number | null; kind: DeviceEvent['kind']; ip: string | null }

// On globalThis so the hello route, the upload route and the timer share it.
const g = globalThis as unknown as { __devices?: Map<string, Seen>; __deviceTimer?: ReturnType<typeof setInterval> };
const devices = (g.__devices ??= new Map());

// Every 15 s, announce devices whose heartbeat stopped.
g.__deviceTimer ??= setInterval(() => {
  const now = Date.now();
  for (const [device_id, d] of devices) {
    if (now - d.lastSeen > STALE_MS) {
      devices.delete(device_id);
      publishDevice({ device_id, event: 'disconnected', battery_pct: d.battery_pct, rssi: d.rssi, kind: d.kind, ip: d.ip });
    }
  }
}, 15_000);

// A hello, heartbeat or upload from a device. Announces it only when it is
// new (or back after going quiet), so heartbeats don't pop up every 30 s.
export function deviceSeen(
  device_id: string, battery_pct: number | null = null, rssi: number | null = null,
  kind: DeviceEvent['kind'] = 'mic', ip: string | null = null,
) {
  const known = devices.get(device_id);
  const seen: Seen = {
    lastSeen: Date.now(),
    battery_pct: battery_pct ?? known?.battery_pct ?? null,
    rssi: rssi ?? known?.rssi ?? null,
    kind: known && kind === 'mic' ? known.kind : kind,
    ip: ip ?? known?.ip ?? null,
  };
  devices.set(device_id, seen);
  if (!known) publishDevice({ device_id, event: 'connected', battery_pct, rssi, kind: seen.kind, ip: seen.ip });
  return !known;
}

export const onlineDevices = (): DeviceEvent[] =>
  [...devices].map(([device_id, d]) => ({ device_id, event: 'connected', battery_pct: d.battery_pct, rssi: d.rssi, kind: d.kind, ip: d.ip }));

// The print bridge that's online right now, if any.
export const printBridge = () => onlineDevices().find((d) => d.kind === 'printer' && d.ip) ?? null;
