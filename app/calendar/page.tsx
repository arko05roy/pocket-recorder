import type { Metadata } from 'next';
import Link from 'next/link';
import { listEvents } from '@/lib/server/db';
import { CalendarView } from '@/components/CalendarView';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

export default function CalendarPage() {
  const events = listEvents();
  return (
    <div className="doc doc-wide">
      <Link href="/recordings" className="back">‹ All recordings</Link>
      <h1>Calendar</h1>
      {events.length === 0 && <p className="none">No events yet. Ask to add a meeting from a recording, then confirm it.</p>}
      <CalendarView events={events} />
    </div>
  );
}
