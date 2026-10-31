'use client';

import { usePathname } from 'next/navigation';
import type { RecordingSummary } from '@/lib/types';
import Sidebar from './Sidebar';

// On a phone only one pane fits: the list on "/", any other page full screen.
export default function Shell({ recordings, children }: { recordings: RecordingSummary[]; children: React.ReactNode }) {
  const path = usePathname();
  const reading = path !== '/';
  return (
    <div className={`app${reading ? ' reading' : ''}`}>
      <Sidebar recordings={recordings} />
      <main className="page">{children}</main>
    </div>
  );
}
