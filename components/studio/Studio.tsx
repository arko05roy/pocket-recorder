'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoiceOrb, type VoiceOrbState } from '@/components/assistant-ui/elements/voice';
import { StreamingText, type Segment } from '@/components/assistant-ui/elements/streaming-text';
import type { Answer, CleanTurn, Doc, Entity, LiveCard, LiveLine, LiveState, NodeProfile, Recap, RecapState, Relation } from '@/lib/types';
import { fmtClock, recordingHref } from '@/lib/format';
import { Parts, ProposalList } from '../Answer';
import { DocCard } from '../DocView';
import { useLiveRecorder } from '../useLiveRecorder';
import { CardView } from './Cards';
import { RecapCard } from './RecapCard';
import Constellation from './Constellation';
import PersonCard from './PersonCard';
import { chipStyle, personPalette, type Palette } from './colors';

export type Turn =
  | { kind: 'voice'; id: number; lines: LiveLine[]; live: LiveState; updating?: boolean; savedId: string | null; durationS: number; inGraph?: boolean; docAsked?: boolean; actAsked?: boolean; recap?: RecapState; recordedAt?: string }
  | { kind: 'user'; text: string }
  | { kind: 'answer'; answer: Answer }
  | { kind: 'error'; text: string };
type Voice = Extract<Turn, { kind: 'voice' }>;

const EMPTY: LiveState = { cards: [], entities: [], relations: [] };

// A doc is written only when the voice note asks for one in so many words.
// The graph holds proper nouns only; items, dates and amounts stay in the cards.
const GRAPH_TYPES = new Set<Entity['type']>(['person', 'place', 'org']);

const ASKS_FOR_DOC = /(?<![\p{L}])(docs?|documents?|documentation|write[- ]?up|memo)(?![\p{L}])/iu;


const PROMPTS = [
  { label: 'Take an order', hint: '“Two oat lattes for Priya, one masala chai for Sam…”', record: true },
  { label: 'Map a team', hint: '“Paruk is Atharv’s boss. Atharv works with Mei on the launch…”', record: true },
  { label: 'Ask the archive', hint: 'What did I agree to do this week?', record: false },
];

export default function Studio({ chatId, initialTurns, chats }: {
  chatId: string;
  initialTurns: Turn[];
  chats: { id: string; title: string; updated_at: string }[];
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(() => initialTurns.map((t) => (t.kind === 'voice'
    ? { ...t, updating: false, recap: t.recap && (t.recap.stage === 'cleaning' || t.recap.stage === 'writing') ? { ...t.recap, stage: 'error' as const, error: 'The page reloaded before the report was finished.' } : t.recap }
    : t)));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [acting, setActing] = useState(0); // voice notes being turned into events and drafts
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<'chat' | 'board'>('chat');
  const [graphVersion, setGraphVersion] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const voiceId = useRef(Math.max(0, ...initialTurns.map((t) => (t.kind === 'voice' ? t.id : 0))));
  // The live job for the voice note being recorded: one request at a time,
  // and one more run if text arrived meanwhile.
  const live = useRef({ id: 0, lines: [] as LiveLine[], cards: [] as LiveCard[], running: false, again: false });

  const patchVoice = useCallback((id: number, patch: (t: Voice) => Partial<Voice>) => {
    setTurns((all) => all.map((t) => (t.kind === 'voice' && t.id === id ? { ...t, ...patch(t) } : t)));
  }, []);

  // Save the whole thread a moment after it changes. Nothing is saved until
  // something is said or asked. The first save creates the chat, so the list
  // is refreshed once to show it. (known and router are read through a ref:
  // as effect dependencies they change on every refresh and re-trigger saves.)
  const known = chats.some((c) => c.id === chatId);
  const latest = useRef({ known, router });
  latest.current = { known, router };
  useEffect(() => {
    if (!turns.length) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleOf(turns), turns }),
      }).catch(() => null);
      if (res?.ok && !latest.current.known) latest.current.router.refresh();
    }, 700);
    return () => clearTimeout(timer);
  }, [turns, chatId]);

  // When a voice note is finished (saved, last update done), add what it
  // established to the knowledge graph, once.
  useEffect(() => {
    for (const t of turns) {
      if (t.kind !== 'voice' || !t.savedId || t.updating || t.inGraph || live.current.running) continue;
      patchVoice(t.id, () => ({ inGraph: true }));
      fetch('/api/graph/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: `chat:${chatId}:${t.id}`, lines: t.lines, entities: t.live.entities, relations: t.live.relations }),
      }).then(() => setGraphVersion((v) => v + 1)).catch(() => {});
    }
  }, [turns, chatId, patchVoice]);

  // A finished voice note that asks for a doc ("make a document…") is sent
  // whole to Claude, which writes it up as a doc; the card shows in the chat.
  // docStarted guards against the effect running twice before the docAsked
  // flag lands in state (which once made two copies of a doc).
  // Voice notes the chat opened with are skipped: only notes recorded now get a doc.
  const docStarted = useRef(new Set<number>(initialTurns.flatMap((t) => (t.kind === 'voice' ? [t.id] : []))));
  useEffect(() => {
    for (const t of turns) {
      if (t.kind !== 'voice' || !t.savedId || t.updating || t.docAsked || live.current.running) continue;
      if (docStarted.current.has(t.id)) continue;
      const transcript = t.lines.map((l) => l.text).join(' ').trim();
      if (!transcript || !ASKS_FOR_DOC.test(transcript)) continue; // only when a doc is asked for
      docStarted.current.add(t.id);
      patchVoice(t.id, () => ({ docAsked: true }));
      setBusy(true);
      setDrafting(true);
      fetch('/api/docs/from-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recording_id: t.savedId, transcript }),
      })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) { setTurns((all) => [...all, { kind: 'error', text: body.error ?? 'The doc couldn’t be written.' }]); return; }
          const raw = 'I wrote this up as a doc. Edit it on the Docs page, then finalize and print.';
          setTurns((all) => [...all, { kind: 'answer', answer: { raw, parts: [{ type: 'text', text: raw }], proposals: [], docs: [body as Doc] } }]);
        })
        .catch(() => setTurns((all) => [...all, { kind: 'error', text: 'The server can’t be reached, so the doc wasn’t written.' }]))
        .finally(() => { setBusy(false); setDrafting(false); });
    }
  }, [turns, patchVoice]);

  // Every finished voice note is also handed to the assistant as instructions:
  // meetings to book or move and emails to write come back as event and draft
  // cards to confirm. The assistant cites the saved recording, so this waits
  // until the full transcript is ready (the live one is only a preview).
  const actStarted = useRef(new Set<number>(initialTurns.flatMap((t) => (t.kind === 'voice' ? [t.id] : []))));
  useEffect(() => {
    for (const t of turns) {
      if (t.kind !== 'voice' || !t.savedId || t.updating || t.actAsked || actStarted.current.has(t.id)) continue;
      const transcript = t.lines.map((l) => l.text).join(' ').trim();
      if (!transcript) continue;
      actStarted.current.add(t.id);
      patchVoice(t.id, () => ({ actAsked: true }));
      setActing((n) => n + 1);
      const savedId = t.savedId;
      (async () => {
        for (let tries = 0; tries < 60; tries++) {
          const rec = await fetch(`/api/recordings/${encodeURIComponent(savedId)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (rec?.status === 'ready' || rec?.status === 'error') break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        const content = `I just recorded this voice note: “${transcript.slice(0, 3000)}”\n\n`
          + 'Carry out what I asked for in it. Propose a calendar event for every meeting to book, and for every meeting to move propose it at its new date and time (keep the same time and attendees if I said so). '
          + 'Propose an email draft for every email to write; drafts are never sent. Use the latest version where I corrected myself. '
          + 'Don’t write any document. '
          + 'End with a short read-back of every instruction, saying what you did for each.';
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content }], focus: savedId, docs: false }),
        }).catch(() => null);
        const body = await res?.json().catch(() => null);
        setTurns((all) => [...all, res?.ok && body
          ? { kind: 'answer', answer: body }
          : { kind: 'error', text: body?.error ?? 'The events and drafts from this voice note couldn’t be prepared.' }]);
      })().finally(() => setActing((n) => n - 1));
    }
  }, [turns, patchVoice]);

  // On opening a chat: a voice note that asked for a doc but has no doc card
  // after it (the page reloaded while it was being drafted) gets its card back.
  useEffect(() => {
    const shownDocs = new Set(initialTurns.flatMap((t) => (t.kind === 'answer' ? (t.answer.docs ?? []).map((d) => d.id) : [])));
    for (const t of initialTurns) {
      if (t.kind !== 'voice' || !t.docAsked || !t.savedId) continue;
      fetch(`/api/docs?recording=${encodeURIComponent(t.savedId)}`)
        .then((r) => r.json())
        .then((docs: Doc[]) => {
          const missing = docs.filter((d) => !shownDocs.has(d.id));
          if (!missing.length) return;
          missing.forEach((d) => shownDocs.add(d.id)); // two notes never bring back the same doc
          const raw = 'Your doc is on the Docs page, ready to edit, finalize and print.';
          setTurns((all) => [...all, { kind: 'answer', answer: { raw, parts: [{ type: 'text', text: raw }], proposals: [], docs: missing } }]);
        })
        .catch(() => {});
    }
    // Only for what the chat opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshLive = useCallback(async () => {
    const job = live.current;
    if (job.running) { job.again = true; return; }
    if (!job.lines.length) return;
    job.running = true;
    const id = job.id;
    patchVoice(id, () => ({ updating: true }));
    try {
      const res = await fetch('/api/live/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: job.lines, previous: job.cards.map((c) => ({ kind: c.kind, title: c.title, columns: c.columns })) }),
      });
      if (res.ok) {
        const next: LiveState = await res.json();
        // Don't blank good results because one pass came back empty.
        if (next.cards.length || !job.cards.length) job.cards = next.cards;
        patchVoice(id, (t) => ({
          live: {
            cards: job.cards,
            entities: next.entities.length ? next.entities : t.live.entities,
            relations: next.relations.length ? next.relations : t.live.relations,
          },
        }));
      }
    } catch {}
    job.running = false;
    patchVoice(id, () => ({ updating: false }));
    if (job.again && job.id === id) { job.again = false; refreshLive(); }
  }, [patchVoice]);

  const rec = useLiveRecorder(useCallback((text: string) => {
    const job = live.current;
    job.lines = [...job.lines, { i: job.lines.length, text }];
    patchVoice(job.id, () => ({ lines: job.lines }));
    refreshLive();
  }, [patchVoice, refreshLive]));

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns.length, busy, acting]);

  // The post-recording report: Sonnet cleans the transcript, then Opus writes
  // the report from it. Each result is shown as soon as it lands.
  const makeRecap = useCallback(async (id: number, lines: LiveLine[], recordedAt: string) => {
    if (!lines.length) return;
    const post = async (url: string, body: object) => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      const json = await res?.json().catch(() => null);
      if (!res?.ok) throw new Error(json?.error ?? 'The server can’t be reached.');
      return json;
    };
    patchVoice(id, () => ({ recap: { stage: 'cleaning' } }));
    try {
      const { turns: clean } = (await post('/api/recap/clean', { lines })) as { turns: CleanTurn[] };
      patchVoice(id, () => ({ recap: { stage: 'writing', clean } }));
      const report = (await post('/api/recap/report', { turns: clean, recorded_at: recordedAt })) as Recap;
      patchVoice(id, () => ({ recap: { stage: 'done', clean, report } }));
    } catch (err) {
      patchVoice(id, (t) => ({ recap: { ...t.recap, stage: 'error', error: (err as Error).message } }));
    }
  }, [patchVoice]);

  const startRecording = async () => {
    setError(null);
    const id = ++voiceId.current;
    live.current = { id, lines: [], cards: [], running: false, again: false };
    try {
      await rec.start();
      setTurns((all) => [...all, { kind: 'voice', id, lines: [], live: EMPTY, updating: false, savedId: null, durationS: 0 }]);
      setSelected(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const stopRecording = async () => {
    const id = live.current.id;
    const durationS = rec.elapsed;
    try {
      const savedId = await rec.stop();
      const recordedAt = new Date(Date.now() - durationS * 1000).toISOString();
      patchVoice(id, () => ({ savedId, durationS, recordedAt }));
      refreshLive();
      makeRecap(id, live.current.lines, recordedAt); // straight away, alongside the live cards' last pass
    } catch (err) {
      setTurns((all) => [...all, { kind: 'error', text: `The recording wasn’t saved: ${(err as Error).message}` }]);
    }
  };

  const voices = turns.filter((t): t is Voice => t.kind === 'voice');
  const focus = [...voices].reverse().find((t) => t.savedId);
  const shown = voices.find((v) => v.id === selected) ?? voices.at(-1) ?? null;

  const sendText = async (text = draft) => {
    const q = text.trim();
    if (!q || busy || rec.phase !== 'idle') return;
    const next: Turn[] = [...turns, { kind: 'user', text: q }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    const messages = next.flatMap((t) =>
      t.kind === 'user' ? [{ role: 'user', content: t.text }]
        : t.kind === 'answer' ? [{ role: 'assistant', content: t.answer.raw }]
        : t.kind === 'voice' && t.lines.length ? [{ role: 'user', content: `(I recorded this: “${t.lines.map((l) => l.text).join(' ')}”)` }]
        : [],
    );
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, focus: focus?.savedId ?? undefined }),
      });
      const body = await res.json();
      setTurns((all) => [...all, res.ok ? { kind: 'answer', answer: body } : { kind: 'error', text: body.error ?? 'The assistant didn’t answer. Try again.' }]);
    } catch {
      setTurns((all) => [...all, { kind: 'error', text: 'The server can’t be reached. Check that it’s running, then try again.' }]);
    } finally {
      setBusy(false);
    }
  };

  // Everything heard in this chat, for the graph and the colours. Each entity
  // carries the sentence it came from, shown when its node is hovered.
  const heard = useMemo(() => {
    const entities: (Entity & { said: string })[] = [];
    const relations: Relation[] = [];
    for (const v of voices) {
      for (const e of v.live.entities) entities.push({ ...e, said: v.lines.find((l) => l.i === e.line)?.text ?? '' });
      relations.push(...v.live.relations);
    }
    return { entities, relations };
  }, [voices]);
  const palette = useMemo(() => personPalette(heard.entities), [heard.entities]);
  const graphItems = useMemo(() => {
    const m = new Map<string, { text: string; type: Entity['type']; mentions: number; said: string }>();
    for (const e of heard.entities) {
      if (!GRAPH_TYPES.has(e.type)) continue; // only people, places and organisations
      const k = e.text.toLowerCase();
      const g = m.get(k);
      if (g) g.mentions++; else m.set(k, { text: e.text, type: e.type, mentions: 1, said: e.said });
    }
    return [...m.values()];
  }, [heard.entities]);
  const graphKeys = useMemo(() => new Set(graphItems.map((g) => g.text.toLowerCase())), [graphItems]);
  const graphLinks = useMemo(() => heard.relations.filter((r) => graphKeys.has(r.from.toLowerCase()) && graphKeys.has(r.to.toLowerCase())), [heard.relations, graphKeys]);
  const people = useMemo(() => [...new Map(heard.entities.filter((e) => e.type === 'person').map((e) => [e.text.toLowerCase(), e.text])).values()], [heard.entities]);
  const saved = useSavedProfiles(people, graphVersion);

  const recording = rec.phase !== 'idle';
  const orbState: VoiceOrbState = rec.phase === 'recording' ? 'listening'
    : rec.phase === 'starting' || rec.phase === 'saving' ? 'connecting' : busy ? 'speaking' : 'idle';

  return (
    <div className={`studio${recording ? ' is-live' : ''}`} data-tab={tab}>

      <section className="stage" aria-label="Conversation">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>Chat</button>
          <button role="tab" aria-selected={tab === 'board'} onClick={() => setTab('board')}>
            Board{graphItems.length > 0 && <span className="tab-count">{graphItems.length}</span>}
          </button>
        </div>
        <div className="scroll">
          <div className="column">
            {!turns.length && (
              <div className="hero">
                <div className="hero-orb"><LiveOrb state={orbState} analyser={rec.analyser} /></div>
                <h1>Say it.<br />Watch it take shape.</h1>
                <p>Talk through an order, a meeting or a plan. Tables, timelines and a map of everyone you mention build up while you speak.</p>
                <div className="prompts">
                  {PROMPTS.map((p) => (
                    <button key={p.label} type="button" onClick={() => (p.record ? startRecording() : sendText(p.hint))}>
                      <span className="prompt-label">{p.label}</span>
                      <span className="prompt-hint">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, n) => {
              if (t.kind === 'voice') {
                const isLive = recording && t.id === live.current.id;
                return (
                  <VoiceNote
                    key={n}
                    turn={t}
                    live={isLive}
                    hearing={isLive && rec.hearing}
                    elapsed={isLive ? rec.elapsed : t.durationS}
                    palette={palette}
                    active={shown?.id === t.id}
                    onShow={() => { setSelected(t.id); setTab('board'); }}
                    profiles={notePeople(t).map((name) => mergeProfile(name, heard, saved.get(name.toLowerCase())))}
                  >
                    {t.recap && (
                      <RecapCard recap={t.recap} durationS={t.durationS} onRetry={() => makeRecap(t.id, t.lines, t.recordedAt ?? new Date().toISOString())} />
                    )}
                  </VoiceNote>
                );
              }
              if (t.kind === 'user') return <div key={n} className="msg me"><div className="bubble">{t.text}</div></div>;
              if (t.kind === 'error') return <div key={n} className="msg bot"><p className="err">{t.text}</p></div>;
              return (
                <div key={n} className="msg bot">
                  <div className="bot-mark" aria-hidden="true" />
                  <div className="bot-body">
                    <p className="answer"><Parts parts={t.answer.parts} /></p>
                    {(t.answer.profiles ?? []).map((p) => <PersonCard key={p.id} profile={p} palette={palette} />)}
                    {t.answer.proposals.length > 0 && <ProposalList proposals={t.answer.proposals} />}
                    {(t.answer.docs ?? []).map((d) => <DocCard key={d.id} doc={d} />)}
                  </div>
                </div>
              );
            })}
            {acting > 0 && <div className="msg bot"><div className="bot-mark thinking" aria-hidden="true" /><p className="answer muted">Turning your instructions into calendar events and email drafts…</p></div>}
            {busy && <div className="msg bot"><div className="bot-mark thinking" aria-hidden="true" /><p className="answer muted">{drafting ? 'Writing this up as a doc…' : 'Searching your recordings…'}</p></div>}
            <div ref={end} />
          </div>
        </div>

        <form className="dock" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
          {error && <p className="err dock-err">{error}</p>}
          <div className="dock-bar">
            <button
              type="button"
              className="dock-orb"
              onClick={recording ? stopRecording : startRecording}
              disabled={rec.phase === 'starting' || rec.phase === 'saving' || busy}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            >
              <LiveOrb state={orbState} analyser={rec.analyser} />
            </button>
            {recording ? (
              <div className="dock-live">
                <span className="live-dot" aria-hidden="true" />
                <span className="mono">{rec.phase === 'saving' ? 'Saving…' : fmtClock(rec.elapsed)}</span>
                <Meter analyser={rec.analyser} />
              </div>
            ) : (
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                placeholder={focus ? 'Ask about this recording, or tap the orb to talk' : 'Ask about your recordings, or tap the orb to talk'}
                aria-label="Message"
              />
            )}
            {recording ? (
              <button type="button" className="dock-stop" onClick={stopRecording} disabled={rec.phase === 'saving'}>Stop</button>
            ) : (
              <button type="submit" className="dock-send" disabled={busy || !draft.trim()} aria-label="Send">↑</button>
            )}
          </div>
        </form>
      </section>

      <aside className="board" aria-label="Board">
        <div className="board-graph">
          <div className="board-label">
            <span>Constellation</span>
            <span className="mono">{graphItems.length} nodes · {graphLinks.length} links</span>
          </div>
          <Constellation nodes={graphItems} relations={graphLinks} palette={palette} />
          <Legend />
        </div>
        <div className="board-cards">
          {shown && (shown.live.cards.length > 0 || shown.updating) ? (
            <>
              <div className="board-label">
                <span>{voices.length > 1 ? `Voice note ${voices.indexOf(shown) + 1}` : 'From this voice note'}</span>
                {shown.updating && <span className="updating">updating</span>}
              </div>
              {shown.live.cards.map((c, n) => <CardView key={`${shown.id}-${n}`} card={c} lines={shown.lines} />)}
            </>
          ) : (
            <p className="board-empty">Cards appear here as you talk: orders become tables, plans a timeline, numbers a scoreboard.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

const titleOf = (turns: Turn[]) => {
  for (const t of turns) {
    const text = t.kind === 'user' ? t.text : t.kind === 'voice' ? t.lines.map((l) => l.text).join(' ') : '';
    if (text.trim()) return text.trim().slice(0, 60) + (text.length > 60 ? '…' : '');
  }
  return 'New chat';
};

function VoiceNote({ turn, live, hearing, elapsed, palette, active, onShow, profiles, children }: {
  turn: Voice; live: boolean; hearing: boolean; elapsed: number; palette: Palette; active: boolean; onShow: () => void;
  profiles: ReturnType<typeof mergeProfile>[]; children?: React.ReactNode;
}) {
  const segments = useMemo(() => highlight(turn.lines, turn.live.entities, palette), [turn.lines, turn.live.entities, palette]);
  const cards = turn.live.cards.length;
  return (
    <>
      <div className="msg me">
        <div className={`voice${live ? ' live' : ''}${active ? ' active' : ''}`}>
          <div className="voice-head">
            <span className={live ? 'live-dot' : 'still-dot'} aria-hidden="true" />
            <span>{live ? 'Listening' : 'Voice note'}</span>
            <span className="mono">{fmtClock(elapsed)}</span>
            {hearing && <span className="hearing">transcribing</span>}
          </div>
          {segments.length ? (
            <LiveText segments={segments} streaming={live} />
          ) : <p className="voice-wait">{live ? 'Start talking. Your words appear about three seconds behind you.' : 'No speech was picked up.'}</p>}
          <div className="voice-foot">
            {cards > 0 && <button type="button" onClick={onShow}>{cards} card{cards === 1 ? '' : 's'} on the board</button>}
            {turn.savedId && <Link href={recordingHref(turn.savedId)}>Full transcript ›</Link>}
          </div>
        </div>
        {(turn.live.cards.length > 0 || (live && turn.updating && turn.lines.length > 0)) && (
          <section className="live-tray" aria-label="Built from this voice note" aria-busy={turn.updating}>
            <header className="live-tray-head">
              <span className={`tray-dot${turn.updating ? ' on' : ''}`} aria-hidden="true" />
              <span>{live ? 'Building as you talk' : 'Built from this voice note'}</span>
              <span className="tray-meta">
                {turn.updating ? 'updating…' : `${cards} card${cards === 1 ? '' : 's'}`}
              </span>
            </header>
            {cards > 0 ? (
              <div className="live-tray-grid">
                {turn.live.cards.map((c, k) => (
                  <div key={`${c.kind}-${c.title}-${k}`} className={`tray-item k-${c.kind}`}>
                    <CardView card={c} lines={turn.lines} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="live-tray-grid"><div className="tray-skel" /><div className="tray-skel" /></div>
            )}
          </section>
        )}
        {profiles.length > 0 && (
          <div className="note-people">
            {profiles.map((p) => <PersonCard key={p.name.toLowerCase()} profile={p} palette={palette} isNew />)}
          </div>
        )}
      </div>
      {children}
    </>
  );
}

// People named in one voice note, in order of first mention.
const notePeople = (t: Voice) =>
  [...new Map(t.live.entities.filter((e) => e.type === 'person').map((e) => [e.text.toLowerCase(), e.text])).values()].slice(0, 6);

// What the graph already knew about someone, plus what this chat just said.
function mergeProfile(name: string, heard: { entities: (Entity & { said: string })[]; relations: Relation[] }, saved?: NodeProfile) {
  const key = name.toLowerCase();
  const typeOf = (n: string) => heard.entities.find((e) => e.text.toLowerCase() === n.toLowerCase())?.type ?? 'person';
  const links = [...(saved?.links ?? [])];
  const seen = new Set(links.map((l) => `${l.dir}|${l.label.toLowerCase()}|${l.name.toLowerCase()}`));
  for (const r of heard.relations) {
    const out = r.from.toLowerCase() === key, inn = r.to.toLowerCase() === key;
    if (!out && !inn) continue;
    const other = out ? r.to : r.from;
    const id = `${out ? 'out' : 'in'}|${r.label.toLowerCase()}|${other.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const said = heard.entities.find((e) => e.line === r.line && e.text.toLowerCase() === key)?.said ?? '';
    links.push({ label: r.label, quote: said, dir: out ? 'out' : 'in', name: other, type: typeOf(other) });
  }
  const quotes = [...new Set([...heard.entities.filter((e) => e.text.toLowerCase() === key).map((e) => e.said), ...(saved?.quotes ?? [])])].filter(Boolean);
  return { name: saved?.name ?? name, type: 'person' as const, links, quotes, mentions: saved?.mentions };
}

// Fetch what the saved graph knows about each name, again after new saves.
function useSavedProfiles(names: string[], version: number) {
  const [map, setMap] = useState(new Map<string, NodeProfile>());
  const key = names.map((n) => n.toLowerCase()).sort().join('|');
  useEffect(() => {
    if (!key) return;
    let stop = false;
    Promise.all(key.split('|').map((n) =>
      fetch(`/api/graph/node?name=${encodeURIComponent(n)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    )).then((all: (NodeProfile | null)[]) => {
      if (stop) return;
      setMap(new Map(all.filter((p): p is NodeProfile => !!p).map((p) => [p.name.toLowerCase(), p])));
    });
    return () => { stop = true; };
  }, [key, version]);
  return map;
}

function Legend() {
  const items: [string, Entity['type']][] = [['People', 'person'], ['Places', 'place'], ['Orgs', 'org']];
  return (
    <div className="legend">
      {items.map(([label, type]) => (
        <span key={type}><i style={chipStyle({ text: '', type }, new Map())} />{label}</span>
      ))}
    </div>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The transcript as segments, with every known entity as its own coloured
// chip wherever it appears (whole words only).
function highlight(lines: LiveLine[], entities: Entity[], palette: Palette): Segment[] {
  const terms = new Map<string, Entity>();
  for (const e of entities) if (!terms.has(e.text.toLowerCase())) terms.set(e.text.toLowerCase(), e);
  const sorted = [...terms.values()].sort((a, b) => b.text.length - a.text.length);
  const pattern = sorted.length
    ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(${sorted.map((e) => escape(e.text)).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'giu')
    : null;
  const out: Segment[] = [];
  for (const line of lines) {
    let last = 0;
    for (const m of pattern ? line.text.matchAll(pattern) : []) {
      const e = terms.get(m[0].toLowerCase());
      if (!e || m.index == null) continue;
      if (m.index > last) out.push({ text: line.text.slice(last, m.index) });
      out.push({ text: m[0], className: 'chip', style: chipStyle(e, palette) });
      last = m.index + m[0].length;
    }
    if (last < line.text.length) out.push({ text: line.text.slice(last) });
    out.push({ text: ' ' });
  }
  return out;
}

// Reveal new words a few at a time instead of in a block.
function LiveText({ segments, streaming }: { segments: Segment[]; streaming: boolean }) {
  const total = segments.reduce((n, s) => n + s.text.split(' ').filter(Boolean).length, 0);
  const [count, setCount] = useState(total);
  useEffect(() => {
    if (count >= total) { if (count > total) setCount(total); return; }
    const timer = setTimeout(() => setCount((c) => Math.min(total, c + Math.max(1, Math.ceil((total - c) / 8)))), 45);
    return () => clearTimeout(timer);
  }, [count, total]);
  return <StreamingText segments={segments} count={count} streaming={streaming} className="voice-text" />;
}

// The mic level as a row of bars, next to the clock while recording.
function Meter({ analyser }: { analyser: AnalyserNode | null }) {
  const [bars, setBars] = useState<number[]>(() => Array(28).fill(0));
  useEffect(() => {
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    let frame = 0, last = 0;
    const tick = (now: number) => {
      if (now - last > 70) {
        last = now;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
        setBars((b) => [...b.slice(1), level]);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);
  return (
    <span className="meter" aria-hidden="true">
      {bars.map((b, n) => <i key={n} style={{ transform: `scaleY(${0.12 + b * 0.88})` }} />)}
    </span>
  );
}

// Reads the mic level every frame. Its own component, so 60 updates a second
// re-render only the orb.
function LiveOrb({ state, analyser }: { state: VoiceOrbState; analyser: AnalyserNode | null }) {
  const [volume, setVolume] = useState(0);
  useEffect(() => {
    if (!analyser) { setVolume(0); return; }
    const buf = new Float32Array(analyser.fftSize);
    let smooth = 0, frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      smooth += (Math.min(1, Math.sqrt(sum / buf.length) * 5) - smooth) * 0.25;
      setVolume(smooth);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [analyser]);
  return <VoiceOrb state={state} volume={volume} variant="blue" className="size-full" />;
}
