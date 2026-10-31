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
`);

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
  db.exec('BEGIN');
  try {
    del.run(recordingId);
    segments.forEach((s, i) => ins.run(recordingId, i, s.start, s.end, s.text));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSegments(recordingId) {
  return db.prepare(
    'SELECT idx, start_s, end_s, text FROM segments WHERE recording_id = ? ORDER BY idx'
  ).all(recordingId);
}

// Recordings left mid-pipeline by a crash or restart.
export function unfinishedRecordingIds() {
  return db.prepare(
    "SELECT id FROM recordings WHERE status NOT IN ('transcribed', 'ready', 'error') ORDER BY recorded_at"
  ).all().map((r) => r.id);
}
