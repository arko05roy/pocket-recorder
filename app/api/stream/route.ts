import { subscribe, type Change } from '@/lib/server/live';

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
      const unsubscribe = subscribe((c: Change) => send(`data: ${JSON.stringify(c)}\n\n`));
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
