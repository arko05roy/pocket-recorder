'use client';

import { useState } from 'react';
import type { CleanTurn, Recap, RecapState } from '@/lib/types';
import { fmtClock } from '@/lib/format';
import { download, toCsv } from '@/lib/csv';

// The report shown when a recording stops: Sonnet's cleaned transcript first,
// then Opus's report. Each stage shows as soon as it lands.
export function RecapCard({ recap, durationS, onRetry }: { recap: RecapState; durationS: number; onRetry: () => void }) {
  const r = recap.report;
  return (
    <article className="recap" aria-busy={recap.stage === 'cleaning' || recap.stage === 'writing'}>
      <header className="recap-head">
        <div className="recap-eyebrow">
          <span>Report</span>
          {r?.kind && <span className="recap-kind">{r.kind}</span>}
          <span className="mono">{fmtClock(durationS)}</span>
        </div>
        {r ? <h2>{r.title}</h2> : <div className="recap-skel recap-skel-title" />}
        <Stages stage={recap.stage} />
      </header>

      {recap.stage === 'error' && (
        <div className="recap-error">
          <p className="err">{recap.error ?? 'The report couldn’t be made.'}</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      )}

      {r ? <Report r={r} /> : recap.stage !== 'error' && (
        <div className="recap-body"><div className="recap-skel" /><div className="recap-skel short" /><div className="recap-skel" /></div>
      )}

      {recap.clean && recap.clean.length > 0 && <CleanTranscript turns={recap.clean} names={r?.participants} />}
    </article>
  );
}

function Stages({ stage }: { stage: RecapState['stage'] }) {
  if (stage === 'done' || stage === 'error') return null;
  return (
    <ol className="recap-stages">
      <li data-state={stage === 'cleaning' ? 'on' : 'done'}>Cleaning transcript</li>
      <li data-state={stage === 'writing' ? 'on' : 'wait'}>Writing report</li>
    </ol>
  );
}

function Report({ r }: { r: Recap }) {
  const order = { high: 0, medium: 1, low: 2 };
  const actions = [...r.action_items].sort((a, b) => order[a.priority] - order[b.priority]);
  return (
    <div className="recap-body">
      {r.summary && <p className="recap-summary">{r.summary}</p>}

      {r.participants.length > 0 && (
        <div className="recap-people">
          {r.participants.map((p) => (
            <span key={p.name} className={`recap-person s${p.speaker}`}>
              <i aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</i>
              <span><b>{p.name}</b>{p.role && <small>{p.role}</small>}</span>
            </span>
          ))}
        </div>
      )}

      {r.numbers.length > 0 && (
        <div className="recap-metrics">
          {r.numbers.map((n, k) => <div key={k}><b>{n.value}</b><small>{n.label}</small></div>)}
        </div>
      )}

      {(r.tables ?? []).map((t, k) => <RecapTable key={k} table={t} />)}

      {actions.length > 0 && (
        <Section title="Action items" count={actions.length}>
          <ul className="recap-actions">
            {actions.map((a, k) => (
              <li key={k}>
                <span className={`prio ${a.priority}`}>{a.priority}</span>
                <span className="task">{a.task}</span>
                <span className="meta">{[a.owner, a.due].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="recap-grid">
        {r.decisions.length > 0 && <Section title="Decisions"><Bullets items={r.decisions} mark="✓" /></Section>}
        {r.key_points.length > 0 && <Section title="Key points"><Bullets items={r.key_points} /></Section>}
      </div>

      {r.timeline.length > 0 && (
        <Section title="Timeline">
          <ol className="recap-timeline">
            {r.timeline.map((t, k) => <li key={k}><span className="when">{t.when}</span><span>{t.what}</span></li>)}
          </ol>
        </Section>
      )}

      <div className="recap-grid">
        {r.next_steps.length > 0 && <Section title="Next steps"><ol className="recap-steps">{r.next_steps.map((s, k) => <li key={k}>{s}</li>)}</ol></Section>}
        {r.open_questions.length > 0 && <Section title="Open questions"><Bullets items={r.open_questions} mark="?" /></Section>}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="recap-section">
      <h3>{title}{count != null && <span>{count}</span>}</h3>
      {children}
    </section>
  );
}

const Bullets = ({ items, mark = '•' }: { items: string[]; mark?: string }) => (
  <ul className="recap-bullets">{items.map((x, k) => <li key={k}><i aria-hidden="true">{mark}</i>{x}</li>)}</ul>
);

function CleanTranscript({ turns, names }: { turns: CleanTurn[]; names?: Recap['participants'] }) {
  const [open, setOpen] = useState(false);
  const two = turns.some((t) => t.speaker === 1);
  const nameOf = (s: number) => names?.find((p) => p.speaker === s)?.name ?? (s === 1 ? 'Other speaker' : 'You');
  return (
    <section className="recap-transcript">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} clean transcript <span className="mono">{turns.length} {two ? 'turns' : 'paragraphs'}</span>
      </button>
      {open && (
        <div className="recap-turns">
          {turns.map((t, k) => (
            <p key={k} className={`s${t.speaker}`}>{two && <b>{nameOf(t.speaker)}</b>}{t.text}</p>
          ))}
        </div>
      )}
    </section>
  );
}

// A table from the report, downloadable as CSV.
function RecapTable({ table: t }: { table: NonNullable<Recap['tables']>[number] }) {
  const save = () => download(`${t.title.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'table'}.csv`, toCsv(t.columns, t.rows));
  return (
    <section className="recap-section">
      <h3>{t.title}<span>{t.rows.length}</span><button type="button" className="recap-csv" onClick={save}>Download CSV</button></h3>
      <div className="recap-table">
        <table>
          <thead><tr>{t.columns.map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
          <tbody>{t.rows.map((row, k) => <tr key={k}>{row.map((v, n) => <td key={n}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
