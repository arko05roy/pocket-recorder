import { chatJson } from './groq';
import { date, str, time } from './validate';
import type { Analysis } from './db';
import type { Mention, Segment } from '../types';

const SYSTEM = `You read meeting transcripts for a busy founder and extract what they need to act on.

The transcript is given as numbered lines: [line] mm:ss text.

Rules:
- Use only what is said in the transcript. Never guess, never fill gaps with plausible details.
- Every item must cite the "line" number where it is said.
- "who" is the person responsible as named in the transcript. Use "me" if the speaker commits themself ("I'll send it"). Use null if nobody is named.
- Resolve relative dates ("Thursday", "next week", "tomorrow") against the recording date given below. If you cannot resolve to a specific day, set the date to null and keep the original words in the *_text field.
- Use 24-hour "HH:MM" for times, or null.
- If the transcript has no substantive content, return an empty title and summary and empty lists.

Return JSON with exactly this shape:
{
  "title": "3 to 6 word topic of the recording",
  "summary": "2 to 3 plain sentences on what was discussed and decided",
  "action_items": [{"who": string|null, "what": string, "due_text": string|null, "due_date": "YYYY-MM-DD"|null, "line": number}],
  "meetings": [{"what": string, "when_text": string, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "line": number}],
  "dates": [{"what": string, "when_text": string, "date": "YYYY-MM-DD"|null, "line": number}],
  "people": [{"name": string, "role": string|null, "line": number}]
}
"meetings" are planned meetings or calls. "dates" are other dates mentioned: deadlines, deliveries, events.`;

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function analyse(recording: { recorded_at: string }, segments: Segment[]) {
  // The weekday of the device's own calendar date, so "Thursday" resolves
  // the way the speaker meant it, whatever zone this server runs in.
  const [y, m, d] = recording.recorded_at.slice(0, 10).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const transcript = segments.map((s) => `[${s.idx}] ${fmt(s.start_s)} ${s.text}`).join('\n');
  const raw = await chatJson({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Recorded: ${day}, at ${recording.recorded_at.slice(11, 16)} (${recording.recorded_at})\n\nTranscript:\n${transcript}` },
    ],
  });
  return clean(raw, segments);
}

// ---------- validation: the model's output is untrusted ----------

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

// Keep an item only if it cites a line that exists. The timestamp always
// comes from our own segment, never from the model.
export function clean(raw: any, segments: Segment[]): Analysis & { dropped: number } {
  const byIdx = new Map(segments.map((s) => [s.idx, s]));
  const cite = (item: any) => byIdx.get(Number(item?.line));
  let dropped = 0;
  const keep = <T,>(items: unknown, build: (item: any) => T | null | false | '') =>
    list(items).flatMap((item): (T & { source_s: number })[] => {
    const seg = cite(item);
    const out = seg && build(item);
    if (!out) { dropped++; return []; }
    return [{ ...out, source_s: seg.start_s }];
  });

  const result: Analysis = {
    title: str(raw?.title, 80),
    summary: str(raw?.summary, 1200),
    action_items: keep(raw?.action_items, (i) => str(i.what) && {
      who: str(i.who, 80), what: str(i.what)!, due_text: str(i.due_text, 80), due_date: date(i.due_date),
    }),
    mentions: [
      ...keep(raw?.meetings, (i) => str(i.what) && {
        kind: 'meeting' as const, value: str(i.what)!, detail: str(i.when_text, 80), date: date(i.date), time: time(i.time),
      }),
      ...keep(raw?.dates, (i) => str(i.what) && {
        kind: 'date' as const, value: str(i.what)!, detail: str(i.when_text, 80), date: date(i.date), time: null,
      }),
      ...dedupePeople(keep(raw?.people, (i) => str(i.name, 80) && {
        kind: 'person' as const, value: str(i.name, 80)!, detail: str(i.role, 80), date: null, time: null,
      })),
    ],
  };
  return { ...result, dropped };
}

// The same person is often mentioned several times; keep the first mention.
function dedupePeople(people: Mention[]) {
  const seen = new Set<string>();
  return people.filter((p) => {
    const key = p.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
