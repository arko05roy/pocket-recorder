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
