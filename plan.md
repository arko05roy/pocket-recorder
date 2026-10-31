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
| L4 Ask | Done; verified on 2 real lift-enquiry calls (5/5 answers cited correctly) | `c8e4abf` |
| L5 Act | Done; verified on real calls (site-visit event and email draft proposed with sources) | `e7b0678` |
| L6 Honest & live | Done; unanswerable questions on real calls refused | `3fa1e23`, `f42d75c` |
| Claude Opus 5.5 for analysis + agent (Whisper stays) | Done | `04ec3e7` |
| Chat studio: in-app recording with live 3 s Whisper chunks, generative cards, knowledge graph (People, Graph pages), device pop-ups, white UI | Built; tested by hand on real speech, not on official samples | this commit |
| H1 Board alive | Done | |
| H2 Mic | Blocked: second INMP441 reads all zeros (SD held low); wiring being re-checked by colour | |
| H3–H6 Hardware | Not started | |

**Waiting on:** the official `sample-recordings` folder and `manifest.json`. Until then everything is tested with tones, silence and clearly labelled layout placeholders only. No made-up meeting content. **Not yet tested on real speech:** transcription accuracy, extraction quality, date resolution.

**How to run:** `npm run dev` (port 8000, all interfaces), then `npm run seed <folder>` to load samples.

## Stack

| Piece | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript | Route handlers for the API, React for the dashboard, one process |
| Database | SQLite via built-in `node:sqlite` | One file, synchronous, nothing to compile |
| Speech to text | Groq Whisper (`whisper-large-v3-turbo`) | Fast; `verbose_json` returns segment timestamps |
| LLM | Claude Opus 5.5 via `@anthropic-ai/sdk` (override with CLAUDE_MODEL) | Stronger extraction and rule-following; JSON-schema output for extraction, tool use for the agent; server-side refusal fallback on. Claude takes no audio, so Whisper stays for speech to text |
| Audio prep | `ffmpeg` | Normalise any input to 16 kHz mono WAV, read duration |
| Dashboard | React server + client components | Server components read the DB directly |
| Live updates | Server-Sent Events (`/api/stream`) → `router.refresh()` | New uploads and status changes appear without a refresh or restart |

Secrets live in `.env` (gitignored): `GROQ_API_KEY` (Whisper), `ANTHROPIC_API_KEY` (everything else). `.env.example` shows the keys.

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
lib/server/                  db, audio, groq (Whisper), claude, transcribe, analyse, agent, actions, live, ingest
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
- [x] **L6 Honest & live**: the system prompt plus a server check: an answer with no citation that survived validation is replaced with "The recordings don't say." `list_recordings` records each recording at t=0 so whole-recording facts can be cited. Known limits: one valid citation lets the whole answer through; an empty DB and clarifying questions also get the refusal. Live: `insertRecording` and `setStatus` publish to an in-process bus (`lib/server/live.ts`, on `globalThis`); `GET /api/stream` sends each change as an SSE line, with a 2 KB pad (Safari buffers the first 1 KB) and a 25 s heartbeat; it unsubscribes on disconnect. The browser debounces changes into one `router.refresh()` and refreshes once after a reconnect to catch missed changes. The 3 s polling is gone. Tested: all five status changes arrive within ~0.5 s of upload; a retried upload emits nothing.

Commit after each level (at least once an hour).

## Phase 2: Hardware

Board: ESP32-S3-N16R8 DevKit (16 MB flash, 8 MB PSRAM, onboard WS2812 RGB LED on GPIO 48). Power from the laptop's USB; no power bank, so H6 becomes a USB-powered run.

Flash: `arduino-cli compile --upload -p /dev/cu.usbmodem* --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M" firmware/recorder`. If it can't connect: hold BOOT, tap RST, release BOOT, then retry.

- [x] **H1** Board alive: LED cycles R/G/B, serial prints `ready`
Mic status (31 Oct): first INMP441 was damaged during soldering (reacted to taps, not speech). Second, pre-soldered one reads exactly 0 in every SCK/WS/channel combination; with SD unplugged GPIO 6 follows its pull-up, so the mic side holds SD low (most likely a wire mix-up: two white wires). Next: rewire one wire at a time against the table (VDD→3V3, GND→GND, SD→6, SCK→4, WS→5, L/R→GND) and run `firmware/micdiag`. `firmware/mictest` prints a live level once data arrives.

- [ ] **H2** I2S mic → PSRAM buffer → 32-bit to 16-bit conversion → WAV header → file in flash (LittleFS)
- [ ] **H3** LED state machine (red steady for the whole recording, blue blinking while uploading, green for 2 s, amber while queued, fast red on error)
- [ ] **H4** NTP time, multipart upload to this server, 201 check. On Wi-Fi connect, then every 30 s: `POST /api/devices/hello` with `device_id` (and optional `battery_pct`, `rssi`); the app shows an "ESP32 mic connected" pop-up on first hello and "disconnected" after 90 s of silence
- [ ] **H5** Offline queue: clips stay in flash with metadata; deleted only after a 201; retried on reconnect
- [ ] **H6** Power bank run + current measurements in the README

Upload runs on a separate FreeRTOS task so it never blocks recording.

## Risks and checks

- Groq rate limits / file size: clips are under 1 MB, well within limits; queue jobs one at a time and retry on 429.
- Wrong WAV header makes the voice too fast or slow: verify with Audacity.
- ESP32 needs a 2.4 GHz hotspot; allow port 8000 through the macOS firewall.
- Test questions include ones with no answer, so honesty is scored. Test those explicitly.
- Groq retires models (Llama 3.3 was already gone); we now only use it for Whisper. The Claude model is set by `CLAUDE_MODEL` in `.env`.
- Claude answers take ~3–6 s per question (several tool rounds). Fine for a demo; watch it on the real samples.
- `silencedetect` measures loudness, not speech: Whisper inventing text over loud background noise would still get through. Check on the real samples.

## Lessons so far

- Test with silence: it exposed Whisper inventing text that would have broken honest answers.
- Whisper turbo failed a real Hindi/English call (guessed English, translated, looped). large-v3 got it right: full recordings use large-v3, live chunks stay on turbo; consecutive repeated lines are dropped. The sample calls had no dates, so download time stood in for recorded_at.
- Treat LLM output as untrusted input: validate every field and tie every item to a real transcript line.
- `.gitignore` patterns without a leading `/` match at any depth (`recordings/` hid `app/api/recordings/`).
- `node:sqlite` rows have a null prototype; copy them to plain objects before passing them to client components.
- Next.js may load a module more than once; keep the DB connection and job queue on `globalThis`. The flip side: schema changes only apply after a dev server restart.
- Groq validates tool arguments against the schema, and the model sends `null` for unused optional parameters: allow `null` in the schema or the call fails with 400.
