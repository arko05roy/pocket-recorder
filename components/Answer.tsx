'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AnswerPart, Citation, Proposal } from '@/lib/types';
import { fmtClock, fmtDate, fmtShortDay, recordingHref } from '@/lib/format';

// Nothing is written until Confirm. The server checks the proposal again on save.
export function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const [state, setState] = useState<'open' | 'saving' | 'saved' | 'cancelled'>('open');
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setState('saving');
    setError(null);
    const res = await fetch(p.kind === 'event' ? '/api/events' : p.kind === 'draft' ? '/api/drafts' : '/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).catch(() => null);
    if (res?.ok) return setState('saved');
    setError((await res?.json().catch(() => null))?.error ?? (p.kind === 'print' ? 'Could not print.' : 'Could not save.'));
    setState('open');
  };
  const where = p.kind === 'event' ? '/calendar' : '/drafts';
  const label = { event: 'New calendar event', draft: 'New email draft (not sent)', print: 'Print on office printer' }[p.kind];
  return (
    <div className={`proposal ${state}`}>
      <div className="kind">{label}</div>
      {p.kind === 'event' ? (
        <>
          <div className="p-title">{p.title}</div>
          <div className="p-meta">
            {fmtDate(p.date)}{p.start_time ? `, ${p.start_time}${p.end_time ? `–${p.end_time}` : ''}` : ' · all day'}
            {p.attendees.length > 0 && ` · ${p.attendees.join(', ')}`}
          </div>
        </>
      ) : p.kind === 'print' ? (
        <>
          <div className="p-title">{p.title}</div>
          <p className="p-body">{p.body}</p>
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
        {state === 'saved' ? (p.kind === 'print' ? <span className="p-done">Sent to printer</span> : <Link href={where} className="p-done">Saved · view</Link>)
          : state === 'cancelled' ? <span className="p-done">Cancelled</span>
          : (
            <span className="p-actions">
              <button type="button" onClick={() => setState('cancelled')} disabled={state === 'saving'}>Cancel</button>
              <button type="button" className="primary" onClick={confirm} disabled={state === 'saving'}>
                {state === 'saving' ? (p.kind === 'print' ? 'Printing…' : 'Saving…') : p.kind === 'print' ? 'Print' : 'Confirm'}
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

export function Parts({ parts }: { parts: AnswerPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'text' ? p.text : <Cite key={i} cite={p.cite} />,
      )}
    </>
  );
}
