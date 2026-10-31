import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getRecordingDetail } from '@/lib/server/db';
import RecordingView from '@/components/RecordingView';

export const dynamic = 'force-dynamic';

// A server component: it reads the database directly, no API call needed.
export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const rec = getRecordingDetail(decodeURIComponent((await params).id));
  if (!rec) notFound();
  // key: a different recording gets a fresh player instead of reusing the old one.
  return (
    <Suspense>
      <RecordingView key={rec.id} rec={rec} />
    </Suspense>
  );
}
