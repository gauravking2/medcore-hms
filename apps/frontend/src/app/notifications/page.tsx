'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { LoadingSkeleton, PageHeader, StateCard } from '../../components/ui/states';
import { apiGet, apiPatch } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import { useRealtimeNotifications } from '../../lib/socket';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  status: string;
  createdAt: string;
}

const CATEGORY_TONE: Record<string, string> = {
  Appointment: 'var(--mc-accent-2)',
  Lab: 'var(--mc-accent-3)',
  Prescription: 'var(--mc-success)',
  Invoice: 'var(--mc-warning)',
  Payment: 'var(--mc-success)',
  Emergency: 'var(--mc-danger)',
};

function categoryOf(item: NotificationItem): string {
  const haystack = `${item.title} ${item.body} ${item.entityType ?? ''}`.toLowerCase();
  if (haystack.includes('emergency')) return 'Emergency';
  if (haystack.includes('lab')) return 'Lab';
  if (haystack.includes('prescription') || haystack.includes('pharmacy')) return 'Prescription';
  if (haystack.includes('invoice')) return 'Invoice';
  if (haystack.includes('payment')) return 'Payment';
  if (haystack.includes('appointment')) return 'Appointment';
  return 'General';
}

export default function NotificationsPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();
  useRealtimeNotifications();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<{ items: NotificationItem[] } | NotificationItem[]>(`/notifications/me`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => apiGet<{ unread: number }>(`/notifications/unread-count`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });

  const items: NotificationItem[] = Array.isArray(notifications.data) ? notifications.data : (notifications.data?.items ?? []);

  async function markRead(id: string) {
    await apiPatch(`/notifications/${id}/read`, {}, accessToken ?? undefined);
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  }

  async function markAllRead() {
    await apiPatch(`/notifications/read-all`, {}, accessToken ?? undefined);
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  }

  if (!accessToken) {
    return (
      <main className="mc-narrow">
        <h1 className="mc-hero-title">Notifications</h1>
        <Link className="mc-portal-link" href="/login">Sign in to view notifications →</Link>
      </main>
    );
  }

  return (
    <main className="mc-stack">
      <PageHeader
        eyebrow="Live clinical signals"
        title={`Notifications${unread.data?.unread ? ` · ${unread.data.unread} unread` : ''}`}
        description="Appointment, lab, pharmacy, billing, and emergency events stream here in real time."
        actions={<Button variant="outline" onClick={markAllRead}>Mark all as read</Button>}
      />
      {notifications.isLoading && <LoadingSkeleton rows={4} />}
      {notifications.error && (
        <Card tone="flat" className="mc-error-inline">
          <p>Could not load notifications.</p>
          <button type="button" className="mc-link-btn" onClick={() => notifications.refetch()}>Retry</button>
        </Card>
      )}
      {items.length === 0 && !notifications.isLoading && !notifications.error && (
        <StateCard title="All caught up" message="New appointment, lab, billing, and pharmacy events will appear here in real time." icon="◉" />
      )}
      <ul className="mc-notif-list">
        {items.map((item, index) => {
          const category = categoryOf(item);
          return (
            <li key={item.id}>
              <Card tone={item.status === 'UNREAD' ? 'glow' : 'default'} entrance entranceDelay={Math.min(index * 0.03, 0.2)} className="mc-notif">
                <span className="mc-notif-rail" style={{ background: CATEGORY_TONE[category] ?? 'var(--mc-accent)' }} aria-hidden="true" />
                <div className="mc-notif-body">
                  <div className="mc-notif-head">
                    <span className="mc-notif-category">{category}</span>
                    {item.status === 'UNREAD' && <span className="mc-notif-new">New</span>}
                    <time className="mc-notif-time">{new Date(item.createdAt).toLocaleString()}</time>
                  </div>
                  <p className="mc-notif-title">{item.title}</p>
                  <p className="mc-notif-text">{item.body}</p>
                </div>
                {item.status === 'UNREAD' && <Button variant="outline" size="sm" onClick={() => markRead(item.id)}>Mark read</Button>}
              </Card>
            </li>
          );
        })}
      </ul>
      <style jsx>{`
        .mc-stack { display: grid; gap: 18px; }
        .mc-narrow { display: grid; gap: 14px; max-width: 720px; }
        .mc-hero-title { margin: 8px 0 0; font-size: clamp(1.9rem, 4vw, 2.6rem); }
        .mc-portal-link { color: var(--mc-accent-2); font-weight: 700; font-size: 0.86rem; }
        .mc-error-inline { padding: 16px; display: flex; align-items: center; gap: 12px; font-size: 0.86rem; color: var(--mc-danger); }
        .mc-link-btn { background: none; border: 0; color: inherit; text-decoration: underline; font-weight: 700; }
        .mc-notif-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .mc-notif { position: relative; display: flex; align-items: flex-start; gap: 14px; padding: 16px 16px 16px 20px; overflow: hidden; }
        .mc-notif-rail { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
        .mc-notif-body { flex: 1; min-width: 0; }
        .mc-notif-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
        .mc-notif-category { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mc-text-faint); }
        .mc-notif-new { font-size: 0.64rem; font-weight: 800; letter-spacing: 0.08em; color: #fff; background: linear-gradient(135deg, #5f7dff, #22d3ee); border-radius: 999px; padding: 2px 8px; }
        .mc-notif-time { margin-left: auto; font-size: 0.72rem; color: var(--mc-text-faint); }
        .mc-notif-title { margin: 6px 0 0; font-size: 0.94rem; font-weight: 700; overflow-wrap: break-word; }
        .mc-notif-text { margin: 4px 0 0; font-size: 0.84rem; color: var(--mc-text-muted); overflow-wrap: break-word; }
        @media (max-width: 640px) { .mc-notif { flex-wrap: wrap; } }
      `}</style>
    </main>
  );
}
