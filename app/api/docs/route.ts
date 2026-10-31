import { listDocs } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// ?recording=ID: only docs made from that recording (the chat uses this to
// find a doc whose card it missed, e.g. the page reloaded mid-request).
export function GET(request: Request) {
  const rec = new URL(request.url).searchParams.get('recording');
  const docs = listDocs();
  return Response.json(rec ? docs.filter((d) => d.sources.some((s) => s.recording_id === rec)) : docs);
}
