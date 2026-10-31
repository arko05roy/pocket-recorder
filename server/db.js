import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

export const DATA_DIR = 'data';
export const AUDIO_DIR = `${DATA_DIR}/audio`;
mkdirSync(AUDIO_DIR, { recursive: true });

export const db = new DatabaseSync(`${DATA_DIR}/app.db`);

db.exec(`
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
const recordingColumns = db.prepare('PRAGMA table_info(recordings)').all().map((c) => c.name);
if (!recordingColumns.includes('title')) db.exec('ALTER TABLE recordings ADD COLUMN title TEXT');

function transaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getRecording(id) {
  return db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
}

export function insertRecording(r) {
  db.prepare(`
    INSERT INTO recordings (id, device_id, recorded_at, duration_ms, battery_pct, file_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(r.id, r.device_id, r.recorded_at, r.duration_ms, r.battery_pct, r.file_path);
}

export function setStatus(id, status, error = null) {
  db.prepare('UPDATE recordings SET status = ?, error = ? WHERE id = ?').run(status, error, id);
}

export function setDuration(id, duration_ms) {
  db.prepare('UPDATE recordings SET duration_ms = ? WHERE id = ?').run(duration_ms, id);
}

// Replace all segments for a recording in one transaction, so a re-run
// never leaves half old, half new.
export function saveSegments(recordingId, segments) {
  const del = db.prepare('DELETE FROM segments WHERE recording_id = ?');
  const ins = db.prepare(
    'INSERT INTO segments (recording_id, idx, start_s, end_s, text) VALUES (?, ?, ?, ?, ?)'
  );
  transaction(() => {
    del.run(recordingId);
    segments.forEach((s, i) => ins.run(recordingId, i, s.start, s.end, s.text));
  });
}

// Replace a recording's analysis in one go, like saveSegments.
export function saveAnalysis(recordingId, a) {
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

export function getActionItems(recordingId) {
  return db.prepare(
    'SELECT id, who, what, due_text, due_date, source_s, status FROM action_items WHERE recording_id = ? ORDER BY source_s'
  ).all(recordingId);
}

export function getMentions(recordingId) {
  return db.prepare(
    'SELECT kind, value, detail, date, time, source_s FROM mentions WHERE recording_id = ? ORDER BY source_s'
  ).all(recordingId);
}

export function setActionItemStatus(id, status) {
  return db.prepare('UPDATE action_items SET status = ? WHERE id = ?').run(status, id).changes;
}

export function getSegments(recordingId) {
  return db.prepare(
    'SELECT idx, start_s, end_s, text FROM segments WHERE recording_id = ? ORDER BY idx'
  ).all(recordingId);
}

export function listRecordings() {
  return db.prepare(`
    SELECT r.id, r.device_id, r.recorded_at, r.duration_ms, r.battery_pct, r.status, r.error, r.title,
           (SELECT text FROM segments WHERE recording_id = r.id ORDER BY idx LIMIT 1) AS preview,
           (SELECT count(*) FROM segments WHERE recording_id = r.id) AS segment_count
    FROM recordings r
    ORDER BY r.recorded_at DESC
  `).all();
}

// Turn what the user typed into a safe FTS5 query: every word is quoted (so
// characters like - or " can't break the syntax) and the last word matches as
// a prefix, so results appear while typing.
function ftsQuery(input) {
  const words = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(' ');
}

// \u0002 and \u0003 mark the matched words. The browser escapes the text first
// and then turns these markers into <mark>, so transcript text never becomes HTML.
export function searchSegments(input, limit = 50) {
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
  `).all(query, limit);
}

// Recordings left mid-pipeline by a crash or restart.
export function unfinishedRecordingIds() {
  return db.prepare(
    "SELECT id FROM recordings WHERE status NOT IN ('ready', 'error') ORDER BY recorded_at"
  ).all().map((r) => r.id);
}
