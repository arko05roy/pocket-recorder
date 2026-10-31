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

export interface Answer {
  parts: AnswerPart[];
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
