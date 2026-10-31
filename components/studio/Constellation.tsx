'use client';

import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityType } from '@/lib/types';
import { entityColor, type Palette } from './colors';

interface Node extends SimulationNodeDatum {
  id: string;        // lower-case text
  text: string;
  type: EntityType;
  mentions: number;
}
interface Link extends SimulationLinkDatum<Node> {
  label: string;
}

const radius = (n: Node) => 5 + Math.min(10, Math.sqrt(n.mentions) * 3) + (n.type === 'person' ? 3 : 0);

export interface GraphItem {
  text: string;
  type: EntityType;
  mentions: number;
  said: string;      // a sentence it came up in, shown on hover
}

// People and things, connected by the relations heard. Positions come from a
// force simulation; nodes can be dragged, hovered and (optionally) selected.
export default function Constellation({ nodes: items, relations, palette, selected, onSelect, empty }: {
  nodes: GraphItem[];
  relations: { from: string; to: string; label: string }[];
  palette: Palette;
  selected?: string | null;
  onSelect?: (text: string) => void;
  empty?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 320 });
  const sim = useRef<Simulation<Node, Link> | null>(null);
  const nodes = useRef(new Map<string, Node>());
  const [, setFrame] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ node: Node; svg: SVGSVGElement } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Node and link data, keeping each node's object (and so its position)
  // across updates, so new names drift in instead of the graph re-shuffling.
  const graph = useMemo(() => {
    const next = new Map<string, Node>();
    // Dates and amounts belong to one moment; they live on the cards.
    for (const e of items) {
      if (e.type === 'date' || e.type === 'amount') continue;
      const key = e.text.toLowerCase();
      const n = e.mentions;
      const old = nodes.current.get(key);
      next.set(key, old ? Object.assign(old, { mentions: n, type: e.type }) : {
        id: key, text: e.text, type: e.type, mentions: n,
        x: size.w / 2 + (Math.random() - 0.5) * 60, y: size.h / 2 + (Math.random() - 0.5) * 60,
      });
    }
    nodes.current = next;
    const links: Link[] = relations
      .filter((r) => next.has(r.from.toLowerCase()) && next.has(r.to.toLowerCase()))
      .map((r) => ({ source: r.from.toLowerCase(), target: r.to.toLowerCase(), label: r.label }));
    return { nodes: [...next.values()], links };
  }, [items, relations, size.w, size.h]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = sim.current ?? forceSimulation<Node, Link>();
    sim.current = s;
    s.nodes(graph.nodes)
      .force('link', forceLink<Node, Link>(graph.links).id((n) => n.id).distance(95).strength(0.5))
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('x', forceX(size.w / 2).strength(0.04))
      .force('y', forceY(size.h / 2).strength(0.06))
      .force('collide', forceCollide<Node>().radius((n) => radius(n) + 18))
      .on('tick', () => {
        for (const n of graph.nodes) {
          n.x = Math.max(24, Math.min(size.w - 24, n.x ?? 0));
          n.y = Math.max(20, Math.min(size.h - 28, n.y ?? 0));
        }
        setFrame((f) => f + 1);
      });
    if (reduce) { s.stop(); s.tick(300); setFrame((f) => f + 1); } else s.alpha(0.7).restart();
    return () => { s.on('tick', null); };
  }, [graph, size.w, size.h]);

  useEffect(() => () => { sim.current?.stop(); }, []);

  const point = (e: React.PointerEvent, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const linked = (id: string) => graph.links.some((l) => (l.source as Node).id === id || (l.target as Node).id === id);
  const near = (a: string) => new Set(graph.links.flatMap((l) => {
    const s = (l.source as Node).id, t = (l.target as Node).id;
    return s === a ? [t] : t === a ? [s] : [];
  }));
  const lit = hover ?? selected?.toLowerCase() ?? null;
  const focusSet = lit ? near(lit).add(lit) : null;
  const hovered = hover ? graph.nodes.find((n) => n.id === hover) : null;
  const hoveredItem = hovered ? items.find((e) => e.text.toLowerCase() === hovered.id) : null;

  return (
    <div className="constellation" ref={box}>
      {!graph.nodes.length && (
        <p className="const-empty">{empty ?? 'People, places and things you mention appear here, linked by what connects them.'}</p>
      )}
      <svg
        width={size.w}
        height={size.h}
        role="img"
        aria-label={`Graph of ${graph.nodes.length} people and things mentioned`}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = point(e, d.svg);
          d.node.fx = p.x; d.node.fy = p.y;
          sim.current?.alphaTarget(0.3).restart();
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (!d) return;
          d.node.fx = null; d.node.fy = null;
          drag.current = null;
          sim.current?.alphaTarget(0);
        }}
      >
        <defs>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--s-line-strong)" />
          </marker>
        </defs>
        {graph.links.map((l, n) => {
          const s = l.source as Node, t = l.target as Node;
          if (s.x == null || t.x == null) return null;
          const dx = t.x - s.x, dy = t.y! - s.y!, len = Math.hypot(dx, dy) || 1;
          const tx = t.x - (dx / len) * (radius(t) + 4), ty = t.y! - (dy / len) * (radius(t) + 4);
          const dim = focusSet && !(focusSet.has(s.id) && focusSet.has(t.id));
          return (
            <g key={n} className={`edge${dim ? ' dim' : ''}`}>
              <line x1={s.x} y1={s.y} x2={tx} y2={ty} markerEnd="url(#arrow)" />
              <text x={(s.x + t.x) / 2} y={(s.y! + t.y!) / 2 - 4} textAnchor="middle">{l.label}</text>
            </g>
          );
        })}
        {graph.nodes.map((n) => {
          const c = entityColor(n, palette);
          const dim = focusSet && !focusSet.has(n.id);
          return (
            <g
              key={n.id}
              className={`node${dim ? ' dim' : ''}${linked(n.id) ? '' : ' lone'}${selected?.toLowerCase() === n.id ? ' picked' : ''}`}
              transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onSelect?.(n.text)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(n.text); }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                drag.current = { node: n, svg: (e.currentTarget.ownerSVGElement)! };
              }}
              tabIndex={0}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              aria-label={`${n.text}, ${n.type}, mentioned ${n.mentions} time${n.mentions === 1 ? '' : 's'}`}
            >
              <circle r={radius(n) + 7} fill={c.soft} className="halo" />
              <circle r={radius(n)} fill={c.solid} />
              <text y={radius(n) + 14} textAnchor="middle">{n.text}</text>
            </g>
          );
        })}
      </svg>
      {hovered && hoveredItem?.said && (
        <div className="const-tip">
          <span className="const-tip-type">{hovered.type} · {hovered.mentions}×</span>
          “{hoveredItem.said}”
        </div>
      )}
    </div>
  );
}
