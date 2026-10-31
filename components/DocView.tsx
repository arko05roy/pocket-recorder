'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Plus, Printer, Trash2 } from 'lucide-react';
import type { Doc, DocSection } from '@/lib/types';
import { Cite } from './Answer';

// The document as it appears in chat: title and the outline of headings.
export function DocCard({ doc }: { doc: Doc }) {
  return (
    <div className="doc-card">
      <div className="kind"><FileText size={13} /> Document · draft</div>
      <div className="p-title">{doc.title}</div>
      <ol className="doc-outline">
        {doc.sections.map((s, i) => <li key={i}>{s.heading}</li>)}
      </ol>
      <div className="p-foot">
        <span className="pr-faint">{doc.sections.length} section{doc.sections.length === 1 ? '' : 's'}</span>
        <Link href={`/docs/${doc.id}`} className="doc-open">Open in Docs ›</Link>
      </div>
    </div>
  );
}

// The full document on /docs/[id]: everything is editable in place and saves
// itself shortly after you stop typing. Finalize & print saves first.
export function DocPage({ doc }: { doc: Doc }) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [sections, setSections] = useState<DocSection[]>(doc.sections);
  const [status, setStatus] = useState<Doc['status']>(doc.status);
  const [save, setSave] = useState<'saved' | 'unsaved' | 'saving' | 'failed'>('saved');
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title, sections });
  latest.current = { title, sections };

  const persist = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { title, sections } = latest.current;
    if (!title.trim()) { setSave('failed'); setError('The doc needs a title.'); return false; }
    setSave('saving');
    const res = await fetch(`/api/docs/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, sections }),
    }).catch(() => null);
    if (!res?.ok) {
      setSave('failed');
      setError((await res?.json().catch(() => null))?.error ?? 'Could not save your changes.');
      return false;
    }
    // Only mark saved if nothing changed while the request was in flight.
    if (latest.current.title === title && latest.current.sections === sections) setSave('saved');
    setError(null);
    setStatus('draft');
    return true;
  }, [doc.id]);

  // Save 800 ms after the last keystroke, and before leaving the page.
  const changed = (next: { title?: string; sections?: DocSection[] }) => {
    if (next.title !== undefined) setTitle(next.title);
    if (next.sections) setSections(next.sections);
    setSave('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 800);
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (timer.current) { persist(); e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [persist]);

  const setSection = (i: number, patch: Partial<DocSection>) =>
    changed({ sections: sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const addSection = (at: number) =>
    changed({ sections: [...sections.slice(0, at), { heading: 'New section', body: '' }, ...sections.slice(at)] });
  const removeSection = (i: number) => changed({ sections: sections.filter((_, k) => k !== i) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    changed({ sections: next });
  };

  const print = async () => {
    setPrinting(true);
    setError(null);
    if (save !== 'saved' && !(await persist())) { setPrinting(false); return; }
    const res = await fetch(`/api/docs/${doc.id}/print`, { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setPrinting(false);
    if (!res?.ok) { setError(body?.error ?? 'Could not print.'); return; }
    setStatus('printed');
    router.refresh();
  };

  const remove = async () => {
    if (timer.current) clearTimeout(timer.current);
    const res = await fetch(`/api/docs/${doc.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) { setError('Could not delete.'); setAsking(false); return; }
    router.push('/docs');
    router.refresh();
  };

  const saveLabel = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', failed: 'Not saved' }[save];

  return (
    <article className="docpage">
      <header className="docpage-head">
        <div className="docpage-state">
          <span className={`doc-status ${status}`}>{status === 'printed' ? 'Printed' : 'Draft'}</span>
          <span className={`doc-save ${save}`} aria-live="polite">{saveLabel}</span>
        </div>
        <div className="docpage-actions">
          {asking ? (
            <span className="confirm-panel" onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false); }}>
              <span>Delete this document?</span>
              <div>
                <button type="button" className="confirm-yes" onClick={remove}>Delete</button>
                <button type="button" autoFocus onClick={() => setAsking(false)}>Cancel</button>
              </div>
            </span>
          ) : (
            <button type="button" className="doc-del" onClick={() => setAsking(true)}>Delete</button>
          )}
          <button type="button" className="doc-print" onClick={print} disabled={printing || save === 'saving'}>
            <Printer size={15} />
            {printing ? 'Printing…' : status === 'printed' ? 'Print again' : 'Finalize & print'}
          </button>
        </div>
      </header>
      {error && <p className="p-error" role="alert">{error}</p>}

      <Grow
        className="doc-title"
        value={title}
        onChange={(v) => changed({ title: v.replace(/\n/g, ' ') })}
        placeholder="Title"
        aria-label="Document title"
      />

      {sections.map((s, i) => (
        <section key={i} className="doc-sec">
          <div className="doc-sec-tools">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move section up" title="Move up"><ArrowUp size={14} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="Move section down" title="Move down"><ArrowDown size={14} /></button>
            <button type="button" className="danger" onClick={() => removeSection(i)} aria-label={`Remove section “${s.heading}”`} title="Remove section"><Trash2 size={14} /></button>
          </div>
          <Grow
            className="doc-h2"
            value={s.heading}
            onChange={(v) => setSection(i, { heading: v.replace(/\n/g, ' ') })}
            placeholder="Heading"
            aria-label={`Heading of section ${i + 1}`}
          />
          <Grow
            className="doc-body"
            value={s.body}
            onChange={(v) => setSection(i, { body: v })}
            placeholder="Write here. Start a line with “- ” for a bullet point."
            aria-label={`Text of section ${i + 1}`}
          />
          <button type="button" className="doc-add" onClick={() => addSection(i + 1)}><Plus size={13} /> Add section</button>
        </section>
      ))}
      {!sections.length && <button type="button" className="doc-add" onClick={() => addSection(0)}><Plus size={13} /> Add section</button>}

      {doc.sources.length > 0 && (
        <footer className="doc-sources">
          <span>From</span>
          {doc.sources.map((c, i) => <Cite key={i} cite={c} />)}
        </footer>
      )}
    </article>
  );
}

// A textarea that grows with its text, so the doc reads like a page, not a form.
function Grow({ value, onChange, className, ...rest }: {
  value: string;
  onChange: (v: string) => void;
  className: string;
  placeholder: string;
  'aria-label': string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className={`grow ${className}`} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
