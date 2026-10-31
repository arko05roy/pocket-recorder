import type { Entity, LiveLine, Relation } from '../types';
import { ingestGraph } from './db';
import { str } from './validate';

const TYPES = ['person', 'item', 'date', 'amount', 'place', 'org'];
// Only lasting things become nodes. Dates and amounts belong to one moment.
const NODE_TYPES = new Set(['person', 'org', 'place', 'item']);

// Store a finished voice note in the graph. Everything comes from the
// browser, so it's checked again: each entity must appear in the line it
// cites, and each relation needs both ends in its line.
export function saveVoiceNote(source: string, linesRaw: unknown, entitiesRaw: unknown, relationsRaw: unknown) {
  const lines = new Map<number, string>();
  for (const l of Array.isArray(linesRaw) ? linesRaw.slice(0, 600) : []) {
    if (Number.isInteger(l?.i) && typeof l.text === 'string') lines.set(l.i, l.text.slice(0, 1000));
  }
  const SPEAKER = /(?<![\p{L}])(i|me|my|i'm|i'll|i've|myself)(?![\p{L}])/iu;
  const has = (line: unknown, text: string) => {
    const l = lines.get(line as number);
    if (l == null) return false;
    return text.toLowerCase() === 'me' ? SPEAKER.test(l) : l.toLowerCase().includes(text.toLowerCase());
  };

  const nodes = new Map<string, { name: string; type: string; quote: string }>();
  for (const e of (Array.isArray(entitiesRaw) ? entitiesRaw : []) as Entity[]) {
    const name = str(e?.text, 80);
    if (!name || !TYPES.includes(e.type) || !NODE_TYPES.has(e.type) || !has(e.line, name)) continue;
    if (!nodes.has(name.toLowerCase())) nodes.set(name.toLowerCase(), { name, type: e.type, quote: lines.get(e.line)! });
  }
  const edges = ((Array.isArray(relationsRaw) ? relationsRaw : []) as Relation[]).flatMap((r) => {
    const from = nodes.get(String(r?.from ?? '').toLowerCase()), to = nodes.get(String(r?.to ?? '').toLowerCase());
    const label = str(r?.label, 30);
    if (!from || !to || from === to || !label || !has(r.line, from.name) || !has(r.line, to.name)) return [];
    return [{ from: from.name, to: to.name, label, quote: lines.get(r.line)! }];
  });
  ingestGraph(source, [...nodes.values()], edges);
  return { nodes: nodes.size, edges: edges.length };
}
