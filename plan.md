# Pocket Recorder: Plan

Software (FDE track) first, then hardware. The Node server built here is also the upload target for the ESP32 later.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Server | Node 20+, Express | Familiar; multer handles `multipart/form-data` |
| Database | SQLite via `better-sqlite3` | One file, synchronous, zero setup |
| Speech to text | Groq Whisper (`whisper-large-v3-turbo`) | Fast; `verbose_json` returns segment timestamps |
| LLM | Groq `llama-3.3-70b-versatile` | Tool calling for the agent; JSON mode for extraction |
| Audio prep | `ffmpeg` | Normalise any input to 16 kHz mono WAV, read duration |
| Dashboard | Static HTML + vanilla JS served by Express | No build step, easy to explain |
| Live updates | Server-Sent Events (`/events`) | New uploads appear without a refresh or restart |

Secrets live in `.env` (gitignored). `.env.example` shows the keys.

## Folder layout

```
server/
  index.js          Express app, routes
  db.js             schema + queries
  ingest.js         save file → transcribe → analyse pipeline (job queue)
  transcribe.js     Groq Whisper call
  analyse.js        summary / action items / dates / people (JSON mode)
  agent.js          chat loop with tools
  tools.js          search_transcripts, get_recording, list_action_items,
                    create_calendar_event, draft_email
public/             dashboard (index.html, app.js, style.css)
scripts/seed.js     load sample-recordings + manifest.json
data/               app.db + audio files (gitignored)
firmware/           ESP32 sketch (hardware phase)
```

## Data model

- `recordings`: id, device_id, recorded_at, duration_ms, battery_pct, file_path, status (`received|transcribing|analysing|ready|error`), summary, created_at
- `segments`: recording_id, idx, start_s, end_s, text, plus an FTS5 virtual table for search
- `action_items`: recording_id, who, what, due, status (`open|done`), source_s
- `mentions`: recording_id, kind (`person|date|meeting`), value, source_s
- `calendar_events`: title, start, end, attendees, source_recording_id, created_at
- `email_drafts`: to, subject, body, source_recording_id, created_at

## Hand-off contract (must match exactly)

`POST /upload`, multipart: `audio` (WAV), `device_id`, `recorded_at` (ISO 8601 with time zone), `duration_ms`, `battery_pct` (may be empty).
- Success: `201 {"id": "rec-01_2026-11-05T14-32-10", "status": "saved"}`
- Missing audio / bad fields: `400`. Same id uploaded again: return `201` with the same id and do not store a duplicate (device retries must be safe).
- Respond as soon as the file is on disk. Transcription runs in the background.

## Phase 1: Software (FDE levels)

- [ ] **L0 Setup**: repo, `npm init`, Express, `GET /health`, `POST /upload` per contract, test with curl
- [ ] **L1 Transcribe**: ingest queue → ffmpeg normalise → Groq Whisper `verbose_json` → store segments; `scripts/seed.js` loads the samples using the manifest
- [ ] **L2 Dashboard**: recordings grouped by day, detail view with transcript + `<audio>` player (click a segment to seek), full-text search across transcripts
- [ ] **L3 Understand**: LLM extraction per recording, schema-validated JSON (summary, action items who/what/when, meetings/dates, people), each with a source timestamp
- [ ] **L4 Ask**: chat panel; agent uses tools; every answer cites `recording · date · mm:ss`, and citations are clickable
- [ ] **L5 Act**: calendar view + drafts list; the agent *proposes* an event or draft, the UI shows a Confirm/Cancel card, and only Confirm writes it. Emails are never sent.
- [ ] **L6 Honest & live**: the system prompt plus a check that tools returned evidence; with no evidence the agent replies "The recordings don't say." SSE pushes new uploads and status changes to the dashboard.

Commit after each level (at least once an hour).

## Phase 2: Hardware

- [ ] **H1** Board alive: LED cycles R/G/B, serial prints `ready`
- [ ] **H2** I2S mic → PSRAM buffer → 32-bit to 16-bit conversion → WAV header → file in flash (LittleFS)
- [ ] **H3** LED state machine (red steady for the whole recording, blue blinking while uploading, green for 2 s, amber while queued, fast red on error)
- [ ] **H4** NTP time, multipart upload to this server, 201 check
- [ ] **H5** Offline queue: clips stay in flash with metadata; deleted only after a 201; retried on reconnect
- [ ] **H6** Power bank run + current measurements in the README

Upload runs on a separate FreeRTOS task so it never blocks recording.

## Risks and checks

- Groq rate limits / file size: clips are under 1 MB, well within limits; queue jobs one at a time and retry on 429.
- Wrong WAV header makes the voice too fast or slow: verify with Audacity.
- ESP32 needs a 2.4 GHz hotspot; allow port 8000 through the macOS firewall.
- Test questions include ones with no answer, so honesty is scored. Test those explicitly.
