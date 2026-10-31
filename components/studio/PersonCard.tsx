'use client';

import Link from 'next/link';
import type { EntityType, NodeProfile } from '@/lib/types';
import { chipStyle, entityColor, type Palette } from './colors';

type Profile = Pick<NodeProfile, 'name' | 'type' | 'links' | 'quotes'> & { mentions?: number };

const TYPE_NAME: Record<EntityType, string> = {
  person: 'Person', org: 'Organisation', place: 'Place', item: 'Thing', date: 'Date', amount: 'Amount',
};

// A person (or org, place, thing) as the graph knows them: their links drawn
// around them, then each link as a sentence with the words it came from.
export default function PersonCard({ profile, palette, isNew }: { profile: Profile; palette: Palette; isNew?: boolean }) {
  const c = entityColor(profile, palette);
  const initials = profile.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <article className={`person-card${isNew ? ' rise' : ''}`}>
      <header>
        <span className="avatar" style={{ background: c.soft, color: c.ink }}>{initials}</span>
        <div className="person-id">
          <h3>{profile.name}</h3>
          <span>
            {TYPE_NAME[profile.type]}
            {profile.mentions ? ` · mentioned ${profile.mentions}×` : ''}
            {` · ${profile.links.length} connection${profile.links.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <Link href={`/graph?focus=${encodeURIComponent(profile.name)}`} className="person-open">Open in graph</Link>
      </header>
      {profile.links.length > 0 ? (
        <>
          <MiniGraph profile={profile} palette={palette} />
          <ul className="person-links">
            {profile.links.map((l, n) => (
              <li key={n} title={`Said: “${l.quote}”`}>
                {l.dir === 'out' ? (
                  <><b>{profile.name}</b> <span className="rel">{l.label}</span> <span className="chip" style={chipStyle(l, palette)}>{l.name}</span></>
                ) : (
                  <><span className="chip" style={chipStyle(l, palette)}>{l.name}</span> <span className="rel">{l.label}</span> <b>{profile.name}</b></>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="person-none">No connections yet. Say how they relate to someone (“{profile.name} is …’s manager”) and it’ll appear here.</p>
      )}
      {profile.quotes.length > 0 && <blockquote className="person-quote">“{profile.quotes[0]}”</blockquote>}
    </article>
  );
}

// The node in the middle, its connections on a ring around it.
function MiniGraph({ profile, palette }: { profile: Profile; palette: Palette }) {
  const w = 440, h = 170, cx = w / 2, cy = h / 2;
  const links = profile.links.slice(0, 10);
  const center = entityColor(profile, palette);
  return (
    <svg className="mini-graph" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${profile.name} and ${links.length} connections`}>
      <defs>
        <marker id="mg-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--s-line-strong)" />
        </marker>
      </defs>
      {links.map((l, n) => {
        const a = (n / links.length) * Math.PI * 2 - Math.PI / 2 + (links.length === 1 ? Math.PI / 2 : 0);
        const x = cx + Math.cos(a) * 165, y = cy + Math.sin(a) * 58;
        const out = l.dir === 'out';
        const [x1, y1, x2, y2] = out ? [cx, cy, x, y] : [x, y, cx, cy];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const end = 16;
        const c = entityColor(l, palette);
        return (
          <g key={n} className="mg-link" style={{ animationDelay: `${n * 60}ms` }}>
            <line x1={x1} y1={y1} x2={x2 - ((x2 - x1) / len) * end} y2={y2 - ((y2 - y1) / len) * end} markerEnd="url(#mg-arrow)" />
            <text className="mg-label" x={(cx + x) / 2} y={(cy + y) / 2 - 5} textAnchor="middle">{l.label}</text>
            <circle cx={x} cy={y} r={9} fill={c.solid} />
            <text className="mg-name" x={x} y={y + 22} textAnchor="middle">{l.name}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={20} fill={center.soft} />
      <circle cx={cx} cy={cy} r={13} fill={center.solid} />
      <text className="mg-center" x={cx} y={cy + 34} textAnchor="middle">{profile.name}</text>
    </svg>
  );
}
