'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteButton({ url }: { url: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
  };
  return <button type="button" className="ghost" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>;
}

// The only way a draft leaves the app: the user copies it into their own mail client.
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return <button type="button" className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>;
}

// Opens Gmail's compose window pre-filled. Nothing is sent from here: the
// user reviews it in Gmail and presses Send themselves.
export function GmailButton({ to, subject, body }: { to: string; subject: string; body: string }) {
  // Only pass a real address; a bare name like "Parug" would be an invalid recipient.
  const addr = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) ? to.trim() : '';
  const href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(addr)}`
    + `&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return <a className="ghost" href={href} target="_blank" rel="noopener noreferrer">Open in Gmail</a>;
}
