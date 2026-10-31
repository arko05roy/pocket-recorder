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

// Citations inside an answer as small time chips ("0:14"); the full source
// shows on hover. Back-to-back citations share one group, repeats are dropped.
// **bold** in the text is shown bold.
export function Parts({ parts }: { parts: AnswerPart[] }) {
  const out: React.ReactNode[] = [];
  let group: Citation[] = [];
  const flush = () => {
    if (!group.length) return;
    const seen = new Set<string>();
    const uniq = group.filter((c) => { const k = `${c.recording_id}@${c.start_s}`; return seen.has(k) ? false : (seen.add(k), true); });
    out.push(
      <span key={`c${out.length}`} className="cites">
        {uniq.map((c, k) => (
          <Link key={k} className="cite-mini" href={recordingHref(c.recording_id, c.start_s)} title={`${c.label} · ${fmtShortDay(c.recorded_at)} · ${fmtClock(c.start_s)}`}>
            {fmtClock(c.start_s)}
          </Link>
        ))}
      </span>,
    );
    group = [];
  };
  for (const p of parts) {
    if (p.type === 'cite') { group.push(p.cite); continue; }
    if (!p.text.trim() && group.length) continue; // spaces between two citations
    flush();
    p.text.split(/(\*\*[^*]+\*\*)/).forEach((bit) => {
      if (!bit) return;
      out.push(bit.startsWith('**') && bit.endsWith('**') ? <strong key={`b${out.length}`}>{bit.slice(2, -2)}</strong> : bit);
    });
  }
  flush();
  return <>{out}</>;
}

// Several proposals as one compact list. The same event or draft proposed
// twice shows once. Confirm one at a time, or all at once.
const proposalKey = (p: Proposal) =>
  p.kind === 'event' ? `e|${p.title.toLowerCase()}|${p.date}|${p.start_time ?? ''}`
    : p.kind === 'draft' ? `d|${p.to.toLowerCase()}|${p.subject.toLowerCase()}`
    : `p|${p.title.toLowerCase()}`;

type RowState = 'open' | 'saving' | 'saved' | 'skipped';

export function ProposalList({ proposals }: { proposals: Proposal[] }) {
  const items = [...new Map(proposals.map((p) => [proposalKey(p), p])).values()];
  const [state, setState] = useState<RowState[]>(() => items.map(() => 'open'));
  const [errors, setErrors] = useState<(string | null)[]>(() => items.map(() => null));
  const [open, setOpen] = useState<number | null>(null);
  const set = (n: number, s: RowState, e: string | null = null) => {
    setState((all) => all.map((x, k) => (k === n ? s : x)));
    setErrors((all) => all.map((x, k) => (k === n ? e : x)));
  };
  const confirm = async (n: number) => {
    const p = items[n];
    set(n, 'saving');
    const res = await fetch(p.kind === 'event' ? '/api/events' : p.kind === 'draft' ? '/api/drafts' : '/api/print', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    }).catch(() => null);
    if (res?.ok) return set(n, 'saved');
    set(n, 'open', (await res?.json().catch(() => null))?.error ?? (p.kind === 'print' ? 'Could not print.' : 'Could not save.'));
  };
  const pending = items.map((_, n) => n).filter((n) => state[n] === 'open');
  if (items.length === 1) return <ProposalCard proposal={items[0]} />;
  return (
    <div className="plist">
      <div className="plist-head">
        <span>{items.length} actions ready</span>
        <span className="plist-note">Nothing is saved or sent until you confirm</span>
        {pending.length > 1 && <button type="button" className="primary" onClick={() => pending.forEach(confirm)}>Confirm all</button>}
      </div>
      <ul>
        {items.map((p, n) => {
          const st = state[n];
          const where = p.kind === 'event' ? '/calendar' : '/drafts';
          const body = p.kind === 'event' ? null : p.body;
          return (
            <li key={n} className={`prow ${st}`}>
              <span className={`pkind ${p.kind}`} aria-hidden="true">{p.kind === 'event' ? <CalIcon /> : p.kind === 'draft' ? <MailIcon /> : <PrintIcon />}</span>
              <button type="button" className="pmain" onClick={() => setOpen(open === n ? null : n)} aria-expanded={open === n} disabled={!body}>
                <span className="ptitle">{p.kind === 'draft' ? p.subject : p.title}</span>
                <span className="pmeta">
                  {p.kind === 'event'
                    ? <>{fmtDate(p.date)}{p.start_time ? ` · ${p.start_time}${p.end_time ? `–${p.end_time}` : ''}` : ' · no time set'}{p.attendees.length > 0 && ` · ${p.attendees.join(', ')}`}</>
                    : p.kind === 'draft' ? <>Email draft to {p.to}</> : <>Print</>}
                </span>
                {open === n && body && <span className="pbody">{body}</span>}
                {errors[n] && <span className="p-error">{errors[n]}</span>}
              </button>
              <span className="pact">
                {st === 'saved' ? (p.kind === 'print' ? <span className="p-done">Printed</span> : <Link href={where} className="p-done">Saved ›</Link>)
                  : st === 'skipped' ? <button type="button" className="plink" onClick={() => set(n, 'open')}>Undo</button>
                  : <>
                      <button type="button" className="plink" onClick={() => set(n, 'skipped')} disabled={st === 'saving'}>Skip</button>
                      <button type="button" className="primary" onClick={() => confirm(n)} disabled={st === 'saving'}>
                        {st === 'saving' ? 'Saving…' : p.kind === 'print' ? 'Print' : 'Confirm'}
                      </button>
                    </>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const Ico = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const CalIcon = () => <Ico d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />;
const MailIcon = () => <Ico d="M4 6h16v12H4zM4 7l8 6 8-6" />;
const PrintIcon = () => <Ico d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />;
