'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/states';
import { apiGet } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

interface Me {
  id: string;
  email: string;
  role: string;
  hospitalId: string | null;
}

interface Appointment {
  id: string;
  startsAt: string;
  status: string;
}

interface LabOrder {
  id: string;
  status: string;
  labTest?: { name: string };
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  paymentStatus: string;
  total: string | number;
  currency: string;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
}

function Section({ title, hint, href, linkLabel, children }: { title: string; hint?: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <GlassCard className="mc-portal-section">
      <div className="mc-portal-section-head">
        <div>
          <h2 className="mc-portal-section-title">{title}</h2>
          {hint && <p className="mc-portal-section-hint">{hint}</p>}
        </div>
        <Link className="mc-portal-link" href={href}>{linkLabel} →</Link>
      </div>
      {children}
    </GlassCard>
  );
}

export default function PortalPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const enabled = Boolean(accessToken);

  const me = useQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>(`/auth/me`, accessToken ?? undefined), enabled });
  const appointments = useQuery({
    queryKey: ['portal-appointments'],
    queryFn: () => apiGet<{ items: Appointment[] } | Appointment[]>(`/appointments`, accessToken ?? undefined),
    enabled: enabled && user?.role === 'PATIENT',
  });
  const lab = useQuery({
    queryKey: ['portal-lab'],
    queryFn: () => apiGet<{ items: LabOrder[] } | LabOrder[]>(`/lab-orders`, accessToken ?? undefined),
    enabled: enabled && user?.role === 'PATIENT',
  });
  const invoices = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: () => apiGet<{ items: Invoice[] } | Invoice[]>(`/invoices`, accessToken ?? undefined),
    enabled: enabled && user?.role === 'PATIENT',
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<{ items: NotificationItem[] } | NotificationItem[]>(`/notifications/me`, accessToken ?? undefined),
    enabled,
  });

  function itemsOf<T>(data: { items: T[] } | T[] | undefined): T[] {
    if (!data) return [];
    return Array.isArray(data) ? data : data.items;
  }

  if (!accessToken) {
    return (
      <main className="mc-narrow">
        <p className="mc-meta-label mc-eyebrow">Patient portal</p>
        <h1 className="mc-hero-title">Your care profile</h1>
        <Link className="mc-portal-link" href="/login">Sign in to view your profile →</Link>
      </main>
    );
  }

  const appointmentList = itemsOf<Appointment>(appointments.data).slice(0, 5);
  const labList = itemsOf<LabOrder>(lab.data).slice(0, 5);
  const invoiceList = itemsOf<Invoice>(invoices.data).slice(0, 5);
  const notificationList = itemsOf<NotificationItem>(notifications.data).slice(0, 5);

  return (
    <main className="mc-portal">
      <PageHeader
        eyebrow="Patient portal"
        title={`Welcome${me.data ? `, ${me.data.email.split('@')[0]}` : ''}`}
        description={`Role ${me.data?.role ?? user?.role ?? '—'} · Hospital scope ${me.data?.hospitalId ?? user?.hospitalId ?? 'platform'} · Everything below is loaded from your own live records.`}
        actions={<Link href="/appointments"><Button size="lg">Book appointment</Button></Link>}
      />
      <div className="mc-portal-hero">
        <GlassCard className="mc-portal-identity">
          <p className="mc-meta-label">Care profile</p>
          <p className="mc-portal-email">{me.data?.email ?? user?.email ?? 'Loading…'}</p>
          <p className="mc-portal-scope">{me.data?.hospitalId ? `Hospital ${me.data.hospitalId.slice(0, 8)}` : 'Platform scope'}</p>
        </GlassCard>
        <GlassCard className="mc-portal-next">
          <p className="mc-meta-label">Next appointment</p>
          {appointmentList.length === 0 ? (
            <p className="mc-muted-text">No upcoming appointments. Booking takes less than a minute.</p>
          ) : (
            <>
              <p className="mc-portal-next-time">{new Date(appointmentList[0].startsAt).toLocaleString()}</p>
              <p className="mc-portal-next-status">{appointmentList[0].status.replace(/_/g, ' ')}</p>
            </>
          )}
          <Link className="mc-portal-link" href="/appointments">Manage schedule →</Link>
        </GlassCard>
      </div>
      <div className="mc-portal-grid">
        <Section title="Upcoming appointments" hint="Live from scheduling" href="/appointments" linkLabel="Open booking">
          {appointmentList.length === 0 && <p className="mc-muted-text">No upcoming appointments. Book one from the appointments page.</p>}
          <ul className="mc-feed">
            {appointmentList.map((appointment) => (
              <li key={appointment.id}><span>{new Date(appointment.startsAt).toLocaleString()}</span><span className="mc-feed-status">{appointment.status.replace(/_/g, ' ')}</span></li>
            ))}
          </ul>
        </Section>
        <Section title="Approved lab reports" hint="Approved results only" href="/lab-pharmacy" linkLabel="Open lab">
          {labList.length === 0 && <p className="mc-muted-text">No approved reports yet.</p>}
          <ul className="mc-feed">
            {labList.map((order) => (
              <li key={order.id}><span>{order.labTest?.name ?? order.id.slice(0, 8)}</span><span className="mc-feed-status">{order.status.replace(/_/g, ' ')}</span></li>
            ))}
          </ul>
        </Section>
        <Section title="Prescriptions" hint="Signed documents" href="/records" linkLabel="View records">
          <p className="mc-muted-text">Signed prescriptions and PDF downloads live in your records.</p>
          <Link href="/records"><Button variant="outline" size="sm">View records</Button></Link>
        </Section>
        <Section title="Invoices & payments" hint="Verified backend state" href="/billing" linkLabel="Open billing">
          {invoiceList.length === 0 && <p className="mc-muted-text">No invoices yet.</p>}
          <ul className="mc-feed">
            {invoiceList.map((invoice) => (
              <li key={invoice.id}><span>{invoice.invoiceNumber}</span><span className="mc-feed-status">{String(invoice.total)} {invoice.currency} · {invoice.paymentStatus.replace(/_/g, ' ')}</span></li>
            ))}
          </ul>
        </Section>
        <Section title="Notifications" hint="Live clinical signals" href="/notifications" linkLabel="Open center">
          {notificationList.length === 0 && <p className="mc-muted-text">No notifications.</p>}
          <ul className="mc-feed">
            {notificationList.map((item) => (
              <li key={item.id}><span><strong>{item.title}:</strong> {item.body}</span></li>
            ))}
          </ul>
        </Section>
        <Section title="Book care" hint="Doctors · slots · cancellations" href="/appointments" linkLabel="Start booking">
          <p className="mc-muted-text">Search doctors, pick a slot, and manage cancellations.</p>
          <Link href="/appointments"><Button>Book appointment</Button></Link>
        </Section>
      </div>
      <style jsx>{`
        .mc-portal, .mc-narrow { display: grid; gap: 22px; }
        .mc-narrow { max-width: 720px; }
        .mc-hero-title { margin: 8px 0 0; font-size: clamp(2rem, 4vw, 2.8rem); }
        .mc-portal-hero { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
        .mc-portal-identity, .mc-portal-next { padding: 22px; }
        .mc-portal-email { margin: 8px 0 0; font-family: var(--mc-font-display); font-size: 1.25rem; font-weight: 700; overflow-wrap: anywhere; }
        .mc-portal-scope { margin: 6px 0 0; font-size: 0.8rem; color: var(--mc-text-muted); }
        .mc-portal-next-time { margin: 8px 0 0; font-size: 1.35rem; font-weight: 700; font-family: var(--mc-font-display); }
        .mc-portal-next-status { margin: 4px 0 10px; font-size: 0.78rem; font-weight: 750; letter-spacing: 0.08em; color: var(--mc-accent-2); }
        .mc-portal-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .mc-portal-section { padding: 20px; min-width: 0; }
        .mc-portal-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; min-width: 0; }
        .mc-portal-section-head > div { min-width: 0; }
        .mc-portal-section-title { margin: 0; font-size: 1.02rem; overflow-wrap: break-word; }
        .mc-portal-section-hint { margin: 4px 0 0; font-size: 0.78rem; color: var(--mc-text-muted); overflow-wrap: break-word; }
        .mc-portal-link { font-size: 0.82rem; font-weight: 700; color: var(--mc-accent-2); white-space: nowrap; flex: none; }
        .mc-feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 0.84rem; }
        .mc-feed li { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--mc-border); border-radius: 11px; padding: 9px 11px; background: color-mix(in srgb, var(--mc-surface-2) 42%, transparent); min-width: 0; }
        .mc-feed li > span:first-child { min-width: 0; overflow-wrap: break-word; }
        .mc-feed-status { font-size: 0.72rem; font-weight: 750; letter-spacing: 0.05em; color: var(--mc-text-muted); text-align: right; flex: none; }
        .mc-muted-text { color: var(--mc-text-muted); font-size: 0.84rem; }
        @media (max-width: 900px) { .mc-portal-hero, .mc-portal-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
