'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ActionItem, RecordingDetail } from '@/lib/types';
import { STATUS, fmtClock, fmtDate, fmtShortDay, fmtTime, hasTranscript, isPending } from '@/lib/format';
import Player, { type PlayerHandle } from './Player';

export default function RecordingView({ rec }: { rec: RecordingDetail }) {
  const router = useRouter();
  const search = useSearchParams();
  const player = useRef<PlayerHandle>(null);
  const [now, setNow] = useState(0);

  // While the pipeline is still working, re-run the server components every
  // 3 s. router.refresh() fetches fresh props for this page and the sidebar.
  useEffect(() => {
    if (!isPending(rec.status)) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [rec.status, router]);

  // ?t=41&seg=5 from a search result: jump there and highlight the line.
  const t = search.get('t');
  const found = search.get('seg') != null ? Number(search.get('seg')) : null;
  useEffect(() => {
    if (t == null) return;
    player.current?.seek(Number(t));
    const line = document.querySelector(`.seg[data-idx="${found ?? activeIdx(rec, Number(t))}"]`);
    line?.scrollIntoView({ block: 'center' });
  }, [t, found, rec]);

  const playFrom = (s: number) => {
    player.current?.seek(s);
    player.current?.play();
  };

  const active = activeIdx(rec, now);
  const battery = rec.battery_pct == null ? 'USB power' : `${rec.battery_pct}%`;

  return (
    <article className="doc">
      <Link href="/" className="back">‹ All recordings</Link>
      <h1>{rec.title ?? `${fmtShortDay(rec.recorded_at)}, ${fmtTime(rec.recorded_at)}`}</h1>
      <dl className="props">
        <dt>Recorded</dt><dd className="mono">{rec.recorded_at}</dd>
        <dt>Device</dt><dd>{rec.device_id}</dd>
        <dt>Length</dt><dd className="mono">{fmtClock((rec.duration_ms ?? 0) / 1000)}</dd>
        <dt>Battery</dt><dd>{battery}</dd>
        <dt>Status</dt><dd><span className={`pill${rec.status === 'error' ? ' error' : ''}`}>{STATUS[rec.status]}</span></dd>
      </dl>

      <Analysis rec={rec} playFrom={playFrom} />

      <h2 className="section">Transcript</h2>
      <Player ref={player} rec={rec} onTime={setNow} />
      <Transcript rec={rec} active={active} found={found} playFrom={playFrom} />
    </article>
  );
}

// The last segment that started at or before time t.
function activeIdx(rec: RecordingDetail, t: number) {
  let idx: number | null = null;
  for (const s of rec.segments) if (s.start_s <= t + 0.05) idx = s.idx;
  return idx;
}

function Transcript({ rec, active, found, playFrom }: {
  rec: RecordingDetail; active: number | null; found: number | null; playFrom: (s: number) => void;
}) {
  if (rec.status === 'error') {
    return (
      <div className="empty">
        <p>Transcription failed: {rec.error ?? 'unknown error'}</p>
        <p>Restart the server to try again.</p>
      </div>
    );
  }
  if (!hasTranscript(rec.status)) {
    return <div className="empty"><p>{STATUS[rec.status]}… The transcript will appear here when it’s done.</p></div>;
  }
  if (!rec.segments.length) return <div className="empty"><p>No speech detected in this recording.</p></div>;
  return (
    <div className="transcript">
      {rec.segments.map((s) => (
        <FollowLine key={s.idx} active={s.idx === active}>
          <button
            type="button"
            data-idx={s.idx}
            className={`seg${s.idx === active ? ' now' : ''}${s.idx === found ? ' found' : ''}`}
            onClick={() => playFrom(s.start_s)}
          >
            <span className="ts">{fmtClock(s.start_s)}</span>
            <span>{s.text}</span>
          </button>
        </FollowLine>
      ))}
    </div>
  );
}

// Scroll the playing line back into view, but only when it has left the screen.
function FollowLine({ active, children }: { active: boolean; children: React.ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const audio = document.querySelector('audio');
    if (!audio || audio.paused) return;
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);
  return <div ref={ref}>{children}</div>;
}

function At({ s, playFrom }: { s: number; playFrom: (s: number) => void }) {
  return (
    <button className="at" type="button" onClick={() => playFrom(s)} aria-label={`Play from ${fmtClock(s)}`}>
      {fmtClock(s)}
    </button>
  );
}

// A resolved date wins; otherwise show the words that were said ("next week").
function when(date: string | null, text: string | null, time: string | null = null) {
  if (date) return fmtDate(date) + (time ? `, ${time}` : '');
  return text ?? '';
}

function Analysis({ rec, playFrom }: { rec: RecordingDetail; playFrom: (s: number) => void }) {
  if (rec.status === 'analysing' || rec.status === 'transcribed') {
    return <p className="summary pending">Writing the summary and pulling out action items…</p>;
  }
  if (rec.status !== 'ready' || !rec.segments.length) return null;

  const meetings = rec.mentions.filter((m) => m.kind === 'meeting' || m.kind === 'date');
  const people = rec.mentions.filter((m) => m.kind === 'person');

  return (
    <>
      {rec.summary && <p className="summary">{rec.summary}</p>}

      <h2 className="section">Action items</h2>
      {rec.action_items.length ? (
        <ul className="todos">
          {rec.action_items.map((i) => <Todo key={i.id} item={i} playFrom={playFrom} />)}
        </ul>
      ) : <p className="none">No action items.</p>}

      <h2 className="section">Meetings and dates</h2>
      {meetings.length ? (
        <ul className="rows">
          {meetings.map((m, n) => (
            <li key={n}>
              <span className="when">{when(m.date, m.detail, m.time) || '—'}</span>
              <span>{m.value}{m.kind === 'meeting' && <span className="tag">meeting</span>}</span>
              <At s={m.source_s} playFrom={playFrom} />
            </li>
          ))}
        </ul>
      ) : <p className="none">No meetings or dates mentioned.</p>}

      <h2 className="section">People</h2>
      {people.length ? (
        <div className="people">
          {people.map((p, n) => (
            <button key={n} className="person" type="button" onClick={() => playFrom(p.source_s)}>
              {p.value}{p.detail && <span>{p.detail}</span>}
            </button>
          ))}
        </div>
      ) : <p className="none">No people mentioned.</p>}
    </>
  );
}

// Ticks immediately, then saves. If the save fails, the tick is undone so the
// screen never shows something the database doesn't have.
function Todo({ item, playFrom }: { item: ActionItem; playFrom: (s: number) => void }) {
  const [done, setDone] = useState(item.status === 'done');
  const toggle = async (next: boolean) => {
    setDone(next);
    const res = await fetch(`/api/action-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next ? 'done' : 'open' }),
    }).catch(() => null);
    if (!res?.ok) setDone(!next);
  };
  const meta = [item.who, when(item.due_date, item.due_text)].filter(Boolean);
  return (
    <li className={done ? 'done' : undefined}>
      <input type="checkbox" checked={done} onChange={(e) => toggle(e.target.checked)} aria-label="Mark done" />
      <div>
        <span className="what">{item.what}</span>
        {meta.length > 0 && (
          <span className="meta">
            {item.who && <b>{item.who}</b>}
            {item.who && meta.length > 1 && ' · '}
            {when(item.due_date, item.due_text)}
          </span>
        )}
      </div>
      <At s={item.source_s} playFrom={playFrom} />
    </li>
  );
}
