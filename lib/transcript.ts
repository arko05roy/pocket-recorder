// Turns an uploaded transcript into segments the rest of the app understands.
// Supports SRT and WebVTT (real timestamps), lines like "[01:23] text" or
// "00:01:23 Speaker: text", and plain text (one segment per line, times
// estimated from word count at ~150 words a minute).

export type Seg = { start: number; end: number; text: string };

const CUE_TIME = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const LINE_TIME = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–:]?\s*(.+)$/;

const secs = (h: string | undefined, m: string, s: string, ms = '0') =>
  Number(h ? h.slice(0, -1) : 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;

function clock(t: string) {
  const parts = t.split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function parseTranscript(raw: string): Seg[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  // SRT / VTT: blocks separated by blank lines, each with a "a --> b" line.
  if (CUE_TIME.test(text)) {
    const out: Seg[] = [];
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => CUE_TIME.test(l));
      if (at < 0) continue;
      const m = lines[at].match(CUE_TIME)!;
      const body = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (body) out.push({ start: secs(m[1], m[2], m[3], m[4]), end: secs(m[5], m[6], m[7], m[8]), text: body });
    }
    return out;
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Every line starts with a timestamp: use them, each line ends where the next starts.
  if (lines.length && lines.every((l) => LINE_TIME.test(l))) {
    const timed = lines.map((l) => { const m = l.match(LINE_TIME)!; return { start: clock(m[1]), text: m[2].trim() }; });
    return timed.map((s, i) => ({ ...s, end: timed[i + 1]?.start ?? s.start + estimate(s.text) }));
  }

  // Plain text: estimate times so lines keep their order and citations still point somewhere.
  let t = 0;
  return lines.map((l) => {
    const s = { start: t, end: t + estimate(l), text: l };
    t = s.end;
    return s;
  });
}

function estimate(text: string) {
  return Math.max(1, (text.split(/\s+/).length / 150) * 60);
}
