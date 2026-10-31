import type { Metadata } from 'next';
import { getGraph } from '@/lib/server/db';
import GraphExplorer from '@/components/studio/GraphExplorer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Graph' };

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  return <GraphExplorer graph={getGraph()} focus={typeof focus === 'string' ? focus : null} />;
}
