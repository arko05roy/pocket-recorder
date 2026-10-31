'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Listens for recording changes and re-renders the server components (sidebar
// and current page) with fresh data. EventSource reconnects by itself.
export default function LiveUpdates() {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource('/api/stream');
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A burst of changes (a seed run, a device emptying its queue) becomes one refresh.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    // After a reconnect, changes made while disconnected were never sent; catch up once.
    let dropped = false;
    source.onerror = () => { dropped = true; };
    source.onopen = () => {
      if (dropped) refresh();
      dropped = false;
    };
    source.onmessage = refresh;
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [router]);
  return null;
}
