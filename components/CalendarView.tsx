'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import formaTheme from '@fullcalendar/react/themes/forma';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/forma/theme.css';
import '@fullcalendar/react/themes/forma/palettes/blue.css';
import { useMemo, useState } from 'react';
import type { CalendarEvent } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Cite } from './Answer';
import { DeleteButton } from './SavedActions';

// Google-Calendar-like colours, one per recording, so events from the same
// conversation share a colour.
const COLORS = ['#1a73e8', '#0b8043', '#d50000', '#f4511e', '#8e24aa', '#039be5', '#e67c73', '#33b679'];
const colorFor = (key: string) => {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
};

// An event with a start but no end is shown as one hour long.
const plusHour = (t: string) => `${String(Math.min(23, Number(t.slice(0, 2)) + 1)).padStart(2, '0')}:${t.slice(3)}`;

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  const input = useMemo(() => events.map((e) => ({
    id: String(e.id),
    title: e.title,
    start: e.start_time ? `${e.date}T${e.start_time}` : e.date,
    end: e.start_time ? `${e.date}T${e.end_time ?? plusHour(e.start_time)}` : undefined,
    allDay: !e.start_time,
    color: colorFor(e.source.recording_id),
  })), [events]);

  return (
    <div className="cal">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, formaTheme]}
        initialView="dayGridMonth"
        headerToolbar={{ start: 'today prev,next title', end: 'dayGridMonth,timeGridWeek,timeGridDay' }}
        firstDay={1}
        nowIndicator
        dayMaxEvents
        height="auto"
        events={input}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
          setSelected(events.find((e) => String(e.id) === info.event.id) ?? null);
        }}
        dateClick={() => setSelected(null)}
      />
      {selected && (
        <div className="saved cal-detail" style={{ borderLeftColor: colorFor(selected.source.recording_id) }}>
          <span className="when">
            {selected.start_time ? `${selected.start_time}${selected.end_time ? `–${selected.end_time}` : ''}` : 'All day'}
          </span>
          <div>
            <div className="p-title">{selected.title}</div>
            <div className="p-meta">{fmtDate(selected.date)}{selected.attendees.length > 0 && ` · ${selected.attendees.join(', ')}`}</div>
            <div className="p-foot">
              <Cite cite={selected.source} />
              <DeleteButton url={`/api/events/${selected.id}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
