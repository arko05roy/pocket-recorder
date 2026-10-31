'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { concat, downsample, encodeWav, rms } from '@/lib/wav';

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'saving';

const CHUNK_S = 3;        // send audio about this often
const SEARCH_S = 1;       // ...cutting at the quietest moment in the last second
const SILENT_RMS = 0.006; // chunks quieter than this aren't sent (Whisper invents text on silence)

// Copies every block of mic samples to the page. Runs on the audio thread.
const TAP = `registerProcessor('pcm-tap', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;

// recorded_at must carry the zone: 2026-11-05T14:32:10+05:30
function localIso(d: Date) {
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`;
}

// Where to end a chunk: the quietest 50 ms window in its last SEARCH_S
// seconds, so a word is rarely cut in half.
function cutPoint(s: Float32Array, rate: number) {
  const win = Math.round(rate * 0.05);
  let best = s.length, quietest = Infinity;
  for (let at = Math.max(0, s.length - rate * SEARCH_S); at + win <= s.length; at += win) {
    const level = rms(s, at, at + win);
    if (level < quietest) { quietest = level; best = at + win; }
  }
  return best;
}

// Records from the mic, sends ~3 s chunks to Whisper (text comes back through
// onText, in order), and on stop uploads the whole clip as WAV through the
// same POST /upload the ESP32 uses. Resolves stop() with the recording id.
export function useLiveRecorder(onText: (text: string, soFar: string) => void) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audio = useRef<{ stream: MediaStream; ctx: AudioContext; rate: number; all: Float32Array[]; pending: Float32Array[] } | null>(null);
  const started = useRef<Date | null>(null);
  const transcript = useRef('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // Chunks go to Whisper one after another, so their text lands in order.
  const send = useCallback((samples: Float32Array, rate: number) => {
    if (rms(samples) < SILENT_RMS) return;
    queue.current = queue.current.then(async () => {
      setHearing(true);
      try {
        const pcm = downsample(samples, rate);
        const form = new FormData();
        form.set('audio', encodeWav(pcm), 'chunk.wav');
        form.set('prompt', transcript.current);
        const res = await fetch('/api/live/chunk', { method: 'POST', body: form });
        const text: string = res.ok ? (await res.json()).text : '';
        if (text) {
          transcript.current = `${transcript.current} ${text}`.trim();
          onTextRef.current(text, transcript.current);
        }
      } catch {}
      setHearing(false);
    });
  }, []);

  const start = useCallback(async () => {
    setPhase('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      source.connect(node);
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const tap = new AudioWorkletNode(ctx, 'pcm-tap');
      const mute = ctx.createGain();
      mute.gain.value = 0; // the tap must reach the output to run; keep it silent
      source.connect(tap).connect(mute).connect(ctx.destination);
      const a = { stream, ctx, rate: ctx.sampleRate, all: [] as Float32Array[], pending: [] as Float32Array[] };
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => { a.all.push(e.data); a.pending.push(e.data); };
      audio.current = a;
      transcript.current = '';
      started.current = new Date();
      setElapsed(0);
      setAnalyser(node);
      setPhase('recording');
    } catch (err) {
      setPhase('idle');
      throw err instanceof DOMException && err.name === 'NotAllowedError'
        ? new Error('Microphone access was blocked. Allow it in the browser’s site settings and try again.')
        : new Error(`Could not start recording: ${(err as Error).message}`);
    }
  }, []);

  // Every 250 ms: once CHUNK_S seconds are waiting, cut and send them.
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      setElapsed((Date.now() - started.current!.getTime()) / 1000);
      const a = audio.current;
      if (!a) return;
      const waiting = a.pending.reduce((n, p) => n + p.length, 0);
      if (waiting < a.rate * CHUNK_S) return;
      const s = concat(a.pending);
      const cut = cutPoint(s, a.rate);
      a.pending = cut < s.length ? [s.slice(cut)] : [];
      send(s.slice(0, cut), a.rate);
    }, 250);
    return () => clearInterval(timer);
  }, [phase, send]);

  const stop = useCallback(async (): Promise<string> => {
    const a = audio.current;
    if (!a || !started.current) throw new Error('Not recording');
    setPhase('saving');
    a.stream.getTracks().forEach((t) => t.stop());
    await a.ctx.close();
    setAnalyser(null);
    send(concat(a.pending), a.rate); // the last few seconds
    a.pending = [];
    audio.current = null;
    try {
      const pcm = downsample(concat(a.all), a.rate);
      const form = new FormData();
      form.set('audio', encodeWav(pcm), 'recording.wav');
      form.set('device_id', 'web-app');
      form.set('recorded_at', localIso(started.current));
      form.set('duration_ms', String(Math.round((pcm.length / 16000) * 1000)));
      form.set('battery_pct', '');
      const res = await fetch('/upload', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`);
      await queue.current; // let the last chunk's text arrive first
      return body.id as string;
    } finally {
      setPhase('idle');
    }
  }, [send]);

  // Leaving the page mid-recording releases the microphone.
  useEffect(() => () => {
    audio.current?.stream.getTracks().forEach((t) => t.stop());
    audio.current?.ctx.close().catch(() => {});
  }, []);

  return { phase, elapsed, hearing, analyser, start, stop };
}
