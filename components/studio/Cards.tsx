'use client';

import { useState } from 'react';
import type { LiveCard, LiveLine } from '@/lib/types';
import { download, toCsv } from '@/lib/csv';

const FALLBACK: Record<LiveCard['kind'], string> = {
  table: 'Table', checklist: 'To do', facts: 'Key facts', timeline: 'Timeline', metrics: 'Numbers', quotes: 'Worth keeping',
};

// One generated card. Hovering any row shows the sentence it came from.
export function CardView({ card, lines }: { card: LiveCard; lines: LiveLine[] }) {
  const said = (line: number) => `Said: “${lines.find((l) => l.i === line)?.text ?? ''}”`;
  const title = card.title || FALLBACK[card.kind];
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = card.kind === 'table'
      ? [card.columns, ...card.rows.map((r) => r.cells)].map((r) => r.join('\t')).join('\n')
      : card.items.map((x) => (x.label ? `${x.label}: ${x.text}` : `• ${x.text}`)).join('\n');
    await navigator.clipboard.writeText(`${title}\n${text}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const head = (extra?: React.ReactNode) => (
    <div className="card-head">
      <span className={`card-kind k-${card.kind}`}>{FALLBACK[card.kind]}</span>
      <h3>{title}</h3>
      <div className="card-actions">
        {extra}
        <button type="button" className="card-action" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );

  if (card.kind === 'table') {
    const name = `${title.toLowerCase().replace(/[^\w]+/g, '-')}.csv`;
    // Numbers sort as numbers, everything else alphabetically.
    const rows = sort ? [...card.rows].sort((a, b) => {
      const x = a.cells[sort.col], y = b.cells[sort.col];
      const nx = parseFloat(x), ny = parseFloat(y);
      return sort.dir * (!isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y));
    }) : card.rows;
    return (
      <article className="card">
        {head(
          <button type="button" className="card-action" onClick={() => download(name, toCsv(card.columns, rows.map((r) => r.cells)))}>
            CSV
          </button>,
        )}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {card.columns.map((c, n) => (
                  <th key={n} aria-sort={sort?.col === n ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => setSort((s) => (s?.col === n ? (s.dir === 1 ? { col: n, dir: -1 } : null) : { col: n, dir: 1 }))}>
                      {c}{sort?.col === n ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n} title={said(r.line)} className="rise">
                  {r.cells.map((c, k) => <td key={k}>{c || <span className="blank">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-foot">{card.rows.length} row{card.rows.length === 1 ? '' : 's'}</div>
      </article>
    );
  }

  if (card.kind === 'metrics') {
    return (
      <article className="card">
        {head()}
        <div className="metrics">
          {card.items.map((x, n) => (
            <div key={n} className="metric rise" title={said(x.line)}>
              <span className="metric-value">{x.label}</span>
              <span className="metric-label">{x.text}</span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  if (card.kind === 'timeline') {
    return (
      <article className="card">
        {head()}
        <ol className="timeline">
          {card.items.map((x, n) => (
            <li key={n} className="rise" title={said(x.line)}>
              <span className="tl-when">{x.label || 'Date not said'}</span>
              <span className="tl-what">{x.text}</span>
            </li>
          ))}
        </ol>
      </article>
    );
  }

  if (card.kind === 'quotes') {
    return (
      <article className="card">
        {head()}
        {card.items.map((x, n) => (
          <blockquote key={n} className="quote rise" title={said(x.line)}>
            {x.text}
            {x.label && <cite>— {x.label}</cite>}
          </blockquote>
        ))}
      </article>
    );
  }

  return (
    <article className="card">
      {head()}
      {card.kind === 'checklist' ? (
        <ul className="checks">
          {card.items.map((x, n) => (
            <li key={n} className={`rise${done.has(n) ? ' done' : ''}`} title={said(x.line)}>
              <label>
                <input
                  type="checkbox"
                  checked={done.has(n)}
                  onChange={() => setDone((d) => { const next = new Set(d); if (next.has(n)) next.delete(n); else next.add(n); return next; })}
                />
                <span>{x.text}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="facts">
          {card.items.map((x, n) => (
            <li key={n} className="rise" title={said(x.line)}>
              {x.label && <span className="fact-key">{x.label}</span>}
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
