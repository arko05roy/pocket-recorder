import type { Citation, Doc, DocSection } from '../types';
import { ask, textOf } from './claude';
import { getRecording, insertDoc, listDocs } from './db';
import { fmtTime } from '../format';

// After a voice note is stopped, the whole transcript goes to Claude in one
// request, which must answer with the doc as JSON. No agent loop, no
// deciding whether to: every finished voice note becomes a draft on /docs.

const SYSTEM = `You turn one voice note into a document the speaker can edit and print.

Return it as JSON with a title and sections:
- A clear title.
- Sections with short headings in a sensible order for what the note is about (meeting notes, a plan, a report, a doc they need to prepare, an order, and so on).
- Put everything that was actually said into the right section, cleaned up into plain sentences. Use "- " at the start of a line for bullet points, e.g. action items.
- If they describe a document they still need to write, also lay out the sections it needs, each body saying in a line what belongs there, starting "To fill in:".
- Never invent facts, names, numbers or findings. Speech-to-text mistakes may appear; keep wording close to what was said when unsure.
- Plain text only: no markdown symbols like # or **.`;

// Structured output: the reply must be JSON in exactly this shape. (Opus 5.5
// doesn't allow forcing a particular tool call, so this replaces that.)
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
        required: ['heading', 'body'],
      },
    },
  },
  required: ['title', 'sections'],
};

export async function docFromVoice(recordingId: string, transcript: string): Promise<Doc> {
  // Once per recording: a retry or a second tab gets the same doc back.
  const existing = listDocs().find((d) => d.sources.some((s) => s.recording_id === recordingId));
  if (existing) return existing;

  const res = await ask({
    system: SYSTEM,
    messages: [{ role: 'user', content: `The voice note:\n\n${transcript}` }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  const input = JSON.parse(textOf(res) || '{}') as { title?: unknown; sections?: unknown };
  const title = String(input.title ?? '').trim().slice(0, 160) || 'Voice note';
  const sections: DocSection[] = (Array.isArray(input.sections) ? input.sections : [])
    .map((s: any) => ({ heading: String(s?.heading ?? '').trim().slice(0, 160), body: String(s?.body ?? '').trim().slice(0, 8000) }))
    .filter((s) => s.heading || s.body)
    .slice(0, 30);
  if (!sections.length) throw new Error('Claude returned an empty document');

  const rec = getRecording(recordingId);
  const sources: Citation[] = rec
    ? [{ recording_id: rec.id, label: rec.title ?? `${rec.device_id} ${fmtTime(rec.recorded_at)}`, recorded_at: rec.recorded_at, start_s: 0 }]
    : [];
  return insertDoc(title, sections, sources);
}
