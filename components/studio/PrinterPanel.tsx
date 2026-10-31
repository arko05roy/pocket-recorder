'use client';

import { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import type { DeviceEvent, FoundPrinter, SavedPrinter } from '@/lib/types';

// Sidebar section for the ESP32 print bridge: is it plugged in, which printer
// it prints to, and a scan that lists the printers it can see with Connect.
export default function PrinterPanel() {
  const [bridge, setBridge] = useState<DeviceEvent | null>(null);
  const [printer, setPrinter] = useState<SavedPrinter | null>(null);
  const [found, setFound] = useState<FoundPrinter[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/printers').catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!body) return;
    setBridge(body.bridge);
    setPrinter(body.printer);
  }, []);

  // The bridge says hello every 30 s; the server also pushes plug/unplug as a
  // 'device' event on the live stream, so refresh on that and on a slow timer.
  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    const source = new EventSource('/api/stream');
    source.addEventListener('device', load);
    return () => { clearInterval(timer); source.close(); };
  }, [load]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    const res = await fetch('/api/printers/scan', { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setScanning(false);
    if (!res?.ok) return setError(body?.error ?? 'Scan failed.');
    setFound(body);
  };

  const connect = async (p: FoundPrinter) => {
    const port = p.queue && p.ports.includes(631) ? 631 : 9100;
    const key = `${p.ip}:${port}`;
    setConnecting(key);
    setError(null);
    const res = await fetch('/api/printers/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: p.ip, port, name: p.name, queue: p.queue || undefined }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setConnecting(null);
    if (!res?.ok) return setError(body?.error ?? 'Could not connect.');
    load();
  };

  const isCurrent = (p: FoundPrinter) =>
    printer?.host === p.ip && (!p.queue || printer.queue === p.queue);

  return (
    <div className="printers">
      <div className="rail-label">Printers</div>
      <div className={`pr-bridge ${bridge ? 'on' : 'off'}`}>
        <span className="pr-dot" aria-hidden="true" />
        {bridge ? <>ESP32 connected <span className="pr-faint">· {bridge.ip}</span></> : 'ESP32 not connected'}
      </div>
      {printer && (
        <div className="pr-current">
          <Printer size={14} />
          <span>{printer.name || printer.queue?.replace(/_/g, ' ') || printer.host}</span>
        </div>
      )}
      {bridge && (
        <button type="button" className="pr-scan" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning the Wi-Fi… (~25 s)' : 'Scan for printers'}
        </button>
      )}
      {found && !found.length && <p className="rail-empty">No printers found on this Wi-Fi.</p>}
      {found?.map((p) => {
        const port = p.queue && p.ports.includes(631) ? 631 : 9100;
        const usable = port === 631 || p.ports.includes(9100);
        const busy = connecting === `${p.ip}:${port}`;
        return (
          <div key={`${p.ip}-${p.queue}`} className="pr-row">
            <div className="pr-name">
              <span>{p.name || p.ip}</span>
              <span className="pr-faint">{p.ip}{p.queue ? ' · shared by a computer' : ''}</span>
            </div>
            {isCurrent(p) ? <span className="pr-done">Connected</span>
              : usable ? (
                <button type="button" onClick={() => connect(p)} disabled={!!connecting}>{busy ? 'Connecting…' : 'Connect'}</button>
              ) : <span className="pr-faint">Not supported</span>}
          </div>
        );
      })}
      {error && <p className="rail-fail" role="alert">{error}</p>}
    </div>
  );
}
