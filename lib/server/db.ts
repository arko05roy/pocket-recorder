import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { publish } from './live';
import type {
  ActionItem, CalendarEvent, Citation, Doc, DocSection, DraftProposal, GraphEdge, GraphNode, NodeProfile, EmailDraft, EventProposal, Mention, RecordingDetail,
  RecordingSummary, SearchHit, Segment, Status,
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

    -- Written only when the user confirms an agent proposal. The source is the
    -- moment in a recording the proposal came from.
    CREATE TABLE IF NOT EXISTS calendar_events (
      id                  INTEGER PRIMARY KEY,
      title               TEXT NOT NULL,
      date                TEXT NOT NULL,
      start_time          TEXT,
      end_time            TEXT,
      attendees           TEXT NOT NULL DEFAULT '[]',
      source_recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      source_s            REAL NOT NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A chat thread (voice turns, questions, answers, live cards), stored as
    -- JSON: it is only ever read and written whole, by the chat page.
    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT 'New chat',
      data       TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The knowledge graph: everyone and everything mentioned, across all
    -- chats. A node is unique by its lower-cased name.
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id         INTEGER PRIMARY KEY,
      key        TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- A relationship as said: from —label→ to ("Paruk —boss of→ Atharv").
    CREATE TABLE IF NOT EXISTS graph_edges (
      id         INTEGER PRIMARY KEY,
      from_id    INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      quote      TEXT NOT NULL,
      source     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (from_id, to_id, label)
    );
    -- Each sentence a node was mentioned in. source identifies the voice note
    -- ("chat:<id>:<n>"), so saving it again replaces rather than duplicates.
    CREATE TABLE IF NOT EXISTS graph_mentions (
      id         INTEGER PRIMARY KEY,
      node_id    INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      quote      TEXT NOT NULL,
      source     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Documents written in chat (/docs). sections and sources are JSON arrays.
    CREATE TABLE IF NOT EXISTS docs (
      id         INTEGER PRIMARY KEY,
      title      TEXT NOT NULL,
      sections   TEXT NOT NULL,
      sources    TEXT NOT NULL DEFAULT '[]',
      status     TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      printed_at TEXT
    );

    -- Small key/value settings, e.g. the printer chosen in the sidebar.
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Drafts only. Nothing in this app sends email.
    CREATE TABLE IF NOT EXISTS email_drafts (
      id                  INTEGER PRIMARY KEY,
      "to"                TEXT NOT NULL,
      subject             TEXT NOT NULL,
      body                TEXT NOT NULL,
      source_recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      source_s            REAL NOT NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
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
  publish({ id: r.id, status: 'received' });
}

export function setStatus(id: string, status: Status, error: string | null = null) {
  db.prepare('UPDATE recordings SET status = ?, error = ? WHERE id = ?').run(status, error, id);
  // Every pipeline step ends in a status change, so this is the one place
  // the dashboard needs to hear about.
  publish({ id, status });
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
    has_audio: Boolean(file_path),
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

// For the agent: any word may match (OR), best matches first, full line text
// plus enough about the recording to cite it.
export function searchSegmentsAny(input: string, limit = 20) {
  const words = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  return db.prepare(`
    SELECT s.recording_id, s.idx, s.start_s, s.text, r.recorded_at, r.title
    FROM segments_fts
    JOIN segments s   ON s.id = segments_fts.rowid
    JOIN recordings r ON r.id = s.recording_id
    WHERE segments_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(words.map((w) => `"${w}"`).join(' OR '), limit).map(plain<{
    recording_id: string; idx: number; start_s: number; text: string; recorded_at: string; title: string | null;
  }>);
}

export function listAllActionItems(status?: 'open' | 'done') {
  return db.prepare(`
    SELECT a.id, a.recording_id, a.who, a.what, a.due_text, a.due_date, a.source_s, a.status,
           r.recorded_at, r.title
    FROM action_items a JOIN recordings r ON r.id = a.recording_id
    WHERE ? IS NULL OR a.status = ?
    ORDER BY r.recorded_at, a.source_s
  `).all(status ?? null, status ?? null).map(plain<ActionItem & {
    recording_id: string; recorded_at: string; title: string | null;
  }>);
}

// Rows carry only the source id and second; the citation label is rebuilt
// from the recording so it stays right if the title changes.
function withSource<T>(row: any): T {
  const { source_recording_id, source_s, attendees, ...rest } = row;
  const rec = getRecording(source_recording_id)!;
  return {
    ...rest,
    ...(attendees !== undefined && { attendees: JSON.parse(attendees) }),
    source: {
      recording_id: rec.id,
      label: rec.title ?? `${rec.device_id} ${rec.recorded_at.slice(11, 16)}`,
      recorded_at: rec.recorded_at,
      start_s: source_s,
    },
  } as T;
}

export function insertEvent(e: Omit<EventProposal, 'kind'>) {
  return Number(db.prepare(`
    INSERT INTO calendar_events (title, date, start_time, end_time, attendees, source_recording_id, source_s)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(e.title, e.date, e.start_time, e.end_time, JSON.stringify(e.attendees), e.source.recording_id, e.source.start_s).lastInsertRowid);
}

export function insertDraft(d: Omit<DraftProposal, 'kind'>) {
  return Number(db.prepare(`
    INSERT INTO email_drafts ("to", subject, body, source_recording_id, source_s) VALUES (?, ?, ?, ?, ?)
  `).run(d.to, d.subject, d.body, d.source.recording_id, d.source.start_s).lastInsertRowid);
}

export function listEvents() {
  return db.prepare('SELECT * FROM calendar_events ORDER BY date, start_time IS NOT NULL, start_time')
    .all().map(withSource<CalendarEvent>);
}

export function listDrafts() {
  return db.prepare('SELECT * FROM email_drafts ORDER BY created_at DESC, id DESC').all().map(withSource<EmailDraft>);
}

export const deleteEvent = (id: number) => Number(db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id).changes);
export const deleteDraft = (id: number) => Number(db.prepare('DELETE FROM email_drafts WHERE id = ?').run(id).changes);

export function listChats() {
  return db.prepare('SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC LIMIT 100')
    .all().map(plain<{ id: string; title: string; updated_at: string }>);
}

export function getChat(id: string) {
  const row = db.prepare('SELECT id, title, data FROM chats WHERE id = ?').get(id);
  return row ? { id: row.id as string, title: row.title as string, turns: JSON.parse(row.data as string) as unknown[] } : null;
}

export function saveChat(id: string, title: string, turns: unknown[]) {
  db.prepare(`
    INSERT INTO chats (id, title, data) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data, updated_at = datetime('now')
  `).run(id, title, JSON.stringify(turns));
}

export const deleteChat = (id: string) => Number(db.prepare('DELETE FROM chats WHERE id = ?').run(id).changes);

// ---------- knowledge graph ----------

function upsertNode(name: string, type: string) {
  const key = name.toLowerCase();
  db.prepare('INSERT INTO graph_nodes (key, name, type) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').run(key, name, type);
  return Number(db.prepare('SELECT id FROM graph_nodes WHERE key = ?').get(key)!.id);
}

// Save what one voice note established. Mentions from the same source are
// replaced, so saving a voice note twice doesn't double-count.
export function ingestGraph(source: string, nodes: { name: string; type: string; quote: string }[], edges: { from: string; to: string; label: string; quote: string }[]) {
  transaction(() => {
    db.prepare('DELETE FROM graph_mentions WHERE source = ?').run(source);
    const ids = new Map<string, number>();
    for (const n of nodes) {
      const id = upsertNode(n.name, n.type);
      ids.set(n.name.toLowerCase(), id);
      db.prepare('INSERT INTO graph_mentions (node_id, quote, source) VALUES (?, ?, ?)').run(id, n.quote, source);
    }
    for (const e of edges) {
      const from = ids.get(e.from.toLowerCase()), to = ids.get(e.to.toLowerCase());
      if (!from || !to) continue;
      db.prepare(`INSERT INTO graph_edges (from_id, to_id, label, quote, source) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(from_id, to_id, label) DO NOTHING`).run(from, to, e.label.toLowerCase(), e.quote, source);
    }
  });
}

export function getGraph() {
  const nodes = db.prepare(`
    SELECT n.id, n.name, n.type, (SELECT count(*) FROM graph_mentions m WHERE m.node_id = n.id) AS mentions
    FROM graph_nodes n ORDER BY mentions DESC, n.name
  `).all().map(plain<GraphNode>);
  const edges = db.prepare('SELECT id, from_id, to_id, label, quote FROM graph_edges').all().map(plain<GraphEdge>);
  return { nodes, edges };
}

// One node with its direct connections and the sentences it came up in.
export function getNodeProfile(name: string): NodeProfile | null {
  const node = db.prepare(`
    SELECT n.id, n.name, n.type, (SELECT count(*) FROM graph_mentions m WHERE m.node_id = n.id) AS mentions
    FROM graph_nodes n WHERE n.key = ?
  `).get(name.toLowerCase());
  if (!node) return null;
  const links = db.prepare(`
    SELECT e.label, e.quote, 'out' AS dir, o.name, o.type FROM graph_edges e JOIN graph_nodes o ON o.id = e.to_id WHERE e.from_id = ?
    UNION ALL
    SELECT e.label, e.quote, 'in' AS dir, o.name, o.type FROM graph_edges e JOIN graph_nodes o ON o.id = e.from_id WHERE e.to_id = ?
  `).all(node.id, node.id).map(plain<NodeProfile['links'][number]>);
  const quotes = db.prepare('SELECT quote FROM graph_mentions WHERE node_id = ? ORDER BY id DESC LIMIT 6')
    .all(node.id).map((r) => r.quote as string);
  return { ...plain<GraphNode>(node), links, quotes };
}

export function listPeople() {
  return db.prepare(`
    SELECT n.id, n.name, n.type,
      (SELECT count(*) FROM graph_mentions m WHERE m.node_id = n.id) AS mentions,
      (SELECT count(*) FROM graph_edges e WHERE e.from_id = n.id OR e.to_id = n.id) AS links,
      (SELECT max(created_at) FROM graph_mentions m WHERE m.node_id = n.id) AS last_seen
    FROM graph_nodes n ORDER BY n.type = 'person' DESC, mentions DESC, n.name
  `).all().map(plain<GraphNode & { links: number; last_seen: string | null }>);
}

export const deleteNode = (id: number) => Number(db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(id).changes);
export const deleteEdge = (id: number) => Number(db.prepare('DELETE FROM graph_edges WHERE id = ?').run(id).changes);

// Recordings left mid-pipeline by a crash or restart.
export function unfinishedRecordingIds() {
  return db.prepare(
    "SELECT id FROM recordings WHERE status NOT IN ('ready', 'error') ORDER BY recorded_at"
  ).all().map((r) => r.id as string);
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

type DocRow = { id: number; title: string; sections: string; sources: string; status: Doc['status']; created_at: string; printed_at: string | null };
const toDoc = (r: DocRow): Doc => ({ ...plain<DocRow>(r), sections: JSON.parse(r.sections), sources: JSON.parse(r.sources) });

export function insertDoc(title: string, sections: DocSection[], sources: Citation[]): Doc {
  const id = Number(db.prepare('INSERT INTO docs (title, sections, sources) VALUES (?, ?, ?)')
    .run(title, JSON.stringify(sections), JSON.stringify(sources)).lastInsertRowid);
  return getDoc(id)!;
}

export function getDoc(id: number): Doc | null {
  const row = db.prepare('SELECT * FROM docs WHERE id = ?').get(id) as DocRow | undefined;
  return row ? toDoc(row) : null;
}

export const listDocs = () => (db.prepare('SELECT * FROM docs ORDER BY created_at DESC, id DESC').all() as DocRow[]).map(toDoc);

export const markDocPrinted = (id: number) =>
  db.prepare("UPDATE docs SET status = 'printed', printed_at = datetime('now') WHERE id = ?").run(id);

export const deleteDoc = (id: number) => Number(db.prepare('DELETE FROM docs WHERE id = ?').run(id).changes);

// An edit puts a printed doc back to draft: what's on paper no longer matches.
export const updateDoc = (id: number, title: string, sections: DocSection[]) => Number(db.prepare(
  "UPDATE docs SET title = ?, sections = ?, status = 'draft' WHERE id = ?",
).run(title, JSON.stringify(sections), id).changes);
