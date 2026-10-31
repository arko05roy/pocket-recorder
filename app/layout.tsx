import type { Metadata } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google';
import { listChats, listRecordings } from '@/lib/server/db';
import Shell from '@/components/Shell';
import './globals.css';
import './studio.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = { title: 'Recordings' };

// Read the database on every request; nothing here can be cached at build time.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${display.variable}`}>
      <body>
        <Shell recordings={listRecordings()} chats={listChats()}>{children}</Shell>
      </body>
    </html>
  );
}
