'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Answer, AnswerPart, Citation, Proposal } from '@/lib/types';
import { fmtClock, fmtDate, fmtShortDay, recordingHref } from '@/lib/format';

type Turn = { role: 'user'; content: string } | { role: 'assistant'; answer: Answer } | { role: 'error'; content: string };

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns, busy]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    // History for the model: questions plus its raw replies (with citation markers).
    const messages = next.flatMap((t) =>
      t.role === 'user' ? [{ role: 'user', content: t.content }]
        : t.role === 'assistant' ? [{ role: 'assistant', content: t.answer.raw }] : [],
    );
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const body = await res.json();
      setTurns([...next, res.ok ? { role: 'assistant', answer: body } : { role: 'error', content: body.error ?? 'Something went wrong.' }]);
    } catch {
      setTurns([...next, { role: 'error', content: 'Could not reach the server.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="doc chat">
      <Link href="/" className="back">‹ All recordings</Link>
      <h1>Ask</h1>
      {!turns.length && (
        <p className="none">Ask about anything said in your recordings. Answers link to the moment they come from.</p>
      )}
      <div className="turns">
        {turns.map((t, i) =>
          t.role === 'user' ? <p key={i} className="q">{t.content}</p>
            : t.role === 'error' ? <p key={i} className="a error">{t.content}</p>
            : (
              <div key={i} className="a-wrap">
                <p className="a"><Parts parts={t.answer.parts} /></p>
                {t.answer.proposals.map((p, n) => <ProposalCard key={n} proposal={p} />)}
              </div>
            ),
        )}
        {busy && <p className="a pending">Looking through the recordings…</p>}
        <div ref={end} />
      </div>
      <form className="ask" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What did I agree to do this week?"
          aria-label="Question"
          autoFocus
        />
        <button type="submit" disabled={busy || !draft.trim()}>Ask</button>
      </form>
    </div>
  );
}

// Nothing is written until Confirm. The server checks the proposal again on save.
function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const [state, setState] = useState<'open' | 'saving' | 'saved' | 'cancelled'>('open');
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setState('saving');
    setError(null);
    const res = await fetch(p.kind === 'event' ? '/api/events' : '/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).catch(() => null);
    if (res?.ok) return setState('saved');
    setError((await res?.json().catch(() => null))?.error ?? 'Could not save.');
    setState('open');
  };
  const where = p.kind === 'event' ? '/calendar' : '/drafts';
  return (
    <div className={`proposal ${state}`}>
      <div className="kind">{p.kind === 'event' ? 'New calendar event' : 'New email draft (not sent)'}</div>
      {p.kind === 'event' ? (
        <>
          <div className="p-title">{p.title}</div>
          <div className="p-meta">
            {fmtDate(p.date)}{p.start_time ? `, ${p.start_time}${p.end_time ? `–${p.end_time}` : ''}` : ' · all day'}
            {p.attendees.length > 0 && ` · ${p.attendees.join(', ')}`}
          </div>
        </>
      ) : (
        <>
          <div className="p-meta">To {p.to}</div>
          <div className="p-title">{p.subject}</div>
          <p className="p-body">{p.body}</p>
        </>
      )}
      <div className="p-foot">
        <Cite cite={p.source} />
        {state === 'saved' ? <Link href={where} className="p-done">Saved · view</Link>
          : state === 'cancelled' ? <span className="p-done">Cancelled</span>
          : (
            <span className="p-actions">
              <button type="button" onClick={() => setState('cancelled')} disabled={state === 'saving'}>Cancel</button>
              <button type="button" className="primary" onClick={confirm} disabled={state === 'saving'}>
                {state === 'saving' ? 'Saving…' : 'Confirm'}
              </button>
            </span>
          )}
      </div>
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}

export function Cite({ cite }: { cite: Citation }) {
  return (
    <Link className="cite" href={recordingHref(cite.recording_id, cite.start_s)}>
      {cite.label} · {fmtShortDay(cite.recorded_at)} · {fmtClock(cite.start_s)}
    </Link>
  );
}

function Parts({ parts }: { parts: AnswerPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'text' ? p.text : <Cite key={i} cite={p.cite} />,
      )}
    </>
  );
}
