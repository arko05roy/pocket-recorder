import type { NextRequest } from 'next/server';
import { listDocs } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// ?recording=ID: only docs made from that recording (the chat uses this to
// find a doc whose card it missed, e.g. the page reloaded mid-request).
// An empty match is an empty list, never every doc.
export async function GET(request: NextRequest) {
  const rec = request.nextUrl.searchParams.get('recording');
  const docs = listDocs();
  return Response.json(rec != null ? docs.filter((d) => d.sources.some((s) => s.recording_id === rec)) : docs);
}
