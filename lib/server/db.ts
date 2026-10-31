import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ActionItem, Mention, RecordingDetail, RecordingSummary, SearchHit, Segment, Status,
} from '../types';

export const DATA_DIR = join(process.cwd(), 'data');
export const AUDIO_DIR = join(DATA_DIR, 'audio');

export interface RecordingRow {
  id: string;
  device_id: string;
  recorded_at: string;
  duration_ms: number | null;
  battery_pct: number | null;
  file_path: string;
  status: Status;
  error: string | null;
  title: string | null;
  summary: string | null;
}

// Next.js can load this module more than once (hot reload in dev, separate
// bundles for routes and instrumentation). Keep one connection on globalThis.
const g = globalThis as unknown as { __db?: DatabaseSync };
export const db = g.__db ??= open();

function open() {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const conn = new DatabaseSync(join(DATA_DIR, 'app.db'));
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS recordings (
      id          TEXT PRIMARY KEY,
      device_id   TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      duration_ms INTEGER,
      battery_pct INTEGER,
      file_path   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'received',
      error       TEXT,
      summary     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS segments (
      id           INTEGER PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      idx          INTEGER NOT NULL,
      start_s      REAL NOT NULL,
      end_s        REAL NOT NULL,
      text         TEXT NOT NULL,
      UNIQUE (recording_id, idx)
    );

    -- Full-text index over segment text. content= means it reads text from
    -- segments instead of storing a second copy; the triggers keep it in sync.
    CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
      text, content='segments', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
      INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;

    CREATE TABLE IF NOT EXISTS action_items (
      id           INTEGER PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      who          TEXT,
      what         TEXT NOT NULL,
      due_text     TEXT,
      due_date     TEXT,
      source_s     REAL NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done'))
    );

    -- People, meetings and dates mentioned in a recording.
    CREATE TABLE IF NOT EXISTS mentions (
      id           INTEGER PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL CHECK (kind IN ('person', 'meeting', 'date')),
      value        TEXT NOT NULL,
      detail       TEXT,
      date         TEXT,
      time         TEXT,
      source_s     REAL NOT NULL
    );
  `);

  // Columns added after the first version of the table. ALTER TABLE has no
  // IF NOT EXISTS, so check the table's columns first.
  const columns = conn.prepare('PRAGMA table_info(recordings)').all().map((c) => c.name);
  if (!columns.includes('title')) conn.exec('ALTER TABLE recordings ADD COLUMN title TEXT');
  return conn;
}

// node:sqlite returns rows with a null prototype. Next.js only passes plain
// objects from server to client components, so copy each row as it leaves here.
const plain = <T,>(row: unknown) => ({ ...(row as object) }) as T;

function transaction(fn: () => void) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getRecording(id: string) {
  const row = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  return row ? plain<RecordingRow>(row) : undefined;
}

export function insertRecording(r: Pick<RecordingRow, 'id' | 'device_id' | 'recorded_at' | 'duration_ms' | 'battery_pct' | 'file_path'>) {
  db.prepare(`
    INSERT INTO recordings (id, device_id, recorded_at, duration_ms, battery_pct, file_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(r.id, r.device_id, r.recorded_at, r.duration_ms, r.battery_pct, r.file_path);
}

export function setStatus(id: string, status: Status, error: string | null = null) {
  db.prepare('UPDATE recordings SET status = ?, error = ? WHERE id = ?').run(status, error, id);
}

export function setDuration(id: string, duration_ms: number) {
  db.prepare('UPDATE recordings SET duration_ms = ? WHERE id = ?').run(duration_ms, id);
}

// Replace all segments for a recording in one transaction, so a re-run
// never leaves half old, half new.
export function saveSegments(recordingId: string, segments: { start: number; end: number; text: string }[]) {
  const del = db.prepare('DELETE FROM segments WHERE recording_id = ?');
  const ins = db.prepare(
    'INSERT INTO segments (recording_id, idx, start_s, end_s, text) VALUES (?, ?, ?, ?, ?)'
  );
  transaction(() => {
    del.run(recordingId);
    segments.forEach((s, i) => ins.run(recordingId, i, s.start, s.end, s.text));
  });
}

export interface Analysis {
  title: string | null;
  summary: string | null;
  action_items: Omit<ActionItem, 'id' | 'status'>[];
  mentions: Mention[];
}

// Replace a recording's analysis in one go, like saveSegments.
export function saveAnalysis(recordingId: string, a: Analysis) {
  const insItem = db.prepare(`
    INSERT INTO action_items (recording_id, who, what, due_text, due_date, source_s)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insMention = db.prepare(`
    INSERT INTO mentions (recording_id, kind, value, detail, date, time, source_s)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  transaction(() => {
    db.prepare('DELETE FROM action_items WHERE recording_id = ?').run(recordingId);
    db.prepare('DELETE FROM mentions WHERE recording_id = ?').run(recordingId);
    db.prepare('UPDATE recordings SET title = ?, summary = ? WHERE id = ?').run(a.title, a.summary, recordingId);
    for (const i of a.action_items) insItem.run(recordingId, i.who, i.what, i.due_text, i.due_date, i.source_s);
    for (const m of a.mentions) insMention.run(recordingId, m.kind, m.value, m.detail, m.date, m.time, m.source_s);
  });
}

export function getActionItems(recordingId: string) {
  return db.prepare(
    'SELECT id, who, what, due_text, due_date, source_s, status FROM action_items WHERE recording_id = ? ORDER BY source_s'
  ).all(recordingId).map(plain<ActionItem>);
}

export function getMentions(recordingId: string) {
  return db.prepare(
    'SELECT kind, value, detail, date, time, source_s FROM mentions WHERE recording_id = ? ORDER BY source_s'
  ).all(recordingId).map(plain<Mention>);
}

export function setActionItemStatus(id: number, status: 'open' | 'done') {
  return Number(db.prepare('UPDATE action_items SET status = ? WHERE id = ?').run(status, id).changes);
}

export function getSegments(recordingId: string) {
  return db.prepare(
    'SELECT idx, start_s, end_s, text FROM segments WHERE recording_id = ? ORDER BY idx'
  ).all(recordingId).map(plain<Segment>);
}

// Everything the recording page needs, minus the server's file path.
export function getRecordingDetail(id: string): RecordingDetail | null {
  const rec = getRecording(id);
  if (!rec) return null;
  const { file_path, ...rest } = rec;
  return {
    ...rest,
    segments: getSegments(id),
    action_items: getActionItems(id),
    mentions: getMentions(id),
  };
}

export function listRecordings() {
  return db.prepare(`
    SELECT r.id, r.device_id, r.recorded_at, r.duration_ms, r.battery_pct, r.status, r.error, r.title,
           (SELECT text FROM segments WHERE recording_id = r.id ORDER BY idx LIMIT 1) AS preview,
           (SELECT count(*) FROM segments WHERE recording_id = r.id) AS segment_count
    FROM recordings r
    ORDER BY r.recorded_at DESC
  `).all().map(plain<RecordingSummary>);
}

// Turn what the user typed into a safe FTS5 query: every word is quoted (so
// characters like - or " can't break the syntax) and the last word matches as
// a prefix, so results appear while typing.
function ftsQuery(input: string) {
  const words = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(' ');
}

// \u0002 and \u0003 mark the matched words. The browser renders them as <mark>
// without ever treating transcript text as HTML.
export function searchSegments(input: string, limit = 50) {
  const query = ftsQuery(input);
  if (!query) return [];
  return db.prepare(`
    SELECT s.recording_id, s.idx, s.start_s, s.end_s,
           snippet(segments_fts, 0, char(2), char(3), '…', 14) AS snippet,
           r.recorded_at, r.device_id
    FROM segments_fts
    JOIN segments s   ON s.id = segments_fts.rowid
    JOIN recordings r ON r.id = s.recording_id
    WHERE segments_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit).map(plain<SearchHit>);
}

// Recordings left mid-pipeline by a crash or restart.
export function unfinishedRecordingIds() {
  return db.prepare(
    "SELECT id FROM recordings WHERE status NOT IN ('ready', 'error') ORDER BY recorded_at"
  ).all().map((r) => r.id as string);
}
