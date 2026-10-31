import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getRecording } from '@/lib/server/db';

// Serves the WAV with HTTP Range support. The <audio> element asks for
// "Range: bytes=start-end" when you seek; without a 206 reply, seeking breaks.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = getRecording(id);
  if (!rec) return Response.json({ error: 'recording not found' }, { status: 404 });

  const size = (await stat(rec.file_path)).size;
  const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');

  if (!range) {
    const body = Readable.toWeb(createReadStream(rec.file_path)) as ReadableStream;
    return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } });
  }

  // "bytes=100-" means from 100 to the end; "bytes=-100" means the last 100 bytes.
  let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
  let end = range[1] === '' || range[2] === '' ? size - 1 : Number(range[2]);
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const body = Readable.toWeb(createReadStream(rec.file_path, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}
