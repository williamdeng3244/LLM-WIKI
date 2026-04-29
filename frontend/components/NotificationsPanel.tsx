'use client';
import { useEffect, useRef } from 'react';
import { Bell, Check } from 'lucide-react';
import { api, type Notification } from '@/lib/api';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationsPanel({
  notifications, onClose, onMarkRead, onMarkAllRead, onLink,
}: {
  notifications: Notification[];
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onLink: (link: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-[360px] max-h-[480px] bg-panel border border-line rounded-md shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] z-30 flex flex-col"
    >
      <div className="px-3 py-2.5 border-b border-black/8 flex items-center justify-between">
        <span className="text-[12.5px] font-medium flex items-center gap-1.5">
          <Bell size={13} /> Notifications
          {unread > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-medium">
              {unread}
            </span>
          )}
        </span>
        {unread > 0 && (
          <button
            className="text-[11px] text-accent hover:underline flex items-center gap-1"
            onClick={onMarkAllRead}
          >
            <Check size={12} /> Mark all read
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted">
            All caught up.
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`px-3 py-2 border-b border-black/5 last:border-b-0 ${
                n.is_read ? '' : 'bg-accent/[0.04]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] leading-relaxed">{n.body}</div>
                  <div className="text-[10.5px] text-muted mt-0.5">
                    {timeAgo(n.created_at)}
                    {n.link && (
                      <>
                        {' · '}
                        <button
                          className="text-accent hover:underline"
                          onClick={() => onLink(n.link!)}
                        >
                          open
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {!n.is_read && (
                  <button
                    className="text-muted hover:text-ink shrink-0"
                    title="Mark read"
                    onClick={() => onMarkRead(n.id)}
                  >
                    <Check size={12} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
