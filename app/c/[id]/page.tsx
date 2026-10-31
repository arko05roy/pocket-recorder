import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChat, listChats } from '@/lib/server/db';
import Studio, { type Turn } from '@/components/studio/Studio';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Chat' };

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{8,64}$/.test(id)) notFound();
  const chat = getChat(id);
  // key: switching chats gets a fresh studio instead of reusing the old state.
  return <Studio key={id} chatId={id} initialTurns={(chat?.turns ?? []) as Turn[]} chats={listChats()} />;
}
