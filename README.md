# Pocket Recorder

My entry for the Vyohm **Pocket Recorder Challenge**. The brief has two halves: a recorder that captures speech, and the AI that understands it. This repo has both. The **FDE track is complete (L1–L6)**. The **hardware track is at H1**: the microphone is blocked on a wiring fault, described below.

The app is a Next.js server on port 8000. It accepts clips through the hand-off contract (`POST /upload`) and transcribes them with Whisper. Claude then pulls out summaries, action items, people and dates, and answers questions with the recording and the second each fact came from. You can also record straight from the browser, and the screen builds tables, timelines and a map of who you mentioned while you talk.

---

## Levels

### FDE track: agent and dashboard

| Level | Status | What it does |
|---|---|---|
| **L1 Transcribe** | ✅ Done | Background queue → ffmpeg (16 kHz mono) → Groq Whisper with segment timestamps → SQLite, stored with `recorded_at` and duration. |
| **L2 Dashboard** | ✅ Done | Recordings grouped by day; transcript with click-to-seek and audio playback; full-text search across every transcript that opens at the matching moment. |
| **L3 Understand** | ✅ Done | Per recording: title, summary, action items (who, what, by when), meetings, dates and people. |
| **L4 Ask** | ✅ Done | A chat that answers from the recordings. Every answer names the recording and the time inside it. |
| **L5 Act** | ✅ Done | The agent proposes calendar events and email drafts. Nothing is saved until you press **Confirm**. Drafts are never sent. |
| **L6 Honest and live** | ✅ Done | Says "The recordings don't say." when there's no evidence. A new upload appears on the dashboard within about half a second, without a restart. |

**How it was tested:** the official `sample-recordings` folder hadn't arrived, so L4–L6 were checked on two real lift-enquiry phone calls (my own data, used with consent). There, 5 of 5 questions were answered with correct citations, the site-visit event and email draft were proposed with sources, and unanswerable questions were refused. They have **not yet been run on the official samples**.

### Hardware track: recorder

| Level | Status | Notes |
|---|---|---|
| **H1 Board alive** | ✅ Done | LED cycles red → green → blue, serial prints `ready` (`firmware/recorder`). |
| **H2 Clean audio** | ⛔ Blocked | The microphone gives no usable audio. See [Known problems](#known-problems). |
| **H3–H6** | Not started | Depend on a working microphone. |

---

## Running it

You need Node 20+, `ffmpeg` and `ffprobe`, a Groq API key (Whisper) and an Anthropic API key (Claude).

```bash
npm install
cp .env.example .env        # then fill in GROQ_API_KEY and ANTHROPIC_API_KEY
npm run dev                 # http://localhost:8000, listening on all interfaces
```

Load the sample recordings. They go through `POST /upload`, the same path the ESP32 uses:

```bash
npm run seed path/to/sample-recordings     # reads manifest.json in that folder
```

Send one clip by hand, exactly as in the brief:

```bash
curl -F "audio=@clip.wav" -F "device_id=rec-01" \
     -F "recorded_at=2026-11-05T14:32:10+05:30" \
     -F "duration_ms=8200" -F "battery_pct=" \
     http://localhost:8000/upload
```

### Settings (`.env`, gitignored)

| Key | Purpose | Default |
|---|---|---|
| `GROQ_API_KEY` | Whisper speech to text | required |
| `ANTHROPIC_API_KEY` | Claude for everything else | required |
| `CLAUDE_MODEL` | Analysis, agent, final reports | `claude-opus-5-5` |
| `CLAUDE_FAST_MODEL` | Live cards and transcript clean-up | `claude-sonnet-5-5` |
| `WHISPER_MODEL` | Full recordings | `whisper-large-v3` |
| `WHISPER_LIVE_MODEL` | 3-second live chunks | `whisper-large-v3-turbo` |
| `ESP32_URL`, `PRINTER_*` | Optional print bridge (extra, see below) | — |

Firmware is flashed with `arduino-cli` (the board is an ESP32-S3 N16R8):

```bash
arduino-cli compile --upload -p /dev/cu.usbmodem* \
  --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M" firmware/recorder
```

If it won't connect: hold BOOT, tap RST, release BOOT, then try again.

---

## Hand-off contract

`POST /upload`, `multipart/form-data`, exactly as in the brief: `audio` (WAV, 16 kHz, 16-bit, mono), `device_id`, `recorded_at` (ISO 8601 with time zone), `duration_ms` and `battery_pct` (may be empty).

- **Success:** `201 {"id": "rec-01_2026-11-05T14-32-10", "status": "saved"}`, sent as soon as the file is on disk. Transcription runs afterwards.
- **Bad input:** `400` with the reason (missing audio, a time without a zone, and so on).
- **Retries are safe:** the id is built from `device_id` + `recorded_at`, so a device re-sending the same clip gets the same `201` and no duplicate is stored. That's what the L5 offline queue needs.
- `GET /health` returns `{"ok": true}`.

---

## How it works

```
 ESP32 / browser / seed script
            │  POST /upload (contract)
            ▼
  Next.js server ──► data/audio/*.wav + SQLite (data/app.db)
            │
            ▼  background queue, one job at a time, resumes after a restart
  ffmpeg ─► Groq Whisper ─► segments ─► Claude: summary, action items, people, dates
            │
            ├──► dashboard updates over Server-Sent Events (/api/stream)
            └──► agent: tool-calling loop with server-checked citations
```

### Stack

| Piece | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript | API and dashboard in one process |
| Database | SQLite through built-in `node:sqlite`, FTS5 for search | One file, nothing to compile |
| Speech to text | Groq Whisper | Fast, returns segment timestamps |
| LLM | Claude (Opus for analysis, the agent and reports; Sonnet for fast live passes) | Strong at following rules; JSON-schema output for extraction |
| Audio prep | ffmpeg | Normalises any input and reads its duration |
| Live updates | Server-Sent Events | New uploads appear without polling or a restart |

### Trusting the AI output

Model output is treated like any other untrusted input:

- **Grounded extraction.** Every action item, person and date must cite a real transcript line, or it's dropped. Timestamps come from our own segments, never from the model. Dates are validated strictly (`2026-02-30` is rejected), relative dates are resolved against the recording's own date, and they're left empty when unclear.
- **Checked citations.** The agent cites as `[[recording@seconds]]`. The server keeps a citation only if it's within 1.5 s of a moment a tool actually returned, and snaps it to that moment. Made-up citations disappear before you see them.
- **Honesty rule.** An answer with no surviving citation is replaced by "The recordings don't say."
- **Confirm before acting.** `propose_event` and `propose_draft` write nothing. They return a card. On **Confirm**, `/api/events` or `/api/drafts` re-check everything, because the browser is untrusted too.
- **Whisper on silence.** Whisper invents phrases like "Thank you." over silence. Segments are checked against ffmpeg `silencedetect` and clamped to the clip length.

### Agent tools

`search_transcripts`, `list_recordings`, `get_recording`, `list_action_items`, `list_saved`, `calendar` (turns "next Thursday" into a real date), `propose_event`, `propose_draft`, `lookup_graph`, `create_doc` and `propose_print`.

### Data model

`recordings` (status runs `received → transcribing → transcribed → analysing → ready`, or `error`), `segments` + `segments_fts`, `action_items`, `mentions`, `calendar_events`, `email_drafts`, `docs`, `chats`, and the knowledge graph (`graph_nodes`, `graph_edges`, `graph_mentions`).

---

## Beyond the brief

Built after the six levels worked:

- **Record in the browser** (`/`). Audio goes to Whisper in roughly 3-second chunks, cut at the quietest moment so words aren't split, and your words appear about three seconds behind you. When you stop, the whole clip is uploaded through the same `POST /upload` contract.
- **Live cards while you talk.** Sonnet rebuilds a set of cards every few seconds: tables for orders and lists of items, timelines, checklists, facts and numbers. Every card downloads as CSV, and hovering a row shows the sentence it came from.
- **Report after Stop.** Sonnet cleans the transcript, then Opus writes a report: title, summary, people, action items by priority, decisions, timeline, tables with CSV, next steps and open questions.
- **Instructions become actions.** A finished voice note is handed to the agent, which proposes the events and email drafts it asks for, for you to confirm.
- **Docs only on request.** A voice note that asks for a "doc", "document", "write-up" or "memo" is written up as an editable doc on `/docs`, which can be printed.
- **Knowledge graph** (`/graph`, `/people`). People, places and organisations, and how they relate ("Atharv reports to Paruk"), gathered across recordings.
- **Calendar and drafts** (`/calendar`, `/drafts`), with "Open in Gmail" for a draft. It opens Gmail's compose window; nothing is sent automatically.
- **ESP32 print bridge** (`firmware/printer`, `firmware/usbprinter`). Finds network printers or drives a USB printer, so a finished doc prints from the app. `npm run fake-printer` stands in for a printer when testing.

---

## Changes from the brief

| Brief | This repo | Reason |
|---|---|---|
| Python/FastAPI or Node, local Whisper suggested | Next.js 16 + TypeScript; hosted Groq Whisper | One process for the API and dashboard; hosted speech to text is allowed because all data is mock |
| Discrete RGB LED on GPIO 15/16/17 | The board's built-in WS2812 RGB LED on **GPIO 48** | It's already on the board, and H1 uses it |
| Mic pins SCK 4, WS 5, SD 6 | Same as the brief | — |
| Suggested `create_calendar_event` / `draft_email` | `propose_event` / `propose_draft` plus a Confirm step | L5 requires confirmation before acting |
| Battery / power-bank run (H6) | Not done; no power bank available | — |

---

## Measured numbers

Hardware current draw (H6) was **not measured**; that level wasn't reached.

Software timings on this laptop, with the dev server:

| Step | Time |
|---|---|
| `POST /upload` response | ~20 ms (the file is saved; transcription runs afterwards) |
| Status change reaching the dashboard (SSE) | ~0.5 s |
| One 3-second live chunk through Whisper (turbo) | ~0.3 s |
| Live cards update (Sonnet) | ~3.5–4 s |
| Transcript clean-up after Stop (Sonnet) | ~3 s for a one-minute note |
| Final report (Opus) | ~18 s for a one-minute note |
| Agent answer | ~3–6 s (several tool rounds) |

---

## Known problems

- **The microphone gives no usable audio (H2).** The first INMP441 was damaged while soldering: it reacted to taps, not speech. The second reads exactly zero with every clock and channel setting. With its data wire unplugged, GPIO 6 reads high as expected, so the mic side is holding the data line low. The most likely cause is two same-coloured jumper wires swapped. Next step: rewire one wire at a time against the table (VDD→3V3, GND→GND, SD→6, SCK→4, WS→5, L/R→GND) and run `firmware/micdiag`. That sketch drives the mic with Espressif's own I2S driver and samples the pins directly. `firmware/mictest` prints a live level once data arrives.
- **No wiring photo yet.** The brief asks for one, and it's still to be added.
- **Not yet tested on the official samples.** Accuracy has only been checked on my own calls and test speech.
- **Telling two speakers apart was removed.** I tried separating two voices live by pitch, but it was unreliable on real recordings, so everything is shown as one speaker.
- **One valid citation lets a whole answer through.** The honesty check is per answer, not per sentence.
- **Loud background noise.** `silencedetect` measures loudness, not speech, so Whisper inventing words over loud noise could still get through.
- **Moving an event.** The agent can't edit a saved event. "Move Thursday's meeting to Friday" becomes a new event, and the old one has to be deleted by hand.
- **Live text lags about 3 seconds**, because audio is sent in 3-second chunks.
- **Dev server caching.** Next.js can keep using an old copy of a server module. After schema changes, or if behaviour doesn't match the code, restart with `rm -rf .next && npm run dev`.

---

## With one more day

1. **Fix the microphone**, then build H2–H5 in order: I2S into a PSRAM buffer, 32-bit to 16-bit conversion, WAV header, files in LittleFS, the LED state machine, NTP time plus upload, and the offline queue that deletes a clip only after a `201`. Upload runs on its own FreeRTOS task so it never blocks recording.
2. **Run the official samples** and the demo questions, especially the ones with no answer, then tune the extraction and refusal rules on what fails.
3. **Measure current** for idle, recording and uploading, and do the unplugged run.
4. **Per-sentence citations**, so every claim in an answer needs its own source.
5. **Edit and move events** through the agent instead of only adding new ones.
6. **Real speaker separation** with a diarization service, to replace the pitch attempt.

---

## Repo layout

```
app/                    pages and API routes (upload, health, api/*)
components/             dashboard and chat UI (studio/ is the recording chat)
lib/                    shared types and formatting; lib/server/ holds the DB, Whisper,
                        Claude, the pipeline, the agent, live cards and reports
instrumentation.ts      resumes unfinished jobs when the server starts
scripts/seed.mjs        loads a samples folder through POST /upload
scripts/fake-printer.mjs  stand-in network printer for testing
firmware/recorder       H1 sketch (the recorder grows here)
firmware/micdiag, mictest  microphone diagnostics
firmware/printer, usbprinter  ESP32 print bridge
plan.md                 build plan, progress and lessons learned
data/                   SQLite database and audio files (gitignored)
```

## Privacy

Only mock recordings or my own voice. Secrets (`.env`, `firmware/*/secrets.h`) and all recordings (`data/`) are gitignored. On the recorder, the red light stays on for the entire time the mic is recording, and there is no hidden recording mode.
