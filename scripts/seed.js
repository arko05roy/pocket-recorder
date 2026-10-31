// Load a folder of recordings described by manifest.json into the running server.
// Usage: node scripts/seed.js <folder> [server-url]
//
// It uploads through POST /upload, the same contract the ESP32 uses, so the
// seed path and the device path can never drift apart.
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { probeDurationMs } from '../server/audio.js';

const [folder, server = 'http://localhost:8000'] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node scripts/seed.js <folder> [server-url]');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
let failed = 0;

for (const entry of manifest) {
  const path = join(folder, entry.file);
  try {
    const form = new FormData();
    form.append('audio', new Blob([await readFile(path)], { type: 'audio/wav' }), basename(path));
    form.append('device_id', entry.device_id);
    form.append('recorded_at', entry.recorded_at);
    form.append('duration_ms', String(await probeDurationMs(path)));
    form.append('battery_pct', '');

    const res = await fetch(`${server}/upload`, { method: 'POST', body: form });
    const body = await res.json();
    if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(body)}`);
    console.log('ok  ', entry.file, '->', body.id);
  } catch (err) {
    failed++;
    console.error('FAIL', entry.file, err.message);
  }
}

console.log(`${manifest.length - failed}/${manifest.length} uploaded`);
process.exit(failed ? 1 : 0);
