import Link from 'next/link';
import { GlassCard } from '../components/ui/card';
import './landing.css';

const routes = [
  { href: '/dashboard', label: 'Command dashboard', detail: 'Role workspaces with live analytics', icon: '◈' },
  { href: '/appointments', label: 'Appointments', detail: 'Live slots and conflict-safe booking', icon: '◐' },
  { href: '/lab-pharmacy', label: 'Lab & pharmacy', detail: 'Queues, FIFO stock, approvals', icon: '⬡' },
  { href: '/billing', label: 'Billing', detail: 'Invoices and verified payments', icon: '⬣' },
  { href: '/search', label: 'Search', detail: 'Server-side global lookup', icon: '⌕' },
  { href: '/portal', label: 'Patient portal', detail: 'Personal care home', icon: '◎' },
];

export default function HomePage() {
  return (
    <main className="mc-landing">
      <header className="mc-landing-top">
        <Link href="/" className="mc-brand" aria-label="MedCore home">
          <span className="mc-brand-mark" aria-hidden="true">M</span>
          <span className="mc-brand-text">
            <span className="mc-brand-name">MedCore</span>
            <span className="mc-brand-sub">Clinical intelligence</span>
          </span>
        </Link>
        <span className="mc-live-pill"><span className="mc-live-dot" aria-hidden="true" /> Live clinical platform</span>
      </header>
      <section className="mc-landing-hero">
        <div className="mc-landing-copy">
          <p className="mc-meta-label mc-eyebrow">Futuristic clinical intelligence</p>
          <h1 className="mc-landing-title">One command center for the entire hospital.</h1>
          <p className="mc-landing-subtitle">Scheduling, encounters, diagnostics, pharmacy, billing, and live signals — composed per role, scoped per hospital, verified on the server.</p>
          <div className="mc-landing-cta">
            <Link href="/login" className="mc-btn mc-btn-primary mc-btn-lg">Enter workspace</Link>
            <Link href="/portal" className="mc-btn mc-btn-outline mc-btn-lg">Patient portal</Link>
          </div>
          <dl className="mc-landing-stats">
            <div><dt>Roles</dt><dd>9 workspaces</dd></div>
            <div><dt>Latency</dt><dd>Live queries</dd></div>
            <div><dt>Scope</dt><dd>Tenant-safe</dd></div>
          </dl>
        </div>
        <GlassCard className="mc-landing-panel">
          <p className="mc-meta-label">Start operating</p>
          <nav aria-label="Application routes" className="mc-landing-nav">
            {routes.map((route) => (
              <Link key={route.href} href={route.href} className="mc-landing-route">
                <span className="mc-landing-icon" aria-hidden="true">{route.icon}</span>
                <span><span className="mc-landing-route-label">{route.label}</span><span className="mc-landing-route-detail">{route.detail}</span></span>
                <span aria-hidden="true" className="mc-landing-arrow">→</span>
              </Link>
            ))}
          </nav>
        </GlassCard>
      </section>
      <footer className="mc-landing-foot">MedCore HMS · Scheduling, EMR, lab, pharmacy, billing, and live operations.</footer>
    </main>
  );
}
