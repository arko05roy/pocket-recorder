import { subscribe, type LiveEvent } from '@/lib/server/live';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

// Server-Sent Events: one line per recording change, for as long as the tab is open.
export function GET(request: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      // Safari holds back the first 1 KB of a stream; pad past it so the
      // first real event isn't stuck behind it. Lines starting ":" are comments.
      send(`:${' '.repeat(2048)}\n\n`);
      // Recording changes go out as plain messages; device events are named
      // ("event: device") so the page shows a pop-up instead of refreshing.
      const unsubscribe = subscribe((e: LiveEvent) => send(e.type === 'device'
        ? `event: device\ndata: ${JSON.stringify(e.device)}\n\n`
        : `data: ${JSON.stringify(e.change)}\n\n`));
      // Idle connections get closed by proxies and some browsers; a comment
      // every 25 s keeps this one open.
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
