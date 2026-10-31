import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Every visit to / starts a new chat at its own address. Nothing is saved
// until something is said or asked in it.
export default function Home() {
  redirect(`/c/${randomUUID()}`);
}
