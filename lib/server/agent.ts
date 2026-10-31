import type Anthropic from '@anthropic-ai/sdk';
import type { Answer, AnswerPart, Citation, Doc, DocSection, NodeProfile, Proposal } from '../types';
import { fmtClock, fmtTime } from '../format';
import { checkDraft, checkEvent, checkPrint } from './actions';
import {
  getActionItems, getMentions, getNodeProfile, getRecording, getSegments, insertDoc, listAllActionItems, listDrafts, listEvents, listRecordings,
  searchSegmentsAny,
} from './db';
import { ask as askClaude, textOf } from './claude';
import { date } from './validate';

// Dates are plain YYYY-MM-DD strings; all arithmetic runs in UTC so the
// server's own zone can't shift a day.
const DAY = 86_400_000;
const toDay = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekday = (s: string) => new Date(toDay(s)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
// Today on the machine's own clock, not UTC: at 1am local, UTC can still be yesterday.
const todayLocal = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

function calendar(from: string) {
  const base = toDay(from);
  const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * DAY;
  const week = (n: number) => ({ from: iso(monday + n * 7 * DAY), to: iso(monday + (n * 7 + 6) * DAY) });
  const days = [];
  for (let t = monday - 7 * DAY; t <= monday + 34 * DAY; t += DAY) {
    const d = iso(t);
    const rel = t === base ? 'today' : t === base + DAY ? 'tomorrow' : t === base - DAY ? 'yesterday' : undefined;
    days.push(rel ? `${d} ${weekday(d)} (${rel})` : `${d} ${weekday(d)}`);
  }
  const [y, m] = from.split('-').map(Number);
  return {
    relative_to: `${from} ${weekday(from)}`,
    this_week: week(0), next_week: week(1), week_after_next: week(2),
    end_of_month: iso(Date.UTC(y, m, 0)),
    days,
  };
}

const MAX_STEPS = 6;
const NO_EVIDENCE = "The recordings don't say.";

const SOURCE = {
  type: 'object',
  description: 'Where this was said: a recording_id and t exactly as a tool returned them',
  properties: { recording_id: { type: 'string' }, t: { type: 'number' } },
  required: ['recording_id', 't'],
};

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'calendar',
    description: 'A day-by-day calendar with weekdays, starting the week before a date and running five weeks on, with "this week", "next week" and "the week after" ranges (weeks run Monday to Sunday). Use it to turn words like "tomorrow", "Thursday", "next week" or "end of the month" into a YYYY-MM-DD date. Never work out dates in your head.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: ['string', 'null'], description: 'YYYY-MM-DD the words are relative to: the recording date if the words were said in a recording, otherwise today. Defaults to today.' },
      },
    },
  },
  {
    name: 'search_transcripts',
    description: 'Full-text search over every transcript line. Returns matching lines with recording id and start time. Try several phrasings or synonyms if the first finds nothing.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keywords, e.g. "budget review deadline"' } },
      required: ['query'],
    },
  },
  {
    name: 'list_recordings',
    description: 'List recordings (id, date and time, title, summary), newest first. Optionally only those recorded between two dates.',
    input_schema: {
      type: 'object',
      properties: {
        // The model sends null for filters it doesn't use; Groq rejects that
        // unless the schema allows it.
        from: { type: ['string', 'null'], description: 'YYYY-MM-DD, inclusive' },
        to: { type: ['string', 'null'], description: 'YYYY-MM-DD, inclusive' },
      },
    },
  },
  {
    name: 'get_recording',
    description: 'One recording in full: summary, action items, meetings, dates, people and the whole timestamped transcript.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_action_items',
    description: 'Action items across all recordings, with who, what, due date and the moment they were said.',
    input_schema: {
      type: 'object',
      properties: { status: { type: ['string', 'null'], enum: ['open', 'done', null] } },
    },
  },
  {
    name: 'list_saved',
    description: 'Calendar events and email drafts the user has already confirmed, each with the recording moment it came from.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'lookup_graph',
    description: 'The knowledge graph built from everything said in chats: one person, organisation, place or thing, with how it connects to others (e.g. "boss of", "works at") and the sentences those came from. Use it for questions about who someone is or how people relate. The result is shown to the user as a card.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name as said, e.g. "Paruk"' } },
      required: ['name'],
    },
  },
  {
    name: 'propose_event',
    description: 'Suggest a calendar event. This saves nothing: the user sees a card and decides. Only for a meeting or deadline actually said in a recording.',
    input_schema: {
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
  {
    name: 'propose_draft',
    description: 'Suggest an email draft. This saves nothing and never sends: the user sees a card and decides.',
    input_schema: {
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
  {
    name: 'create_doc',
    description: 'Write a structured document (title plus sections, each with a heading and body) and save it as a draft on the Docs page. Use it whenever the user asks for a doc, document, write-up, report, notes, minutes, brief or summary "as a doc". Nothing prints: the user reviews it on /docs and presses Finalize & print. Facts about recordings must come from what tools returned; text the user dictated or recorded in this chat can be used as given. If the user only describes a document they need (e.g. "a doc to present our findings to the CTO"), draft its structure: the headings that document needs for that purpose and audience, each body saying in a line or two what belongs there, starting "To fill in:". Use any details they did say. Never invent facts, findings or numbers.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        sections: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              body: { type: 'string', description: 'Plain text paragraphs; use "- " at the start of a line for bullet points. No markdown headings, no citation markers.' },
            },
            required: ['heading', 'body'],
          },
        },
        sources: {
          type: 'array',
          description: 'Recording moments the document is based on, as tools returned them. Empty if it only uses what the user said in chat.',
          items: { type: 'object', properties: { recording_id: { type: 'string' }, t: { type: 'number' } }, required: ['recording_id', 't'] },
        },
      },
      required: ['title', 'sections'],
    },
  },
  {
    name: 'propose_print',
    description: 'Suggest printing a page on the office printer (via the ESP32). This prints nothing: the user sees a card and decides. Use when the user asks to print something, e.g. a summary, transcript or action items. The body must be built only from what tools returned.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Heading printed at the top' },
        body: { type: 'string', description: 'Plain text to print. No markdown, no citation markers.' },
        source: SOURCE,
      },
      required: ['title', 'body', 'source'],
    },
  },
];

const systemPrompt = (today: string) => `You answer questions about the user's voice recordings. Today is ${weekday(today)} ${today}.

Use the tools to find the answer. Base every statement only on what the tools return; never on outside knowledge or guesses.

Cite every fact with a marker right after it, in the form [[RECORDING_ID@SECONDS]], using a recording id and a t= value exactly as a tool returned them. Example: The review moved to Friday [[rec-01_2026-11-05T14-32-10@41.2]]. For facts about a recording as a whole, such as when it was made or how long it is, cite it at 0.

When the user asks to put something in the calendar or draft an email, first find where it was said, then call propose_event or propose_draft. Proposing saves nothing; tell the user to confirm the card below, and cite the source. Never claim anything was saved or sent.

Dates: relative words like "tomorrow", "Friday", "next week" or "end of the month" are real dates; resolve them with the calendar tool, never by mental arithmetic. Words said in a recording are relative to that recording's date (recorded_at); words the user types in this chat are relative to today. A date the user gives in chat is fine to use, as long as the source points at where the meeting or email was talked about. "Next week" with no day means the Monday of next week unless the recording narrows it; say which day you picked. Only if no day or week was ever given, by the recording or the user, ask the user for one instead of guessing. Leave the time null if none was said.

Drafts: write the email in the user's voice from what was said. The body can mention dates; spell them out (e.g. "Tuesday 4 November") using the calendar tool. If the recording names the person but not their address, put the name in "to".

For who-is or how-are-they-related questions, call lookup_graph; its card is shown under your answer, so answer in a sentence or two from it (the graph's facts need no citation marker).

When the user asks for a doc or document, call create_doc, then reply in one short sentence saying it's on the Docs page, ready to finalize and print. Don't repeat the document in your reply; its card shows under your answer.

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

function runTool(name: string, args: any, ev: Evidence, proposals: Proposal[], profiles: NodeProfile[], docs: Doc[], focus?: string): unknown {
  switch (name) {
    case 'create_doc': {
      const title = String(args.title ?? '').trim().slice(0, 160);
      const sections: DocSection[] = (Array.isArray(args.sections) ? args.sections : [])
        .map((s: any) => ({ heading: String(s?.heading ?? '').trim().slice(0, 160), body: String(s?.body ?? '').trim().slice(0, 8000) }))
        .filter((s: DocSection) => s.heading || s.body)
        .slice(0, 30);
      if (!title) return { error: 'title is required' };
      if (!sections.length) return { error: 'at least one section with a heading and body is required' };
      // Keep only sources that point at a moment a tool actually showed.
      const sources: Citation[] = [];
      for (const s of Array.isArray(args.sources) ? args.sources : []) {
        const start = snap(ev, String(s?.recording_id ?? ''), Number(s?.t));
        const rec = start == null ? undefined : getRecording(String(s.recording_id));
        if (!rec || start == null || sources.some((x) => x.recording_id === rec.id && x.start_s === start)) continue;
        sources.push({ recording_id: rec.id, label: rec.title ?? `${rec.device_id} ${fmtTime(rec.recorded_at)}`, recorded_at: rec.recorded_at, start_s: start });
      }
      // A doc made from the recording this chat is about is always linked to it.
      const fr = focus ? getRecording(focus) : undefined;
      if (fr && !sources.some((s) => s.recording_id === fr.id)) {
        sources.unshift({ recording_id: fr.id, label: fr.title ?? `${fr.device_id} ${fmtTime(fr.recorded_at)}`, recorded_at: fr.recorded_at, start_s: 0 });
      }
      const doc = insertDoc(title, sections, sources);
      docs.push(doc);
      return { created: true, id: doc.id, note: 'Saved as a draft on /docs and shown as a card. It prints only when the user presses Finalize & print.' };
    }
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
    case 'lookup_graph': {
      const profile = getNodeProfile(String(args.name ?? '').slice(0, 80));
      if (!profile) return { found: false, note: 'Nobody by that name in the graph. Try search_transcripts.' };
      if (!profiles.some((p) => p.id === profile.id)) profiles.push(profile);
      return { found: true, shown_as_card: true, ...profile };
    }
    case 'calendar':
      return calendar(typeof args.from === 'string' && date(args.from) ? args.from : todayLocal());
    case 'propose_event':
    case 'propose_draft':
    case 'propose_print': {
      // The source has to be a moment a tool already showed the model.
      const check = (id: string, t: number) => snap(ev, id, t);
      const result = name === 'propose_event' ? checkEvent(args, check)
        : name === 'propose_draft' ? checkDraft(args, check) : checkPrint(args, check);
      if (!result.ok) return { error: result.error };
      proposals.push(result.value);
      return { proposed: true, note: 'Shown to the user as a card. Nothing is saved or printed until they press Confirm.' };
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

// focus: the recording this chat was just made from, if any. Its pipeline may
// still be running, so the agent is told the id rather than its contents.
export async function ask(history: { role: 'user' | 'assistant'; content: string }[], focus?: string): Promise<Answer> {
  const ev: Evidence = new Map();
  const proposals: Proposal[] = [];
  const profiles: NodeProfile[] = [];
  const docs: Doc[] = [];
  const rec = focus ? getRecording(focus) : undefined;
  const system = systemPrompt(todayLocal()) + (rec
    ? `\n\nThis chat is about the recording ${rec.id} (recorded ${rec.recorded_at}). "This", "it" and "just now" refer to it; use get_recording on it first. If its status isn't ready yet, its transcript may still be filling in.`
    : '');
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12);

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await askClaude({ system, messages, tools: TOOLS });
    // The whole reply goes back into the history unchanged, thinking blocks
    // included: the API checks that earlier turns were not edited.
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'pause_turn') continue;
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!calls.length) {
      const raw = textOf(res).trim();
      const parts = toParts(raw, ev);
      // An answer with no citation that survived the check has no evidence
      // behind it, whatever it claims. Refuse instead of passing it on.
      // A proposal or a graph card counts as evidence: each only exists if
      // it came from what was actually said.
      // A document is the user's own request written up, so it counts too.
      if (!proposals.length && !profiles.length && !docs.length && !parts.some((p) => p.type === 'cite')) {
        return { raw: NO_EVIDENCE, parts: [{ type: 'text', text: NO_EVIDENCE }], proposals: [] };
      }
      return { raw, parts, proposals, profiles, docs };
    }
    // All results go back in one user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((call) => {
      try {
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(runTool(call.name, call.input ?? {}, ev, proposals, profiles, docs, focus)) };
      } catch (err) {
        return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Tool failed: ${(err as Error).message}` };
      }
    });
    messages.push({ role: 'user', content: results });
  }
  const raw = "I couldn't finish looking that up. Try a narrower question.";
  return { raw, parts: [{ type: 'text', text: raw }], proposals: [] };
}
