import type { CardKind, Entity, EntityType, LiveCard, LiveLine, LiveState, Relation } from '../types';
import { ask, textOf } from './claude';
import { str } from './validate';

const SYSTEM = `You watch a live transcript while it is being recorded and keep a set of cards up to date for the person recording.

Cards (0 to 4, most useful first). Pick the kinds that fit what is actually being said:
- "table": repeated, structured things such as orders (item, quantity, notes, customer), prices, inventory, attendees, scores. Short column names.
- "checklist": tasks and to-dos. label is empty.
- "facts": key details worth keeping (decisions, addresses, requirements). label is a short key, text the value.
- "timeline": things tied to a date or time (meetings, deadlines, deliveries). label is the date or time as said, text what happens.
- "metrics": numbers that were said (budget, headcount, price, quantity). label is the number with its unit as said, text what it measures.
- "quotes": up to 3 lines worth keeping word for word. text is the exact words, label who said them if known, else empty.
Don't make a card for small talk, and don't repeat the same information in two cards.

Entities: every person, item/product, date or time, amount, place and organisation mentioned. "text" must be copied exactly as it appears in that line, as one whole phrase ("next week", not "next" and "week").
The person speaking is the entity "Me" (type person) whenever they say "I", "me" or "my", so links like "Me" "meeting with" "Paruk" can be drawn.

Relations: how entities connect, as said. "label" is a short lower-case phrase chosen so that "from label to" reads as a true sentence: "Paruk" "boss of" "Atharv"; "Atharv" "reports to" "Paruk"; "Priya" "ordered" "latte"; "Sam" "works at" "Acme"; "Mei" "lives in" "Pune". Use the same label for the same kind of link every time. Both entities must appear in the line you cite.

Rules:
- Use only what is said. Never invent values, never calculate totals that weren't said, never fill gaps; leave a cell empty if it was not said.
- Every row, item, entity and relation cites the transcript line number it comes from.
- Numbered speech ("number one", "number two") is a list position, not a quantity, unless a quantity is said.
- When something is corrected ("make that two", "cancel the tea"), show the corrected state and cite the correcting line.
- If previous cards are given and still fit, keep their kinds, titles and columns so the screen doesn't jump around.`;

const KINDS: CardKind[] = ['table', 'checklist', 'facts', 'timeline', 'metrics', 'quotes'];

const CARD = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    title: { type: 'string' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cells: { type: 'array', items: { type: 'string' } }, line: { type: 'integer' } },
        required: ['cells', 'line'], additionalProperties: false,
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, label: { type: 'string' }, line: { type: 'integer' } },
        required: ['text', 'label', 'line'], additionalProperties: false,
      },
    },
  },
  required: ['kind', 'title', 'columns', 'rows', 'items'],
  additionalProperties: false,
};

const TYPES: EntityType[] = ['person', 'item', 'date', 'amount', 'place', 'org'];

const SCHEMA = {
  type: 'object',
  properties: {
    cards: { type: 'array', items: CARD },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, type: { type: 'string', enum: TYPES }, line: { type: 'integer' } },
        required: ['text', 'type', 'line'], additionalProperties: false,
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, line: { type: 'integer' } },
        required: ['from', 'to', 'label', 'line'], additionalProperties: false,
      },
    },
  },
  required: ['cards', 'entities', 'relations'],
  additionalProperties: false,
};

type Previous = Pick<LiveCard, 'kind' | 'title' | 'columns'>[];

// The speaker. "Me" never appears verbatim, so it is checked by pronoun.
const isMe = (t: string) => t.toLowerCase() === 'me';
const SPEAKER = /(?<![\p{L}])(i|me|my|i'm|i'll|i've|myself)(?![\p{L}])/iu;

export async function buildLive(lines: LiveLine[], previous: Previous): Promise<LiveState> {
  if (!lines.length) return { cards: [], entities: [], relations: [] };
  const transcript = lines.map((l) => `[${l.i}] ${l.text}`).join('\n');
  const prev = previous.length ? `Previous cards: ${JSON.stringify(previous)}\n\n` : '';
  const res = await ask({
    system: SYSTEM,
    messages: [{ role: 'user', content: `${prev}Transcript so far:\n${transcript}` }],
    // Low effort: this reruns every few seconds while recording.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  });
  return clean(JSON.parse(textOf(res)), lines);
}

// The model's output is untrusted. Keep only rows and items that cite a line
// we sent, and entities whose text really appears in the line they cite.
function clean(raw: any, lines: LiveLine[]): LiveState {
  const byIdx = new Map(lines.map((l) => [l.i, l.text]));
  const cites = (x: any) => Number.isInteger(x?.line) && byIdx.has(x.line);
  const cell = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

  const cards = list(raw?.cards).slice(0, 4).flatMap((c): LiveCard[] => {
    if (!KINDS.includes(c?.kind)) return [];
    const title = str(c.title, 80) ?? '';
    if (c.kind === 'table') {
      const columns = list(c.columns).map((x) => str(x, 40) ?? '').slice(0, 8);
      const rows = list(c.rows).filter(cites).slice(0, 200)
        .map((r) => ({ cells: columns.map((_, n) => cell(r.cells?.[n])), line: r.line as number }))
        .filter((r) => r.cells.some(Boolean));
      return columns.length && rows.length ? [{ kind: 'table', title, columns, rows, items: [] }] : [];
    }
    const items = list(c.items).filter(cites).slice(0, 100)
      .map((x) => ({ text: str(x.text, 300), label: str(x.label, 60) ?? '', line: x.line as number }))
      .filter((x): x is { text: string; label: string; line: number } => !!x.text);
    return items.length ? [{ kind: c.kind, title, columns: [], rows: [], items }] : [];
  });

  const seen = new Set<string>();
  const entities = list(raw?.entities).flatMap((e): Entity[] => {
    const text = str(e?.text, 80);
    const line = byIdx.get(e?.line);
    if (!text || line == null || !TYPES.includes(e.type)) return [];
    if (!(isMe(text) ? SPEAKER.test(line) : line.toLowerCase().includes(text.toLowerCase()))) return [];
    const key = `${e.line}:${text.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ text: isMe(text) ? 'Me' : text, type: e.type, line: e.line }];
  }).slice(0, 300)
    // "week" inside "next week" on the same line is the same mention.
    .filter((e, _, all) => !all.some((o) => o !== e && o.line === e.line && o.text.length > e.text.length
      && o.text.toLowerCase().includes(e.text.toLowerCase())));

  // A relation stands only if both ends are entities we kept and both
  // appear in the line it cites.
  const known = new Map(entities.map((e) => [e.text.toLowerCase(), e.text]));
  const rels = new Set<string>();
  const relations = list(raw?.relations).flatMap((r): Relation[] => {
    const from = known.get(String(r?.from ?? '').toLowerCase());
    const to = known.get(String(r?.to ?? '').toLowerCase());
    const line = byIdx.get(r?.line)?.toLowerCase();
    const label = str(r?.label, 30);
    if (!from || !to || from === to || !label || !line) return [];
    const inLine = (t: string) => (isMe(t) ? SPEAKER.test(line) : line.includes(t.toLowerCase()));
    if (!inLine(from) || !inLine(to)) return [];
    const key = `${from}|${label}|${to}`.toLowerCase();
    if (rels.has(key)) return [];
    rels.add(key);
    return [{ from, to, label, line: r.line }];
  }).slice(0, 200);

  return { cards, entities, relations };
}
