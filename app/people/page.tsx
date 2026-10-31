import type { Metadata } from 'next';
import { listPeople } from '@/lib/server/db';
import PeopleIndex from '@/components/studio/PeopleIndex';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'People' };

export default function PeoplePage() {
  return <PeopleIndex people={listPeople()} />;
}
