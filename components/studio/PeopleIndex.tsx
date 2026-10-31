'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { EntityType, GraphNode } from '@/lib/types';
import { entityColor, personPalette } from './colors';

type Row = GraphNode & { links: number; last_seen: string | null };

const KIND: Record<EntityType, string> = { person: 'Person', org: 'Organisation', place: 'Place', item: 'Thing', date: 'Date', amount: 'Amount' };

// Everyone and everything in the graph, most talked-about first.
export default function PeopleIndex({ people }: { people: Row[] }) {
  const [query, setQuery] = useState('');
  const [onlyPeople, setOnlyPeople] = useState(true);
  const palette = useMemo(() => personPalette(people.map((p) => ({ text: p.name, type: p.type }))), [people]);
  const q = query.trim().toLowerCase();
  const rows = people.filter((p) => (!onlyPeople || p.type === 'person') && (!q || p.name.toLowerCase().includes(q)));
  return (
    <div className="doc wide">
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p>Everyone mentioned in your chats, with how they connect.</p>
        </div>
        <div className="explorer-tools">
          <input type="search" placeholder="Find a name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a name" />
          <div className="seg" role="radiogroup" aria-label="Show">
            <button type="button" role="radio" aria-checked={onlyPeople} onClick={() => setOnlyPeople(true)}>People</button>
            <button type="button" role="radio" aria-checked={!onlyPeople} onClick={() => setOnlyPeople(false)}>Everything</button>
          </div>
        </div>
      </header>
      {rows.length ? (
        <div className="people-grid">
          {rows.map((p) => {
            const c = entityColor({ name: p.name, type: p.type }, palette);
            return (
              <Link key={p.id} href={`/graph?focus=${encodeURIComponent(p.name)}`} className="person-tile">
                <span className="avatar" style={{ background: c.soft, color: c.ink }}>
                  {p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="tile-name">{p.name}</span>
                <span className="tile-meta">{KIND[p.type]} · {p.links} connection{p.links === 1 ? '' : 's'}</span>
                <span className="tile-meta">Mentioned {p.mentions}×</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="none">{people.length ? 'Nobody matches.' : 'Nobody yet. Start a chat and mention people by name; they’ll be listed here.'}</p>
      )}
    </div>
  );
}
