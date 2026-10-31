'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { EntityType, GraphEdge, GraphNode, NodeProfile } from '@/lib/types';
import Constellation from './Constellation';
import PersonCard from './PersonCard';
import { personPalette } from './colors';

const FILTERS: [EntityType | 'all', string][] = [['all', 'Everything'], ['person', 'People'], ['org', 'Organisations'], ['place', 'Places'], ['item', 'Things']];

// The whole knowledge graph: search, filter by kind, click a node for its profile.
export default function GraphExplorer({ graph, focus }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] }; focus: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<EntityType | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(focus);
  const [profile, setProfile] = useState<NodeProfile | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const palette = useMemo(() => personPalette(graph.nodes.map((n) => ({ text: n.name, type: n.type }))), [graph.nodes]);
  const q = query.trim().toLowerCase();
  const visible = graph.nodes.filter((n) => (kind === 'all' || n.type === kind) && (!q || n.name.toLowerCase().includes(q)));
  const keep = new Set(visible.map((n) => n.id));
  const nodes = visible.map((n) => ({ text: n.name, type: n.type, mentions: n.mentions, said: '' }));
  const relations = graph.edges.filter((e) => keep.has(e.from_id) && keep.has(e.to_id))
    .map((e) => ({ from: byId.get(e.from_id)!.name, to: byId.get(e.to_id)!.name, label: e.label }));

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

  return (
    <div className="explorer">
      <header className="page-head">
        <div>
          <h1>Graph</h1>
          <p>{graph.nodes.length} people and things, {graph.edges.length} connections, from everything said in your chats.</p>
        </div>
        <div className="explorer-tools">
          <input type="search" placeholder="Find a name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a name" />
          <div className="seg" role="radiogroup" aria-label="Show">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
        </div>
      </header>
      <div className="explorer-body">
        <div className="explorer-canvas">
          <Constellation
            nodes={nodes}
            relations={relations}
            palette={palette}
            selected={selected}
            onSelect={setSelected}
            empty={graph.nodes.length ? 'Nothing matches.' : 'The graph fills in as you talk. Start a chat and mention who works with whom.'}
          />
        </div>
        <aside className="explorer-side">
          {profile ? (
            <>
              <PersonCard profile={profile} palette={palette} />
              {confirming ? (
                <div className="confirm-panel" onKeyDown={(e) => { if (e.key === 'Escape') setConfirming(false); }}>
                  <p>
                    Remove <b>{profile.name}</b>
                    {profile.links.length > 0 && ` and ${profile.links.length} connection${profile.links.length === 1 ? '' : 's'}`} from the graph?
                    Recordings and chats are kept.
                  </p>
                  {removeError && <p className="err">{removeError}</p>}
                  <div>
                    <button type="button" className="confirm-yes" onClick={remove}>Remove</button>
                    <button type="button" autoFocus onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="danger-link" onClick={() => setConfirming(true)}>Remove from graph</button>
              )}
            </>
          ) : (
            <p className="side-hint">Click a node to see who it connects to and where it came up.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
