import type { CleanTurn, LiveLine, Recap } from '../types';
import { ask, FAST_MODEL, textOf } from './claude';

// Step 1 (Sonnet): the live transcript, cleaned. Live chunks are cut every
// ~3 s, so sentences break mid-way, words get misheard and lines repeat.
const CLEAN = `You clean up a live speech-to-text transcript so it reads well.
- Join pieces that belong to one sentence; fix punctuation, capitalisation and obvious mishearings from context.
- Remove filler ("um", "uh"), false starts and lines repeated by mistake.
- Keep the speaker's own words and meaning. Never add, summarise or reorder content. Keep the language and script spoken (English, Hindi, Bengali, mixed).
- Split it into readable paragraphs, one per topic or instruction. Set speaker to 0 on every paragraph.`;

const CLEAN_SCHEMA = {
  type: 'object',
  properties: {
    turns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { speaker: { type: 'integer', enum: [0, 1] }, text: { type: 'string' } },
        required: ['speaker', 'text'], additionalProperties: false,
      },
    },
  },
  required: ['turns'], additionalProperties: false,
};

export async function cleanTranscript(lines: LiveLine[]): Promise<CleanTurn[]> {
  const transcript = lines.map((l) => l.text).join('\n');
  const res = await ask({
    model: FAST_MODEL,
    system: CLEAN,
    messages: [{ role: 'user', content: transcript }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: CLEAN_SCHEMA } },
  });
  const raw = JSON.parse(textOf(res));
  return (Array.isArray(raw?.turns) ? raw.turns : [])
    .filter((t: any) => typeof t?.text === 'string' && t.text.trim())
    .map((t: any) => ({ speaker: t.speaker === 1 ? 1 : 0, text: t.text.trim().slice(0, 4000) }))
    .slice(0, 300);
}

// Step 2 (Opus): the report shown on screen once recording stops.
const REPORT = `You write the report a professional would want right after a meeting, call or voice note, from its cleaned transcript.
The person recording is speaker 0; call them "You" unless their name is said.
- title: specific, under 8 words ("Q3 expense review and product sync", not "Meeting").
- kind: what this was, in 1-3 words.
- summary: 2-4 sentences, plain and concrete: what it was about and what came out of it.
- participants: the people named or taking part (speaker 0 for the person recording, 1 for anyone else); role is what they do here in a few words.
- key_points: the important things said, each one sentence. decisions: what was settled.
- action_items: every task. owner as said ("You" for the recorder), due as said, priority from urgency and stakes.
- timeline: dated or timed things in time order. numbers: figures said, with units as said.
- tables: every structured list said (orders, items and quantities, prices, attendees, inventory, schedules), one table each, with short column names and one row per entry. Always include one if a table, sheet, spreadsheet or CSV is asked for. Leave a cell empty if not said.
- open_questions: what was left unresolved. next_steps: what should happen next, in order.
Use only what was said; leave a list empty rather than pad it. Where something was corrected, use the corrected version. No markdown.`;

const list = (items: object) => ({ type: 'array', items });
const STR = { type: 'string' };
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    title: STR, kind: STR, summary: STR,
    participants: list({ type: 'object', properties: { speaker: { type: 'integer', enum: [0, 1] }, name: STR, role: STR }, required: ['speaker', 'name', 'role'], additionalProperties: false }),
    key_points: list(STR), decisions: list(STR),
    action_items: list({ type: 'object', properties: { task: STR, owner: STR, due: STR, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['task', 'owner', 'due', 'priority'], additionalProperties: false }),
    timeline: list({ type: 'object', properties: { when: STR, what: STR }, required: ['when', 'what'], additionalProperties: false }),
    numbers: list({ type: 'object', properties: { value: STR, label: STR }, required: ['value', 'label'], additionalProperties: false }),
    tables: list({ type: 'object', properties: { title: STR, columns: list(STR), rows: list(list(STR)) }, required: ['title', 'columns', 'rows'], additionalProperties: false }),
    open_questions: list(STR), next_steps: list(STR),
  },
  required: ['title', 'kind', 'summary', 'participants', 'key_points', 'decisions', 'action_items', 'timeline', 'numbers', 'tables', 'open_questions', 'next_steps'],
  additionalProperties: false,
};

const s = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const strs = (v: unknown, n = 20) => (Array.isArray(v) ? v.map((x) => s(x, 400)).filter(Boolean).slice(0, n) : []);
const objs = (v: unknown): any[] => (Array.isArray(v) ? v.slice(0, 30) : []);

export async function writeReport(turns: CleanTurn[], recordedAt: string): Promise<Recap> {
  const transcript = turns.map((t) => `[speaker ${t.speaker}] ${t.text}`).join('\n\n');
  const res = await ask({
    system: REPORT,
    messages: [{ role: 'user', content: `Recorded ${recordedAt}.\n\n${transcript}` }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPORT_SCHEMA } },
  });
  const r = JSON.parse(textOf(res));
  return {
    title: s(r.title, 100) || 'Voice note',
    kind: s(r.kind, 40),
    summary: s(r.summary, 1200),
    participants: objs(r.participants).map((p) => ({ speaker: p.speaker === 1 ? 1 : 0, name: s(p.name, 60), role: s(p.role, 120) })).filter((p) => p.name),
    key_points: strs(r.key_points),
    decisions: strs(r.decisions),
    action_items: objs(r.action_items).map((a) => ({
      task: s(a.task, 300), owner: s(a.owner, 60), due: s(a.due, 60),
      priority: (['high', 'medium', 'low'].includes(a.priority) ? a.priority : 'medium') as 'high' | 'medium' | 'low',
    })).filter((a) => a.task),
    timeline: objs(r.timeline).map((t) => ({ when: s(t.when, 60), what: s(t.what, 300) })).filter((t) => t.what),
    numbers: objs(r.numbers).map((x) => ({ value: s(x.value, 40), label: s(x.label, 120) })).filter((x) => x.value),
    tables: objs(r.tables).slice(0, 6).map((t) => {
      const columns = strs(t.columns, 12).map((c) => c.slice(0, 40));
      const rows = objs(t.rows).slice(0, 200).map((row) => columns.map((_, n) => s(Array.isArray(row) ? row[n] : '', 200)));
      return { title: s(t.title, 80) || 'Table', columns, rows: rows.filter((row) => row.some(Boolean)) };
    }).filter((t) => t.columns.length && t.rows.length),
    open_questions: strs(r.open_questions),
    next_steps: strs(r.next_steps),
  };
}
