import type { Metadata } from 'next';
import Chat from '@/components/Chat';

export const metadata: Metadata = { title: 'Ask' };

export default function AskPage() {
  return <Chat />;
}
