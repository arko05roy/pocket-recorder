import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Duration in milliseconds, read from the file itself rather than trusting the client.
export async function probeDurationMs(path: string) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
  ]);
  const seconds = parseFloat(stdout);
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read duration of ${path}`);
  return Math.round(seconds * 1000);
}

// Time ranges [{ start, end }] in seconds where the audio is louder than
// silence. Whisper invents text ("Thank you.") on silent audio, so segments
// that fall outside these ranges are dropped.
export async function soundRanges(path: string, durationS: number) {
  // silencedetect writes its findings to stderr, e.g. "silence_start: 1.2"
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', path,
    '-af', 'silencedetect=noise=-40dB:d=0.5', '-f', 'null', '-',
  ]);
  const ranges: { start: number; end: number }[] = [];
  let soundStart = 0;
  for (const m of stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    const t = parseFloat(m[2]);
    if (m[1] === 'start') {
      if (t > soundStart) ranges.push({ start: soundStart, end: t });
    } else {
      soundStart = t;
    }
  }
  // A silence that runs to the end of the file never prints silence_end.
  const lastWasStart = [...stderr.matchAll(/silence_(start|end)/g)].at(-1)?.[1] === 'start';
  if (!lastWasStart && soundStart < durationS) ranges.push({ start: soundStart, end: durationS });
  return ranges;
}

// Re-encode to 16 kHz, mono, 16-bit WAV. Whatever arrives (an odd header from
// the ESP32, a stereo sample file), the transcriber always gets the same format.
export async function normalise(inPath: string, outPath: string) {
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', inPath,
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath,
  ]);
}
