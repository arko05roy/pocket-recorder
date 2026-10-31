import { listRecordings } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export default function RecordingsPage() {
  const any = listRecordings().length > 0;
  return (
    <div className="doc empty start">
      {any ? (
        <>
          <h1>Pick a recording</h1>
          <p>Choose one from the list to read its transcript and play it back, or search every transcript at once.</p>
        </>
      ) : (
        <>
          <h1>No recordings yet</h1>
          <p>
            Recordings appear here when the recorder uploads them. To load sample recordings, run{' '}
            <code>npm run seed &lt;folder&gt;</code>.
          </p>
        </>
      )}
    </div>
  );
}
