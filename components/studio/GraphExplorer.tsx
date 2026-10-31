'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { EntityType, GraphEdge, GraphNode, NodeProfile } from '@/lib/types';
import Constellation from './Constellation';
import PersonCard from './PersonCard';
import { entityColor, personPalette } from './colors';

// The kinds of node the graph holds. The legend is also the filter.
const KINDS: [EntityType, string][] = [['person', 'People'], ['org', 'Organisations'], ['place', 'Places'], ['item', 'Things']];
const TOP = 8;

// The whole knowledge graph: search, filter by kind, click a node for its profile.
export default function GraphExplorer({ graph, focus }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] }; focus: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<EntityType | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(focus);
  const [profile, setProfile] = useState<NodeProfile | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const palette = useMemo(() => personPalette(graph.nodes.map((n) => ({ text: n.name, type: n.type }))), [graph.nodes]);
  const counts = useMemo(() => {
    const c = new Map<EntityType, number>();
    for (const n of graph.nodes) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [graph.nodes]);

  const q = query.trim().toLowerCase();
  const visible = graph.nodes.filter((n) => (kind === 'all' || n.type === kind) && (!q || n.name.toLowerCase().includes(q)));
  const keep = new Set(visible.map((n) => n.id));
  const nodes = visible.map((n) => ({ text: n.name, type: n.type, mentions: n.mentions, said: '' }));
  const relations = graph.edges.filter((e) => keep.has(e.from_id) && keep.has(e.to_id))
    .map((e) => ({ from: byId.get(e.from_id)!.name, to: byId.get(e.to_id)!.name, label: e.label }));

  // Nodes arrive sorted by mentions, so the first few are the most talked about.
  const top = visible.slice(0, TOP);
  const peak = Math.max(1, ...top.map((n) => n.mentions));

  useEffect(() => {
    setConfirming(false);
    setRemoveError(null);
    if (!selected) { setProfile(null); return; }
    let stop = false;
    fetch(`/api/graph/node?name=${encodeURIComponent(selected)}`).then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (!stop) setProfile(p); }).catch(() => {});
    return () => { stop = true; };
  }, [selected]);

  const remove = async () => {
    if (!profile) return;
    setRemoveError(null);
    const res = await fetch(`/api/graph/node?id=${profile.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) { setRemoveError(`${profile.name} wasn’t removed. Try again.`); return; }
    setConfirming(false);
    setSelected(null);
    router.refresh();
  };

  const clearAll = async () => {
    setClearError(null);
    const res = await fetch('/api/graph', { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) { setClearError('The graph wasn’t cleared. Try again.'); return; }
    setClearing(false);
    setSelected(null);
    router.refresh();
  };

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const filtered = kind !== 'all' || q;

  return (
    <div className="explorer">
      <header className="gx-head">
        <h1>Graph</h1>
        <p className="gx-count">
          <span>{plural(graph.nodes.length, 'name', 'names')}</span>
          <span>{plural(graph.edges.length, 'connection', 'connections')}</span>
          {filtered && <span className="gx-showing">showing {visible.length}</span>}
        </p>
      </header>

      <div className="explorer-body">
        <div className="explorer-canvas">
          <div className="gx-bar">
            <label className="gx-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" placeholder="Find a name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a name" />
            </label>
            <div className="gx-kinds" role="radiogroup" aria-label="Show">
              <button type="button" role="radio" aria-checked={kind === 'all'} onClick={() => setKind('all')}>All</button>
              {KINDS.map(([k, label]) => {
                const n = counts.get(k) ?? 0;
                return (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={!n} onClick={() => setKind(kind === k ? 'all' : k)}>
                    <i style={{ background: entityColor({ type: k, name: '' }, palette).solid }} />
                    {label}
                    <span className="gx-n">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Constellation
            nodes={nodes}
            relations={relations}
            palette={palette}
            selected={selected}
            onSelect={setSelected}
            empty={graph.nodes.length ? `Nothing matches “${query.trim() || 'this filter'}”.` : 'Names show up here as you talk. Start a chat and say who works with whom.'}
          />
          <p className="gx-help" aria-hidden="true">Drag to move · click to open</p>
        </div>

        <aside className="explorer-side">
          {profile ? (
            <div className="gx-profile">
              <button type="button" className="gx-back" onClick={() => setSelected(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                Most talked about
              </button>
              <PersonCard profile={profile} palette={palette} />
              {confirming ? (
                <div className="confirm-panel" onKeyDown={(e) => { if (e.key === 'Escape') setConfirming(false); }}>
                  <p>
                    Remove <b>{profile.name}</b>
                    {profile.links.length > 0 && ` and ${plural(profile.links.length, 'connection', 'connections')}`} from the graph?
                    Recordings and chats are kept.
                  </p>
                  {removeError && <p className="err">{removeError}</p>}
                  <div>
                    <button type="button" className="confirm-yes" onClick={remove}>Remove</button>
                    <button type="button" autoFocus onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="danger-link" onClick={() => setConfirming(true)}>Remove {profile.name} from graph</button>
              )}
            </div>
          ) : top.length > 0 ? (
            <section className="gx-top" aria-labelledby="gx-top-h">
              <h2 id="gx-top-h">Most talked about</h2>
              <ol>
                {top.map((n) => {
                  const c = entityColor({ type: n.type, name: n.name }, palette);
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => setSelected(n.name)}>
                        <span className="gx-name">{n.name}</span>
                        <span className="gx-meter" aria-hidden="true">
                          <span style={{ width: `${(n.mentions / peak) * 100}%`, background: c.solid }} />
                        </span>
                        <span className="gx-n">{n.mentions}×</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="gx-tip">Pick a name to see who it connects to and where it came up.</p>
            </section>
          ) : (
            <p className="side-hint">{graph.nodes.length ? 'No names match. Clear the search or pick another kind.' : 'Once you mention people, places or companies in a chat, the most talked about appear here.'}</p>
          )}

          {graph.nodes.length > 0 && (
            <section className="side-manage" aria-label="Manage graph">
              {clearing ? (
                <div className="confirm-panel" onKeyDown={(e) => { if (e.key === 'Escape') setClearing(false); }}>
                  <p className="confirm-title">Clear the whole graph?</p>
                  <p>
                    This deletes <b>{plural(graph.nodes.length, 'name', 'names')}</b> and <b>{plural(graph.edges.length, 'connection', 'connections')}</b>.
                    Recordings and chats are kept, but the graph won’t rebuild from them.
                  </p>
                  {clearError && <p className="err">{clearError}</p>}
                  <div>
                    <button type="button" className="confirm-yes" onClick={clearAll}>Clear graph</button>
                    <button type="button" autoFocus onClick={() => { setClearing(false); setClearError(null); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="manage-row">
                  <div>
                    <p className="manage-title">Start fresh</p>
                    <p className="manage-sub">Remove every name and connection.</p>
                  </div>
                  <button type="button" className="danger-outline" onClick={() => setClearing(true)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
                    Clear graph
                  </button>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
