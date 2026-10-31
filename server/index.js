import express from 'express';
import multer from 'multer';
import { rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AUDIO_DIR, getActionItems, getMentions, getRecording, getSegments, insertRecording, listRecordings,
  searchSegments, setActionItemStatus,
} from './db.js';
import { enqueue, resumeUnfinished } from './ingest.js';

const app = express();
const upload = multer({ dest: `${AUDIO_DIR}/tmp`, limits: { fileSize: 20 * 1024 * 1024 } });

// ISO 8601 with an explicit zone, e.g. 2026-11-05T14:32:10+05:30 or ...Z
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// "rec-01" + "2026-11-05T14:32:10+05:30" -> "rec-01_2026-11-05T14-32-10"
export function recordingId(deviceId, recordedAt) {
  return `${deviceId}_${recordedAt.slice(0, 19).replaceAll(':', '-')}`;
}

function optionalInt(value) {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

app.use(express.static('public'));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/recordings', (req, res) => res.json(listRecordings()));

app.get('/api/recordings/:id', (req, res) => {
  const rec = getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  const { file_path, ...rest } = rec; // don't expose server paths
  res.json({
    ...rest,
    segments: getSegments(rec.id),
    action_items: getActionItems(rec.id),
    mentions: getMentions(rec.id),
  });
});

app.patch('/api/action-items/:id', express.json(), (req, res) => {
  const { status } = req.body ?? {};
  if (status !== 'open' && status !== 'done') return res.status(400).json({ error: "status must be 'open' or 'done'" });
  if (!setActionItemStatus(Number(req.params.id), status)) return res.status(404).json({ error: 'action item not found' });
  res.json({ ok: true });
});

// sendFile supports HTTP Range requests, which the <audio> element needs to seek.
app.get('/api/recordings/:id/audio', (req, res) => {
  const rec = getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  res.sendFile(resolve(rec.file_path));
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q ?? '').slice(0, 200);
  res.json(searchSegments(q));
});

app.post('/upload', upload.single('audio'), async (req, res) => {
  const file = req.file;
  const fail = async (msg) => {
    if (file) await rm(file.path, { force: true });
    res.status(400).json({ error: msg });
  };

  if (!file) return fail("missing 'audio' file");

  const { device_id, recorded_at } = req.body;
  if (!device_id || !/^[\w-]{1,64}$/.test(device_id)) return fail('invalid device_id');
  if (!recorded_at || !ISO_WITH_ZONE.test(recorded_at) || isNaN(Date.parse(recorded_at))) {
    return fail('recorded_at must be ISO 8601 with a time zone');
  }
  const duration_ms = optionalInt(req.body.duration_ms);
  const battery_pct = optionalInt(req.body.battery_pct);
  if (Number.isNaN(duration_ms) || (duration_ms !== null && duration_ms < 0)) return fail('invalid duration_ms');
  if (Number.isNaN(battery_pct) || (battery_pct !== null && (battery_pct < 0 || battery_pct > 100))) {
    return fail('invalid battery_pct');
  }

  const id = recordingId(device_id, recorded_at);

  // A device retry after a lost 201 must not create a duplicate.
  if (getRecording(id)) {
    await rm(file.path, { force: true });
    return res.status(201).json({ id, status: 'saved' });
  }

  const file_path = `${AUDIO_DIR}/${id}.wav`;
  await rename(file.path, file_path);
  insertRecording({ id, device_id, recorded_at, duration_ms, battery_pct, file_path });
  console.log('saved', id, { duration_ms, battery_pct });

  // Answer the device now; transcription happens in the background.
  res.status(201).json({ id, status: 'saved' });
  enqueue(id);
});

const port = Number(process.env.PORT) || 8000;
app.listen(port, '0.0.0.0', () => {
  console.log(`listening on http://0.0.0.0:${port}`);
  resumeUnfinished();
});
