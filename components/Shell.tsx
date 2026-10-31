'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RecordingSummary } from '@/lib/types';
import AppRail from './studio/AppRail';
import LiveUpdates from './LiveUpdates';
import Sidebar from './Sidebar';

// One frame for every page: the rail on the left, then the page. Recordings
// add their searchable list between the two. On a phone the rail becomes a
// top bar and only one of list or recording shows at a time.
export default function Shell({ recordings, chats, children }: {
  recordings: RecordingSummary[];
  chats: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const withList = path === '/recordings' || path.startsWith('/r/');
  // Remembered per browser. Read after mount so server and browser render the
  // same first frame.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('rail-collapsed') === '1'); } catch {}
  }, []);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem('rail-collapsed', c ? '0' : '1'); } catch {}
    return !c;
  });
  return (
    <div className={`shell${withList ? ' with-list' : ''}${path.startsWith('/r/') ? ' reading' : ''}${collapsed ? ' rail-collapsed' : ''}`}>
      <LiveUpdates />
      <AppRail chats={chats} collapsed={collapsed} onToggle={toggle} />
      {withList && <Sidebar recordings={recordings} />}
      <main className="page">{children}</main>
    </div>
  );
}
