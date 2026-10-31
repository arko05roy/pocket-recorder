import type { Metadata } from 'next';
import Link from 'next/link';
import { listEvents } from '@/lib/server/db';
import { fmtDate } from '@/lib/format';
import { Cite } from '@/components/Answer';
import { DeleteButton } from '@/components/SavedActions';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

export default function CalendarPage() {
  const events = listEvents();
  const rows: React.ReactNode[] = [];
  let day = '';
  for (const e of events) {
    if (e.date !== day) {
      day = e.date;
      rows.push(<h2 key={`d-${day}`} className="section">{fmtDate(day)}</h2>);
    }
    rows.push(
      <div key={e.id} className="saved">
        <span className="when">{e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ''}` : 'All day'}</span>
        <div>
          <div className="p-title">{e.title}</div>
          {e.attendees.length > 0 && <div className="p-meta">{e.attendees.join(', ')}</div>}
          <div className="p-foot"><Cite cite={e.source} /><DeleteButton url={`/api/events/${e.id}`} /></div>
        </div>
      </div>,
    );
  }
  return (
    <div className="doc">
      <Link href="/recordings" className="back">‹ All recordings</Link>
      <h1>Calendar</h1>
      {rows.length ? rows : <p className="none">No events yet. Ask to add a meeting from a recording, then confirm it.</p>}
    </div>
  );
}
