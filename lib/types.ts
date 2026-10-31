// Shapes shared by the server and the dashboard.

export type Status = 'received' | 'transcribing' | 'transcribed' | 'analysing' | 'ready' | 'error';

export interface RecordingSummary {
  id: string;
  device_id: string;
  recorded_at: string;
  duration_ms: number | null;
  battery_pct: number | null;
  status: Status;
  error: string | null;
  title: string | null;
  preview: string | null;
  segment_count: number;
}

export interface Segment {
  idx: number;
  start_s: number;
  end_s: number;
  text: string;
}

export interface ActionItem {
  id: number;
  who: string | null;
  what: string;
  due_text: string | null;
  due_date: string | null;
  source_s: number;
  status: 'open' | 'done';
}

export interface Mention {
  kind: 'person' | 'meeting' | 'date';
  value: string;
  detail: string | null;
  date: string | null;
  time: string | null;
  source_s: number;
}

export interface RecordingDetail {
  id: string;
  device_id: string;
  recorded_at: string;
  duration_ms: number | null;
  battery_pct: number | null;
  status: Status;
  error: string | null;
  title: string | null;
  summary: string | null;
  has_audio: boolean;
  segments: Segment[];
  action_items: ActionItem[];
  mentions: Mention[];
}

// A moment in a recording that an answer points to. Only built by the server
// from evidence a tool returned, never taken from the model as-is.
export interface Citation {
  recording_id: string;
  label: string;        // recording title, or device + time when there is none
  recorded_at: string;
  start_s: number;
}

export type AnswerPart = { type: 'text'; text: string } | { type: 'cite'; cite: Citation };

// Something the agent suggests writing. Nothing is saved until the user
// presses Confirm, and the server checks it again then.
export interface EventProposal {
  kind: 'event';
  title: string;
  date: string;              // YYYY-MM-DD
  start_time: string | null; // HH:MM; null = all day
  end_time: string | null;
  attendees: string[];
  source: Citation;
}

export interface DraftProposal {
  kind: 'draft';
  to: string;
  subject: string;
  body: string;
  source: Citation;
}

// A page to print. Sent to the ESP32, which forwards it to the network printer.
export interface PrintProposal {
  kind: 'print';
  title: string;
  body: string;
  source: Citation;
}

export type Proposal = EventProposal | DraftProposal | PrintProposal;

export type CalendarEvent = Omit<EventProposal, 'kind'> & { id: number; created_at: string };
export type EmailDraft = Omit<DraftProposal, 'kind'> & { id: number; created_at: string };

export interface Answer {
  parts: AnswerPart[];
  proposals: Proposal[];
  // People or things the answer is about, shown as cards from the graph.
  profiles?: NodeProfile[];
  // The model's raw reply, sent back as history on the next question.
  raw: string;
}

export interface SearchHit {
  recording_id: string;
  idx: number;
  start_s: number;
  end_s: number;
  snippet: string;
  recorded_at: string;
  device_id: string;
}

// What the chat shows while you record. Claude picks the cards; every row,
// item and entity cites the transcript line it came from.
export interface LiveLine {
  i: number;
  text: string;
}

export type CardKind = 'table' | 'checklist' | 'facts' | 'timeline' | 'metrics' | 'quotes';

export interface LiveCard {
  kind: CardKind;
  title: string;
  columns: string[];                          // table only
  rows: { cells: string[]; line: number }[];  // table only
  // Every other kind. label is the date (timeline), the value (metrics),
  // the key (facts) or who said it (quotes); empty for checklists.
  items: { text: string; label: string; line: number }[];
}

export type EntityType = 'person' | 'item' | 'date' | 'amount' | 'place' | 'org';

// A name or value exactly as written in its line, for highlighting.
export interface Entity {
  text: string;
  type: EntityType;
  line: number;
}

// A relationship heard between two entities, e.g. Priya —ordered→ latte.
export interface Relation {
  from: string;
  to: string;
  label: string;
  line: number;
}

export interface LiveState {
  cards: LiveCard[];
  entities: Entity[];
  relations: Relation[];
}

// The saved knowledge graph.
export interface GraphNode {
  id: number;
  name: string;
  type: EntityType;
  mentions: number;
}

export interface GraphEdge {
  id: number;
  from_id: number;
  to_id: number;
  label: string;   // reads as "from <label> to": "boss of"
  quote: string;   // the sentence it was said in
}

export interface NodeProfile extends GraphNode {
  links: { label: string; quote: string; dir: 'out' | 'in'; name: string; type: EntityType }[];
  quotes: string[];
}

// A recorder joining or leaving, pushed to every open page.
export interface DeviceEvent {
  device_id: string;
  event: 'connected' | 'disconnected';
  battery_pct: number | null;
  rssi: number | null;  // Wi-Fi signal in dBm, e.g. -55
}
