const $ = (sel) => document.querySelector(sel);
const app = $('#app');
const list = $('#list');
const page = $('#page');
const search = $('#search');

const state = { recordings: [], results: null, query: '', current: null };
let audio = null;      // the <audio> element of the open recording
let pollTimer = null;

// ---------- formatting ----------

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Search snippets arrive with \u0002 / \u0003 around matched words.
const snippetHtml = (s) => escapeHtml(s).replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>');

// recorded_at is the device's wall-clock time plus its offset. Show the wall
// clock as written, so a 14:32 meeting reads 14:32 whatever the viewer's zone.
function wallClock(iso) {
  const [y, mo, d, h, mi, s] = iso.slice(0, 19).split(/[-T:]/).map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}
const fmtDay = (iso) => wallClock(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShortDay = (iso) => wallClock(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso) => iso.slice(11, 16);

function fmtClock(seconds) {
  const t = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STATUS = {
  received: 'Waiting to transcribe',
  transcribing: 'Transcribing',
  transcribed: 'Transcribed',
  ready: 'Ready',
  error: 'Failed',
};
const isPending = (status) => status === 'received' || status === 'transcribing';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// ---------- routing: #<id> or #<id>@<seconds> ----------

function readHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  if (!raw) return { id: null, t: null };
  const at = raw.lastIndexOf('@');
  return at === -1 ? { id: raw, t: null } : { id: raw.slice(0, at), t: Number(raw.slice(at + 1)) };
}

function openRecording(id, t = null) {
  const hash = '#' + encodeURIComponent(id) + (t != null ? '@' + t : '');
  if (location.hash === hash) route(); else location.hash = hash;
}

async function route() {
  const { id, t } = readHash();
  clearTimeout(pollTimer);
  if (!id) {
    state.current = null;
    app.classList.remove('reading');
    renderStart();
    renderList();
    return;
  }
  try {
    const rec = await getJson(`/api/recordings/${encodeURIComponent(id)}`);
    const sameRecording = state.current?.id === rec.id && audio;
    state.current = rec;
    app.classList.add('reading');
    renderList();
    if (sameRecording) {
      seekTo(t);
    } else {
      renderRecording(rec, t);
    }
    if (isPending(rec.status)) pollTimer = setTimeout(refreshCurrent, 3000);
  } catch {
    state.current = null;
    page.innerHTML = `<div class="doc empty start"><h1>Recording not found</h1>
      <p>It may have been deleted. Pick another recording from the list.</p></div>`;
  }
}

// While a recording is still being transcribed, check back until it's done.
async function refreshCurrent() {
  const id = state.current?.id;
  if (!id) return;
  const rec = await getJson(`/api/recordings/${encodeURIComponent(id)}`).catch(() => null);
  if (!rec || state.current?.id !== id) return;
  if (rec.status !== state.current.status) {
    state.current = rec;
    renderRecording(rec, audio?.currentTime ?? null);
    loadRecordings();
  }
  if (isPending(rec.status)) pollTimer = setTimeout(refreshCurrent, 3000);
}

// ---------- sidebar ----------

async function loadRecordings() {
  state.recordings = await getJson('/api/recordings');
  renderList();
}

function renderList() {
  if (state.results) return renderResults();
  const recs = state.recordings;
  if (!recs.length) {
    list.innerHTML = `<p class="side-note">No recordings yet. Hold the button on the recorder, or load a folder with
      <code>node scripts/seed.js &lt;folder&gt;</code>.</p>`;
    return;
  }
  let html = '';
  let day = null;
  for (const r of recs) {
    const d = r.recorded_at.slice(0, 10);
    if (d !== day) {
      day = d;
      html += `<div class="day">${escapeHtml(fmtDay(r.recorded_at))}</div>`;
    }
    const sub = r.status === 'error' ? 'Transcription failed'
      : isPending(r.status) ? STATUS[r.status] + '…'
      : r.preview ? escapeHtml(r.preview) : 'No speech detected';
    html += `<button class="item" data-id="${escapeHtml(r.id)}" ${state.current?.id === r.id ? 'aria-current="true"' : ''}>
      <span class="time">${fmtTime(r.recorded_at)}</span>
      <span class="title">${escapeHtml(r.device_id)} · ${fmtClock((r.duration_ms ?? 0) / 1000)}</span>
      <span class="sub">${sub}</span>
    </button>`;
  }
  list.innerHTML = html;
}

function renderResults() {
  const results = state.results;
  if (!results.length) {
    list.innerHTML = `<p class="side-note">No transcript mentions “${escapeHtml(state.query)}”.</p>`;
    return;
  }
  list.innerHTML = `<div class="day">${results.length === 50 ? 'Top 50 matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}</div>` +
    results.map((r) => `<button class="item" data-id="${escapeHtml(r.recording_id)}" data-t="${r.start_s}" data-idx="${r.idx}">
      <span class="time">${fmtClock(r.start_s)}</span>
      <span class="title">${escapeHtml(fmtShortDay(r.recorded_at))}, ${fmtTime(r.recorded_at)} · ${escapeHtml(r.device_id)}</span>
      <span class="sub">${snippetHtml(r.snippet)}</span>
    </button>`).join('');
}

list.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  state.foundIdx = item.dataset.idx != null ? Number(item.dataset.idx) : null;
  openRecording(item.dataset.id, item.dataset.t != null ? Number(item.dataset.t) : null);
});

let searchTimer = null;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});

async function runSearch() {
  const q = search.value.trim();
  state.query = q;
  if (!q) {
    state.results = null;
    return renderList();
  }
  const results = await getJson(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []);
  if (search.value.trim() !== q) return; // a newer search is on its way
  state.results = results;
  renderList();
}

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    search.focus();
    search.select();
  } else if (e.key === 'Escape' && document.activeElement === search) {
    search.value = '';
    runSearch();
    search.blur();
  } else if (e.key === ' ' && !typing && audio && !e.target.closest('button')) {
    e.preventDefault();
    togglePlay();
  }
});

// ---------- page ----------

function renderStart() {
  audio = null;
  page.innerHTML = state.recordings.length
    ? `<div class="doc empty start"><h1>Pick a recording</h1>
        <p>Choose one from the list to read its transcript and play it back, or search every transcript at once.</p></div>`
    : `<div class="doc empty start"><h1>No recordings yet</h1>
        <p>Recordings appear here when the recorder uploads them. To load sample recordings, run
        <code>node scripts/seed.js &lt;folder&gt;</code>.</p></div>`;
}

function renderRecording(rec, t) {
  const segs = rec.segments;
  const battery = rec.battery_pct == null ? 'USB power' : `${rec.battery_pct}%`;

  let body;
  if (rec.status === 'error') {
    body = `<div class="empty"><p>Transcription failed: ${escapeHtml(rec.error ?? 'unknown error')}</p>
      <p>Restart the server to try again.</p></div>`;
  } else if (isPending(rec.status)) {
    body = `<div class="empty"><p>${STATUS[rec.status]}… The transcript will appear here when it's done.</p></div>`;
  } else if (!segs.length) {
    body = `<div class="empty"><p>No speech detected in this recording.</p></div>`;
  } else {
    body = `<div class="transcript">${segs.map((s) => `
      <button class="seg" data-idx="${s.idx}" data-t="${s.start_s}">
        <span class="ts">${fmtClock(s.start_s)}</span><span>${escapeHtml(s.text)}</span>
      </button>`).join('')}</div>`;
  }

  page.innerHTML = `<article class="doc">
    <button class="back" type="button">‹ All recordings</button>
    <h1>${escapeHtml(fmtShortDay(rec.recorded_at))}, ${fmtTime(rec.recorded_at)}</h1>
    <dl class="props">
      <dt>Recorded</dt><dd class="mono">${escapeHtml(rec.recorded_at)}</dd>
      <dt>Device</dt><dd>${escapeHtml(rec.device_id)}</dd>
      <dt>Length</dt><dd class="mono">${fmtClock((rec.duration_ms ?? 0) / 1000)}</dd>
      <dt>Battery</dt><dd>${battery}</dd>
      <dt>Status</dt><dd><span class="pill ${rec.status === 'error' ? 'error' : ''}">${STATUS[rec.status] ?? rec.status}</span></dd>
    </dl>
    <div class="player">
      <button class="play" type="button" aria-label="Play">${ICON_PLAY}</button>
      <div class="track" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuenow="0">
        ${segs.map((s) => `<span class="tick" data-idx="${s.idx}"></span>`).join('')}
        <span class="head"></span>
      </div>
      <span class="clock">00:00 / ${fmtClock((rec.duration_ms ?? 0) / 1000)}</span>
      <audio preload="metadata" src="/api/recordings/${encodeURIComponent(rec.id)}/audio"></audio>
    </div>
    ${body}
  </article>`;

  page.scrollTop = 0;
  setupPlayer(rec, t);
}

page.addEventListener('click', (e) => {
  if (e.target.closest('.back')) {
    location.hash = '';
    return;
  }
  const seg = e.target.closest('.seg');
  if (seg) {
    seekTo(Number(seg.dataset.t));
    audio.play();
  }
});

// ---------- player ----------

const ICON_PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="1.5" width="2.5" height="9" rx=".5"/><rect x="7" y="1.5" width="2.5" height="9" rx=".5"/></svg>';

function duration() {
  return Number.isFinite(audio?.duration) && audio.duration > 0
    ? audio.duration
    : (state.current?.duration_ms ?? 0) / 1000;
}

function togglePlay() {
  if (!audio) return;
  audio.paused ? audio.play() : audio.pause();
}

function seekTo(t) {
  if (!audio || t == null || !Number.isFinite(t)) return;
  audio.currentTime = t;
  update();
  const idx = state.foundIdx;
  page.querySelectorAll('.seg.found').forEach((el) => el.classList.remove('found'));
  if (idx != null) page.querySelector(`.seg[data-idx="${idx}"]`)?.classList.add('found');
  page.querySelector(`.seg[data-idx="${idx ?? activeIdx(t)}"]`)?.scrollIntoView({ block: 'center' });
}

function activeIdx(t) {
  const segs = state.current?.segments ?? [];
  let found = null;
  for (const s of segs) if (s.start_s <= t + 0.05) found = s.idx;
  return found;
}

function layoutTicks() {
  const d = duration();
  if (!d) return;
  for (const s of state.current.segments) {
    const tick = page.querySelector(`.tick[data-idx="${s.idx}"]`);
    if (!tick) continue;
    // Clamp so a segment that claims to run past the end can't overflow the bar.
    const left = Math.min(100, (s.start_s / d) * 100);
    const right = Math.min(100, (s.end_s / d) * 100);
    tick.style.left = `${left}%`;
    tick.style.width = `${Math.max(0, right - left - 0.4)}%`;
  }
}

let lastActive = null;
function update() {
  if (!audio) return;
  const d = duration();
  const t = audio.currentTime;
  page.querySelector('.head').style.left = d ? `${(t / d) * 100}%` : '0';
  page.querySelector('.clock').textContent = `${fmtClock(t)} / ${fmtClock(d)}`;
  const track = page.querySelector('.track');
  track.setAttribute('aria-valuemax', String(Math.round(d)));
  track.setAttribute('aria-valuenow', String(Math.round(t)));
  track.setAttribute('aria-valuetext', fmtClock(t));

  for (const s of state.current.segments) {
    page.querySelector(`.tick[data-idx="${s.idx}"]`)?.classList.toggle('past', s.start_s <= t);
  }

  const idx = activeIdx(t);
  if (idx !== lastActive) {
    page.querySelector('.seg.now')?.classList.remove('now');
    const el = page.querySelector(`.seg[data-idx="${idx}"]`);
    el?.classList.add('now');
    // Follow along while playing, but only scroll when the line has left the view.
    if (el && !audio.paused) {
      const r = el.getBoundingClientRect();
      if (r.top < 90 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    lastActive = idx;
  }
}

function setupPlayer(rec, t) {
  audio = page.querySelector('audio');
  lastActive = null;
  const playBtn = page.querySelector('.play');
  const track = page.querySelector('.track');

  audio.addEventListener('loadedmetadata', () => { layoutTicks(); update(); });
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('play', () => { playBtn.innerHTML = ICON_PAUSE; playBtn.setAttribute('aria-label', 'Pause'); });
  audio.addEventListener('pause', () => { playBtn.innerHTML = ICON_PLAY; playBtn.setAttribute('aria-label', 'Play'); });
  audio.addEventListener('error', () => {
    page.querySelector('.clock').textContent = 'Audio unavailable';
  });
  playBtn.addEventListener('click', togglePlay);

  const seekFromPointer = (e) => {
    const r = track.getBoundingClientRect();
    audio.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration();
    update();
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    seekFromPointer(e);
    track.addEventListener('pointermove', seekFromPointer);
    track.addEventListener('pointerup', () => track.removeEventListener('pointermove', seekFromPointer), { once: true });
  });
  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowRight') audio.currentTime = Math.min(duration(), audio.currentTime + step);
    else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - step);
    else return;
    e.preventDefault();
    update();
  });

  layoutTicks();
  if (t != null) audio.addEventListener('loadedmetadata', () => seekTo(t), { once: true });
  else state.foundIdx = null;
}

// ---------- start ----------

window.addEventListener('hashchange', route);
loadRecordings().then(route).catch(() => {
  list.innerHTML = '<p class="side-note">Can’t reach the server. Check that it’s running, then reload.</p>';
});
