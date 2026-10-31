# Pocket Recorder: Plan

Software (FDE track) first, then hardware. The Next.js app built here is also the upload target for the ESP32 later.

## Progress (updated 31 Oct 2026)

| Level | State | Commit |
|---|---|---|
| L0 Setup + upload contract | Done | `dac4e65` |
| L1 Transcribe | Done | `b3b6eb7` |
| L2 Dashboard | Done | `9226a1a` |
| L3 Understand | Done | `ad75e57` |
| Move to Next.js 16 + TypeScript | Done | `22e9651`, `c959037` |
| L4 Ask | Built; citations untested until real samples arrive | `c8e4abf` |
| L5 Act | Built; agent proposals untested until real samples arrive | |
| L6 Honest & live | Partly: honesty safeguards in transcription, extraction and the agent's evidence check; live push not started | |
| H1 Board alive | Done | |
| H2–H6 Hardware | Waiting on mic soldering | |

**Waiting on:** the official `sample-recordings` folder and `manifest.json`. Until then everything is tested with tones, silence and clearly labelled layout placeholders only. No made-up meeting content. **Not yet tested on real speech:** transcription accuracy, extraction quality, date resolution.

**How to run:** `npm run dev` (port 8000, all interfaces), then `npm run seed <folder>` to load samples.

## Stack

| Piece | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript | Route handlers for the API, React for the dashboard, one process |
| Database | SQLite via built-in `node:sqlite` | One file, synchronous, nothing to compile |
| Speech to text | Groq Whisper (`whisper-large-v3-turbo`) | Fast; `verbose_json` returns segment timestamps |
| LLM | Groq `openai/gpt-oss-120b` (override with GROQ_MODEL) | Tool calling for the agent; JSON mode for extraction |
| Audio prep | `ffmpeg` | Normalise any input to 16 kHz mono WAV, read duration |
| Dashboard | React server + client components | Server components read the DB directly |
| Live updates | Now: `router.refresh()` every 3 s while a recording is processing. L6: Server-Sent Events | New uploads appear without a refresh or restart |

Secrets live in `.env` (gitignored). `.env.example` shows the keys.

## Folder layout

```
app/
  upload/route.ts            POST /upload (the hand-off contract)
  health/route.ts            GET /health
  api/...                    recordings, audio (range requests), search, action items
  layout.tsx, page.tsx       shell + home
  r/[id]/page.tsx            recording page (server component)
components/                  Sidebar, RecordingView, Player (client components)
lib/types.ts, lib/format.ts  shared by server and browser
lib/server/                  db, audio, groq, transcribe, analyse, ingest
instrumentation.ts           resumes unfinished jobs on server start
scripts/seed.mjs             load sample-recordings + manifest.json via POST /upload
data/                        app.db + audio files (gitignored)
firmware/                    ESP32 sketch (hardware phase)
```

## Data model

Built:
- `recordings`: id, device_id, recorded_at, duration_ms, battery_pct, file_path, status (`received → transcribing → transcribed → analysing → ready`, or `error`), error, title, summary, created_at
- `segments`: recording_id, idx, start_s, end_s, text; `segments_fts` (FTS5, external content, kept in sync by triggers)
- `action_items`: recording_id, who, what, due_text, due_date, source_s, status (`open|done`, CHECK constraint)
- `mentions`: recording_id, kind (`person|meeting|date`), value, detail, date, time, source_s

- `calendar_events`: title, date, start_time, end_time (null = all day), attendees (JSON), source_recording_id, source_s, created_at
- `email_drafts`: to, subject, body, source_recording_id, source_s, created_at

## Hand-off contract (must match exactly)

`POST /upload`, multipart: `audio` (WAV), `device_id`, `recorded_at` (ISO 8601 with time zone), `duration_ms`, `battery_pct` (may be empty).
- Success: `201 {"id": "rec-01_2026-11-05T14-32-10", "status": "saved"}`
- Missing audio / bad fields: `400`. Same id uploaded again: return `201` with the same id and do not store a duplicate (device retries must be safe).
- Respond as soon as the file is on disk. Transcription runs in the background.

## Phase 1: Software (FDE levels)

- [x] **L0 Setup**: `GET /health`, `POST /upload` per contract. Validates every field (400 with a reason); id derived from device_id + recorded_at so a device retry returns the same 201 with no duplicate. Tested with curl.
- [x] **L1 Transcribe**: background queue (one job at a time, resumes unfinished work on start) → ffmpeg normalise → Groq Whisper `verbose_json` → segments in SQLite. Whisper invents text on silence ("Thank you."), so segments are checked against ffmpeg `silencedetect`, clamped to the clip length, and punctuation-only ones dropped. Retries on 429/5xx with backoff. `npm run seed <folder>` loads samples through `POST /upload`.
- [x] **L2 Dashboard**: Notion-style UI. Recordings grouped by day; transcript with click-to-seek; scrub bar showing a tick per segment; current line followed during playback; FTS5 search (input quoted so it can't break the query, prefix match on the last word) whose results open at the matched moment. Audio served with HTTP Range (206/416). Mobile layout switches between list and recording.
- [x] **L3 Understand**: `gpt-oss-120b` in JSON mode reads a line-numbered transcript and returns title, summary, action items (who/what/when), meetings, dates, people. Every item must cite an existing line or it is dropped; timestamps come from our segments, never the model; dates validated strictly (rejects 2026-02-30); relative dates resolved against the recording's own date, null when unsure. Action items can be ticked done. On meaningless input it returns nothing.
- [ ] **L4 Ask** (built, needs real samples to verify citations): `/ask` chat page. Groq tool-calling loop (max 6 steps) over four read-only tools: `search_transcripts` (FTS, any word), `list_recordings` (date range), `get_recording` (full transcript + extraction), `list_action_items`. The model cites with `[[id@seconds]]`; the server keeps only citations within 1.5 s of a moment a tool returned, snaps them to it, and renders `recording · date · mm:ss` chips that open the recording at that second. Made-up citations are dropped.
- [ ] **L5 Act** (built, needs real samples to verify the agent side): `propose_event` / `propose_draft` tools validate and return a proposal but write nothing; the chat shows a Confirm/Cancel card. Every proposal must cite a moment a tool returned. Confirm POSTs to `/api/events` or `/api/drafts`, which re-check everything (real date, end after start, source within 1.5 s of a real moment in that recording) because the browser is untrusted too. `/calendar` (grouped by day, delete) and `/drafts` (copy, delete). Nothing sends email. The agent can read saved items via `list_saved`. Validators shared in `lib/server/validate.ts`.
- [ ] **L6 Honest & live** (honesty done; live push still to do): the system prompt plus a server check: an answer with no citation that survived validation is replaced with "The recordings don't say." `list_recordings` records each recording at t=0 so whole-recording facts can be cited. Known limits: one valid citation lets the whole answer through; an empty DB and clarifying questions also get the refusal. SSE pushes new uploads and status changes to the dashboard (not started).

Commit after each level (at least once an hour).

## Phase 2: Hardware

Board: ESP32-S3-N16R8 DevKit (16 MB flash, 8 MB PSRAM, onboard WS2812 RGB LED on GPIO 48). Power from the laptop's USB; no power bank, so H6 becomes a USB-powered run.

Flash: `arduino-cli compile --upload -p /dev/cu.usbmodem* --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M" firmware/recorder`. If it can't connect: hold BOOT, tap RST, release BOOT, then retry.

- [x] **H1** Board alive: LED cycles R/G/B, serial prints `ready`
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
- Groq retires models (Llama 3.3 was already gone). The model is set by `GROQ_MODEL` in `.env`; check the account's model list the day before.
- `silencedetect` measures loudness, not speech: Whisper inventing text over loud background noise would still get through. Check on the real samples.

## Lessons so far

- Test with silence: it exposed Whisper inventing text that would have broken honest answers.
- Treat LLM output as untrusted input: validate every field and tie every item to a real transcript line.
- `.gitignore` patterns without a leading `/` match at any depth (`recordings/` hid `app/api/recordings/`).
- `node:sqlite` rows have a null prototype; copy them to plain objects before passing them to client components.
- Next.js may load a module more than once; keep the DB connection and job queue on `globalThis`. The flip side: schema changes only apply after a dev server restart.
- Groq validates tool arguments against the schema, and the model sends `null` for unused optional parameters: allow `null` in the schema or the call fails with 400.
