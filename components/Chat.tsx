'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Answer, AnswerPart } from '@/lib/types';
import { fmtClock, fmtShortDay, recordingHref } from '@/lib/format';

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
            : <p key={i} className="a"><Parts parts={t.answer.parts} /></p>,
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

function Parts({ parts }: { parts: AnswerPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'text' ? p.text : (
          <Link key={i} className="cite" href={recordingHref(p.cite.recording_id, p.cite.start_s)}>
            {p.cite.label} · {fmtShortDay(p.cite.recorded_at)} · {fmtClock(p.cite.start_s)}
          </Link>
        ),
      )}
    </>
  );
}
