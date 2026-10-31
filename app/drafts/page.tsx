import type { Metadata } from 'next';
import Link from 'next/link';
import { listDrafts } from '@/lib/server/db';
import { Cite } from '@/components/Answer';
import { CopyButton, DeleteButton, GmailButton } from '@/components/SavedActions';

export const metadata: Metadata = { title: 'Drafts' };
export const dynamic = 'force-dynamic';

export default function DraftsPage() {
  const drafts = listDrafts();
  return (
    <div className="doc">
      <Link href="/recordings" className="back">‹ All recordings</Link>
      <h1>Drafts</h1>
      <p className="none">Drafts are never sent. Open one in Gmail (or copy it) to review and send it yourself.</p>
      {drafts.length ? drafts.map((d) => (
        <div key={d.id} className="proposal">
          <div className="p-meta">To {d.to}</div>
          <div className="p-title">{d.subject}</div>
          <p className="p-body">{d.body}</p>
          <div className="p-foot">
            <Cite cite={d.source} />
            <span className="p-actions">
              <GmailButton to={d.to} subject={d.subject} body={d.body} />
              <CopyButton text={`To: ${d.to}\nSubject: ${d.subject}\n\n${d.body}`} />
              <DeleteButton url={`/api/drafts/${d.id}`} />
            </span>
          </div>
        </div>
      )) : <p className="none">No drafts yet.</p>}
    </div>
  );
}
