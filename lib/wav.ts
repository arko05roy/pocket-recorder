// Browser only. The upload contract (shared with the ESP32) and Whisper both
// take WAV, so the record page captures raw samples and writes WAV itself.
export const RATE = 16000;

// Average each group of input samples down to 16 kHz. The mic runs at the
// device's own rate (usually 44.1 or 48 kHz).
export function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === RATE) return input;
  const ratio = fromRate / RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let n = 0; n < out.length; n++) {
    const a = Math.floor(n * ratio), b = Math.min(input.length, Math.floor((n + 1) * ratio));
    let sum = 0;
    for (let k = a; k < b; k++) sum += input[k];
    out[n] = sum / Math.max(1, b - a);
  }
  return out;
}

// 16-bit PCM, mono, 16 kHz.
export function encodeWav(pcm: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const ascii = (at: number, s: string) => [...s].forEach((c, n) => view.setUint8(at + n, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let n = 0; n < pcm.length; n++) {
    const s = Math.max(-1, Math.min(1, pcm[n]));
    view.setInt16(44 + n * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export const rms = (s: Float32Array, from = 0, to = s.length) => {
  let sum = 0;
  for (let n = from; n < to; n++) sum += s[n] * s[n];
  return Math.sqrt(sum / Math.max(1, to - from));
};
