import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIO_DIR, getRecording, insertRecording } from '@/lib/server/db';
import { enqueue } from '@/lib/server/ingest';

// The hand-off contract: POST /upload, multipart/form-data with
// audio, device_id, recorded_at, duration_ms, battery_pct.

// ISO 8601 with an explicit zone, e.g. 2026-11-05T14:32:10+05:30 or ...Z
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_BYTES = 20 * 1024 * 1024;

// "rec-01" + "2026-11-05T14:32:10+05:30" -> "rec-01_2026-11-05T14-32-10"
function recordingId(deviceId: string, recordedAt: string) {
  return `${deviceId}_${recordedAt.slice(0, 19).replaceAll(':', '-')}`;
}

function optionalInt(value: FormDataEntryValue | null) {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

const fail = (error: string) => Response.json({ error }, { status: 400 });

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('expected multipart/form-data');
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) return fail("missing 'audio' file");
  if (audio.size > MAX_BYTES) return fail('audio file is larger than 20 MB');

  const device_id = form.get('device_id');
  const recorded_at = form.get('recorded_at');
  if (typeof device_id !== 'string' || !/^[\w-]{1,64}$/.test(device_id)) return fail('invalid device_id');
  if (typeof recorded_at !== 'string' || !ISO_WITH_ZONE.test(recorded_at) || isNaN(Date.parse(recorded_at))) {
    return fail('recorded_at must be ISO 8601 with a time zone');
  }
  const duration_ms = optionalInt(form.get('duration_ms'));
  const battery_pct = optionalInt(form.get('battery_pct'));
  if (Number.isNaN(duration_ms) || (duration_ms !== null && duration_ms < 0)) return fail('invalid duration_ms');
  if (Number.isNaN(battery_pct) || (battery_pct !== null && (battery_pct < 0 || battery_pct > 100))) {
    return fail('invalid battery_pct');
  }

  const id = recordingId(device_id, recorded_at);

  // A device retry after a lost 201 must not create a duplicate.
  if (getRecording(id)) return Response.json({ id, status: 'saved' }, { status: 201 });

  const file_path = join(AUDIO_DIR, `${id}.wav`);
  await writeFile(file_path, Buffer.from(await audio.arrayBuffer()));
  insertRecording({ id, device_id, recorded_at, duration_ms, battery_pct, file_path });
  console.log('saved', id, { duration_ms, battery_pct });

  // Answer the device now; transcription happens in the background.
  enqueue(id);
  return Response.json({ id, status: 'saved' }, { status: 201 });
}
