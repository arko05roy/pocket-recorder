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
