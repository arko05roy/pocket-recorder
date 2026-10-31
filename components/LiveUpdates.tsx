'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { DeviceEvent } from '@/lib/types';

type Toast = DeviceEvent & { key: number };

// Listens to the server's live stream. Recording changes re-render the
// server components (lists and pages) with fresh data; a recorder joining or
// leaving shows a pop-up. EventSource reconnects by itself.
export default function LiveUpdates() {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Through a ref: as an effect dependency, router changes on every refresh
  // and would close and reopen the stream each time.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const source = new EventSource('/api/stream');
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A burst of changes (a seed run, a device emptying its queue) becomes one refresh.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => routerRef.current.refresh(), 250);
    };
    // After a reconnect, changes made while disconnected were never sent; catch up once.
    let dropped = false;
    source.onerror = () => { dropped = true; };
    source.onopen = () => {
      if (dropped) refresh();
      dropped = false;
    };
    source.onmessage = refresh;
    source.addEventListener('device', (e) => {
      const toast: Toast = { ...JSON.parse((e as MessageEvent).data), key: Date.now() + Math.random() };
      setToasts((all) => [...all.filter((t) => t.device_id !== toast.device_id), toast].slice(-3));
      setTimeout(() => setToasts((all) => all.filter((t) => t.key !== toast.key)), toast.event === 'connected' ? 6000 : 4000);
    });
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, []);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`toast ${t.event}`}>
          <span className="toast-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
          </span>
          <div className="toast-text">
            <b>ESP32 {t.kind === 'printer' ? 'printer bridge' : 'mic'} {t.event === 'connected' ? 'connected' : 'disconnected'}</b>
            <span>
              {t.device_id}
              {t.event === 'connected' && t.ip && ` · ${t.ip}`}
              {t.event === 'connected' && t.battery_pct != null && ` · ${t.battery_pct}% battery`}
              {t.event === 'connected' && t.rssi != null && ` · ${signal(t.rssi)} signal`}
              {t.event === 'disconnected' && ' · no heartbeat for 90 s'}
            </span>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.key !== t.key))}>×</button>
        </div>
      ))}
    </div>
  );
}

const signal = (dbm: number) => (dbm >= -60 ? 'strong' : dbm >= -72 ? 'good' : 'weak');
