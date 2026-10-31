'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { RecordingDetail } from '@/lib/types';
import { fmtClock } from '@/lib/format';

export interface PlayerHandle {
  seek: (t: number) => void;
  play: () => void;
}

// Audio player whose scrub bar shows a tick for every transcript segment.
// The parent controls it through a ref (seek/play) and hears the time via onTime.
export default function Player({ rec, onTime, ref }: {
  rec: RecordingDetail;
  onTime: (t: number) => void;
  ref: Ref<PlayerHandle>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);

  const duration = mediaDuration > 0 ? mediaDuration : (rec.duration_ms ?? 0) / 1000;

  const seek = (t: number) => {
    const el = audio.current;
    if (!el || !Number.isFinite(t)) return;
    el.currentTime = Math.min(Math.max(0, t), duration || t);
    setTime(el.currentTime);
    onTime(el.currentTime);
  };

  useImperativeHandle(ref, () => ({ seek, play: () => void audio.current?.play() }));

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play(); else el.pause();
  };

  // Space plays and pauses, unless you're typing or on a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== ' ' || /INPUT|TEXTAREA/.test(target.tagName) || target.closest('button')) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const seekFromPointer = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    seek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration);
  };

  const pct = (s: number) => (duration ? Math.min(100, (s / duration) * 100) : 0);

  return (
    <div className="player">
      <button className="play" type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="1.5" width="2.5" height="9" rx=".5" /><rect x="7" y="1.5" width="2.5" height="9" rx=".5" /></svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" /></svg>
        )}
      </button>
      <div
        ref={track}
        className="track"
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={fmtClock(time)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 5;
          if (e.key === 'ArrowRight') seek(time + step);
          else if (e.key === 'ArrowLeft') seek(time - step);
          else return;
          e.preventDefault();
        }}
      >
        {rec.segments.map((s) => {
          // Clamp so a segment that claims to run past the end can't overflow the bar.
          const left = pct(s.start_s);
          const width = Math.max(0, pct(s.end_s) - left - 0.4);
          return (
            <span key={s.idx} className={`tick${s.start_s <= time ? ' past' : ''}`} style={{ left: `${left}%`, width: `${width}%` }} />
          );
        })}
        <span className="head" style={{ left: `${pct(time)}%` }} />
      </div>
      <span className="clock">{fmtClock(time)} / {fmtClock(duration)}</span>
      <audio
        ref={audio}
        preload="metadata"
        src={`/api/recordings/${encodeURIComponent(rec.id)}/audio`}
        onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}
