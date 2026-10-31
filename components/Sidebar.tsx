'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { RecordingSummary, SearchHit } from '@/lib/types';
import { STATUS, fmtClock, fmtDay, fmtShortDay, fmtTime, isPending, recordingHref } from '@/lib/format';

export default function Sidebar({ recordings }: { recordings: RecordingSummary[] }) {
  const pathname = usePathname();
  const currentId = pathname.startsWith('/r/') ? decodeURIComponent(pathname.slice(3)) : null;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Search 150 ms after typing stops. The cleanup cancels both the timer and
  // any request still in flight, so an old reply can't overwrite a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then(setResults)
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // "/" jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA/.test((document.activeElement as HTMLElement)?.tagName ?? '');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className="sidebar">
      <label className="search">
        <span className="visually-hidden">Search transcripts</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
        <input
          ref={input}
          type="search"
          placeholder="Search transcripts"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              e.currentTarget.blur();
            }
          }}
        />
        <kbd>/</kbd>
      </label>
      <nav className="list" aria-label="Recordings">
        {results ? <Results results={results} query={query.trim()} /> : <ByDay recordings={recordings} currentId={currentId} />}
      </nav>
    </aside>
  );
}

function ByDay({ recordings, currentId }: { recordings: RecordingSummary[]; currentId: string | null }) {
  if (!recordings.length) {
    return (
      <p className="side-note">
        No recordings yet. Hold the button on the recorder, or load a folder with <code>npm run seed &lt;folder&gt;</code>.
      </p>
    );
  }
  const rows: React.ReactNode[] = [];
  let day = '';
  for (const r of recordings) {
    if (r.recorded_at.slice(0, 10) !== day) {
      day = r.recorded_at.slice(0, 10);
      rows.push(<div className="day" key={`d-${day}`}>{fmtDay(r.recorded_at)}</div>);
    }
    const sub = r.status === 'error' ? 'Transcription failed'
      : isPending(r.status) && !r.preview ? `${STATUS[r.status]}…`
      : r.preview ?? 'No speech detected';
    rows.push(
      <Link key={r.id} href={recordingHref(r.id)} className="item" aria-current={r.id === currentId ? 'page' : undefined}>
        <span className="time">{fmtTime(r.recorded_at)}</span>
        <span className="title">{r.title ?? `${r.device_id} · ${fmtClock((r.duration_ms ?? 0) / 1000)}`}</span>
        <span className="sub">{sub}</span>
      </Link>,
    );
  }
  return <>{rows}</>;
}

function Results({ results, query }: { results: SearchHit[]; query: string }) {
  if (!results.length) return <p className="side-note">No transcript mentions “{query}”.</p>;
  return (
    <>
      <div className="day">
        {results.length === 50 ? 'Top 50 matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
      </div>
      {results.map((r) => (
        <Link key={`${r.recording_id}-${r.idx}`} href={recordingHref(r.recording_id, r.start_s, r.idx)} className="item">
          <span className="time">{fmtClock(r.start_s)}</span>
          <span className="title">{fmtShortDay(r.recorded_at)}, {fmtTime(r.recorded_at)} · {r.device_id}</span>
          <span className="sub"><Snippet text={r.snippet} /></span>
        </Link>
      ))}
    </>
  );
}

// The server wraps matches in \u0002…\u0003. Split on them and render <mark>
// elements, so transcript text is never parsed as HTML.
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\u0002[^\u0003]*\u0003)/).map((part, i) =>
        part.startsWith('\u0002') ? <mark key={i}>{part.slice(1, -1)}</mark> : part,
      )}
    </>
  );
}

// Upload an audio file (transcribed like a recorder upload) or a .txt/.srt/.vtt
// transcript (straight to summary and action items). Opens like any recording.
function UploadTranscript() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'busy' | string>('idle');
  const upload = async (f: File) => {
    setState('busy');
    const form = new FormData();
    form.append('file', f);
    const res = await fetch('/api/transcripts', { method: 'POST', body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) return setState(body?.error ?? 'Upload failed');
    setState('idle');
    router.push(recordingHref(body.id));
    router.refresh();
  };
  return (
    <>
      <button type="button" className="ask-link" disabled={state === 'busy'} onClick={() => file.current?.click()}>
        {state === 'busy' ? 'Uploading…' : 'Upload audio or transcript'}
      </button>
      <input
        ref={file}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.flac,.mp4,.txt,.srt,.vtt,.md,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) upload(f);
        }}
      />
      {state !== 'idle' && state !== 'busy' && <p className="side-note" role="alert">{state}</p>}
    </>
  );
}
