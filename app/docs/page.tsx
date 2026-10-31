import type { Metadata } from 'next';
import Link from 'next/link';
import { listDocs } from '@/lib/server/db';

export const metadata: Metadata = { title: 'Docs' };
export const dynamic = 'force-dynamic';

export default function DocsPage() {
  const docs = listDocs();
  return (
    <div className="doc">
      <h1>Docs</h1>
      <p className="none">Ask for a doc in chat and it lands here as a draft. Open one and press Finalize &amp; print to print it through the ESP32.</p>
      {docs.length ? docs.map((d) => (
        <Link key={d.id} href={`/docs/${d.id}`} className="doc-card doc-link">
          <div className="kind">
            <span className={`doc-status ${d.status}`}>{d.status === 'printed' ? 'Printed' : 'Draft'}</span>
            {' · '}{d.created_at.slice(0, 16).replace('T', ' ')}
          </div>
          <div className="p-title">{d.title}</div>
          <div className="pr-faint">{d.sections.map((s) => s.heading).join(' · ')}</div>
        </Link>
      )) : <p className="none">No docs yet. Try asking: “make a doc of today’s meeting”.</p>}
    </div>
  );
}
