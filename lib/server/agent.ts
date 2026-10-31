import type { Answer, AnswerPart, Citation, Proposal } from '../types';
import { fmtClock, fmtTime } from '../format';
import { checkDraft, checkEvent } from './actions';
import {
  getActionItems, getMentions, getRecording, getSegments, listAllActionItems, listDrafts, listEvents, listRecordings,
  searchSegmentsAny,
} from './db';
import { chatWithTools, type ChatMessage } from './groq';

const MAX_STEPS = 6;
const NO_EVIDENCE = "The recordings don't say.";

const SOURCE = {
  type: 'object',
  description: 'Where this was said: a recording_id and t exactly as a tool returned them',
  properties: { recording_id: { type: 'string' }, t: { type: 'number' } },
  required: ['recording_id', 't'],
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_transcripts',
      description: 'Full-text search over every transcript line. Returns matching lines with recording id and start time. Try several phrasings or synonyms if the first finds nothing.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Keywords, e.g. "budget review deadline"' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recordings',
      description: 'List recordings (id, date and time, title, summary), newest first. Optionally only those recorded between two dates.',
      parameters: {
        type: 'object',
        properties: {
          // The model sends null for filters it doesn't use; Groq rejects that
          // unless the schema allows it.
          from: { type: ['string', 'null'], description: 'YYYY-MM-DD, inclusive' },
          to: { type: ['string', 'null'], description: 'YYYY-MM-DD, inclusive' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recording',
      description: 'One recording in full: summary, action items, meetings, dates, people and the whole timestamped transcript.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_action_items',
      description: 'Action items across all recordings, with who, what, due date and the moment they were said.',
      parameters: {
        type: 'object',
        properties: { status: { type: ['string', 'null'], enum: ['open', 'done', null] } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_saved',
      description: 'Calendar events and email drafts the user has already confirmed, each with the recording moment it came from.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_event',
      description: 'Suggest a calendar event. This saves nothing: the user sees a card and decides. Only for a meeting or deadline actually said in a recording.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          start_time: { type: ['string', 'null'], description: 'HH:MM 24-hour, or null if no time was said' },
          end_time: { type: ['string', 'null'], description: 'HH:MM, or null if no end was said' },
          attendees: { type: ['array', 'null'], items: { type: 'string' }, description: 'Names as said in the recording' },
          source: SOURCE,
        },
        required: ['title', 'date', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_draft',
      description: 'Suggest an email draft. This saves nothing and never sends: the user sees a card and decides.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient name or address as said in the recording' },
          subject: { type: 'string' },
          body: { type: 'string' },
          source: SOURCE,
        },
        required: ['to', 'subject', 'body', 'source'],
      },
    },
  },
];

const systemPrompt = (today: string) => `You answer questions about the user's voice recordings. Today is ${today}.

Use the tools to find the answer. Base every statement only on what the tools return; never on outside knowledge or guesses.

Cite every fact with a marker right after it, in the form [[RECORDING_ID@SECONDS]], using a recording id and a t= value exactly as a tool returned them. Example: The review moved to Friday [[rec-01_2026-11-05T14-32-10@41.2]]. For facts about a recording as a whole, such as when it was made or how long it is, cite it at 0.

When the user asks to put something in the calendar or draft an email, first find where it was said, then call propose_event or propose_draft. Proposing saves nothing; tell the user to confirm the card below, and cite the source. Never claim anything was saved or sent. Dates must come from the recordings; if a date or time was never said, don't invent one: leave the time null, or say the recordings don't give a date.

If the tools don't contain the answer, reply exactly: The recordings don't say.

Keep answers short and plain. No markdown tables or headings.`;

// Every (recording, second) a tool showed the model. Citations must land on one.
type Evidence = Map<string, number[]>;

const note = (ev: Evidence, id: string, t: number) => {
  const list = ev.get(id) ?? [];
  list.push(t);
  ev.set(id, list);
};

const t1 = (s: number) => Math.round(s * 10) / 10;

function runTool(name: string, args: any, ev: Evidence, proposals: Proposal[]): unknown {
  switch (name) {
    case 'search_transcripts': {
      const hits = searchSegmentsAny(String(args.query ?? ''));
      hits.forEach((h) => note(ev, h.recording_id, h.start_s));
      if (!hits.length) return { results: [], note: 'No matching lines.' };
      return {
        results: hits.map((h) => ({
          recording_id: h.recording_id, recorded_at: h.recorded_at, title: h.title,
          t: t1(h.start_s), text: h.text,
        })),
      };
    }
    case 'list_recordings': {
      const from = typeof args.from === 'string' ? args.from : '';
      const to = typeof args.to === 'string' ? args.to : '';
      const recs = listRecordings().filter((r) => {
        const day = r.recorded_at.slice(0, 10);
        return (!from || day >= from) && (!to || day <= to);
      });
      // Facts about a recording as a whole (its date, length) are cited at 0.
      recs.forEach((r) => note(ev, r.id, 0));
      return recs.map((r) => ({
        id: r.id, recorded_at: r.recorded_at, title: r.title, status: r.status,
        length: fmtClock((r.duration_ms ?? 0) / 1000), summary: getRecording(r.id)?.summary ?? null,
      }));
    }
    case 'get_recording': {
      const rec = getRecording(String(args.id ?? ''));
      if (!rec) return { error: 'No recording with that id. Use list_recordings or search_transcripts to find ids.' };
      const segments = getSegments(rec.id);
      const items = getActionItems(rec.id);
      const mentions = getMentions(rec.id);
      segments.forEach((s) => note(ev, rec.id, s.start_s));
      items.forEach((i) => note(ev, rec.id, i.source_s));
      mentions.forEach((m) => note(ev, rec.id, m.source_s));
      return {
        id: rec.id, recorded_at: rec.recorded_at, device_id: rec.device_id, status: rec.status,
        title: rec.title, summary: rec.summary,
        action_items: items.map((i) => ({ who: i.who, what: i.what, due: i.due_date ?? i.due_text, status: i.status, t: t1(i.source_s) })),
        mentions: mentions.map((m) => ({ kind: m.kind, value: m.value, detail: m.detail, date: m.date, time: m.time, t: t1(m.source_s) })),
        transcript: segments.map((s) => `t=${t1(s.start_s)} ${s.text}`).join('\n'),
      };
    }
    case 'list_action_items': {
      const status = args.status === 'open' || args.status === 'done' ? args.status : undefined;
      const items = listAllActionItems(status);
      items.forEach((i) => note(ev, i.recording_id, i.source_s));
      return items.map((i) => ({
        recording_id: i.recording_id, recorded_at: i.recorded_at, title: i.title,
        who: i.who, what: i.what, due: i.due_date ?? i.due_text, status: i.status, t: t1(i.source_s),
      }));
    }
    case 'list_saved': {
      const events = listEvents();
      const drafts = listDrafts();
      [...events, ...drafts].forEach((x) => note(ev, x.source.recording_id, x.source.start_s));
      const src = (c: Citation) => ({ recording_id: c.recording_id, t: t1(c.start_s) });
      return {
        events: events.map((e) => ({ title: e.title, date: e.date, start_time: e.start_time, end_time: e.end_time, attendees: e.attendees, source: src(e.source) })),
        drafts: drafts.map((d) => ({ to: d.to, subject: d.subject, body: d.body, source: src(d.source) })),
      };
    }
    case 'propose_event':
    case 'propose_draft': {
      // The source has to be a moment a tool already showed the model.
      const check = (id: string, t: number) => snap(ev, id, t);
      const result = name === 'propose_event' ? checkEvent(args, check) : checkDraft(args, check);
      if (!result.ok) return { error: result.error };
      proposals.push(result.value);
      return { proposed: true, note: 'Shown to the user as a card. Nothing is saved until they press Confirm.' };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

// The evidence moment nearest to what the model wrote, if one is within 1.5 s.
function snap(ev: Evidence, id: string, t: number) {
  let best: number | null = null;
  for (const s of ev.get(id) ?? []) {
    if (Math.abs(s - t) <= 1.5 && (best == null || Math.abs(s - t) < Math.abs(best - t))) best = s;
  }
  return best;
}

// Split the reply into text and citations. A marker that doesn't point at
// something a tool returned is dropped, so a made-up citation never shows.
function toParts(raw: string, ev: Evidence): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const seen = new Set<string>();
  let last = 0;
  for (const m of raw.matchAll(/\[\[([^\]@\s]+)@(\d+(?:\.\d+)?)\]\]/g)) {
    if (m.index > last) parts.push({ type: 'text', text: raw.slice(last, m.index) });
    last = m.index + m[0].length;
    const start = snap(ev, m[1], Number(m[2]));
    const rec = start == null ? undefined : getRecording(m[1]);
    const key = `${m[1]}@${start}`;
    if (!rec || start == null || seen.has(key)) continue;
    seen.add(key);
    const cite: Citation = {
      recording_id: rec.id,
      label: rec.title ?? `${rec.device_id} ${fmtTime(rec.recorded_at)}`,
      recorded_at: rec.recorded_at,
      start_s: start,
    };
    parts.push({ type: 'cite', cite });
  }
  if (last < raw.length) parts.push({ type: 'text', text: raw.slice(last) });
  return parts;
}

export async function ask(history: { role: 'user' | 'assistant'; content: string }[]): Promise<Answer> {
  const ev: Evidence = new Map();
  const proposals: Proposal[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(new Date().toISOString().slice(0, 10)) },
    ...history.slice(-12),
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await chatWithTools({ messages, tools: TOOLS });
    if (!reply.tool_calls?.length) {
      const raw = (reply.content ?? '').trim();
      const parts = toParts(raw, ev);
      // An answer with no citation that survived the check has no evidence
      // behind it, whatever it claims. Refuse instead of passing it on.
      // A proposal counts as evidence: it only exists if its source checked out.
      if (!proposals.length && !parts.some((p) => p.type === 'cite')) {
        return { raw: NO_EVIDENCE, parts: [{ type: 'text', text: NO_EVIDENCE }], proposals: [] };
      }
      return { raw, parts, proposals };
    }
    messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      let result: unknown;
      try {
        result = runTool(call.function.name, JSON.parse(call.function.arguments || '{}'), ev, proposals);
      } catch (err) {
        result = { error: `Tool failed: ${(err as Error).message}` };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  const raw = "I couldn't finish looking that up. Try a narrower question.";
  return { raw, parts: [{ type: 'text', text: raw }], proposals: [] };
}
