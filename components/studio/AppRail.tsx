'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import PrinterPanel from './PrinterPanel';
import { AudioLines, Calendar, FileText, Mail, Network, PanelLeftClose, PanelLeftOpen, Plus, Trash2, Users } from 'lucide-react';

const PAGES = [
  ['/people', 'People', Users],
  ['/graph', 'Graph', Network],
  ['/recordings', 'Recordings', AudioLines],
  ['/calendar', 'Calendar', Calendar],
  ['/drafts', 'Drafts', Mail],
  ['/docs', 'Docs', FileText],
] as const;

// The app's navigation, on every page. Collapsed, it's a strip of icons.
export default function AppRail({ chats, collapsed, onToggle }: {
  chats: { id: string; title: string }[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const path = usePathname();
  const router = useRouter();
  // The chat whose row is asking "Delete this chat?", and one being deleted.
  const [asking, setAsking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const chatId = path.startsWith('/c/') ? path.slice(3) : null;
  const section = (href: string) => path === href || (href === '/recordings' && path.startsWith('/r/')) || (href === '/docs' && path.startsWith('/docs/'));

  const remove = async (id: string) => {
    setDeleting(id);
    setFailed(null);
    const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => null);
    setDeleting(null);
    setAsking(null);
    if (!res?.ok) { setFailed(id); return; }
    // Deleting the open chat leaves nothing to show; start a fresh one.
    if (id === chatId) router.push('/');
    else router.refresh();
  };

  return (
    <nav className={`rail${collapsed ? ' collapsed' : ''}`} aria-label="Main">
      <div className="rail-top">
        <Link href="/" className="rail-brand"><span className="rail-led" aria-hidden="true" /><span className="rail-text">Pocket Recorder</span></Link>
        <button type="button" className="rail-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <Link href="/" className="rail-new" title="New chat"><Plus size={16} /><span className="rail-text">New chat</span></Link>
      <div className="rail-pages">
        {PAGES.map(([href, label, Icon]) => (
          <Link key={href} href={href} title={label} aria-current={section(href) ? 'page' : undefined}>
            <Icon size={16} /><span className="rail-text">{label}</span>
          </Link>
        ))}
      </div>
      {!collapsed && <PrinterPanel />}
      {!collapsed && (
        <>
          <div className="rail-label">Chats</div>
          <div className="rail-list">
            {!chats.length && <p className="rail-empty">Chats you start appear here.</p>}
            {chats.map((c) => (
              asking === c.id ? (
                <div key={c.id} className={`rail-confirm${deleting === c.id ? ' busy' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape') setAsking(null); }}>
                  <span>Delete this chat?</span>
                  <div>
                    <button type="button" className="rail-confirm-yes" onClick={() => remove(c.id)}>{deleting === c.id ? 'Deleting…' : 'Delete'}</button>
                    <button type="button" autoFocus onClick={() => setAsking(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={c.id} className="rail-row">
                  <Link href={`/c/${c.id}`} className="rail-item" aria-current={c.id === chatId ? 'page' : undefined}>{c.title}</Link>
                  <button type="button" className="rail-del" onClick={() => { setFailed(null); setAsking(c.id); }} aria-label={`Delete chat “${c.title}”`} title="Delete chat">
                    <Trash2 size={14} />
                  </button>
                  {failed === c.id && <span className="rail-fail">Couldn’t delete. Try again.</span>}
                </div>
              )
            ))}
          </div>
        </>
      )}
    </nav>
  );
}
