import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDoc } from '@/lib/server/db';
import { DocPage } from '@/components/DocView';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: getDoc(Number((await params).id))?.title ?? 'Doc' };
}

export default async function Page({ params }: Props) {
  const doc = getDoc(Number((await params).id));
  if (!doc) notFound();
  return (
    <div className="doc">
      <Link href="/docs" className="back">‹ All docs</Link>
      <DocPage doc={doc} />
    </div>
  );
}
