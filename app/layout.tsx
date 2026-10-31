import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { listRecordings } from '@/lib/server/db';
import Shell from '@/components/Shell';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = { title: 'Recordings' };

// Read the database on every request; nothing here can be cached at build time.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <Shell recordings={listRecordings()}>{children}</Shell>
      </body>
    </html>
  );
}
