'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { apiGet } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useTheme } from './theme';

export interface NavEntry {
  href: string;
  label: string;
  hint: string;
  icon: string;
  roles: string[];
  group: 'Command' | 'Care' | 'Records' | 'Operations' | 'Account';
}

export const NAV_ENTRIES: NavEntry[] = [
  { href: '/dashboard', label: 'Dashboard', hint: 'Role workspace', icon: '◈', roles: ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT', 'PATIENT'], group: 'Command' },
  { href: '/search', label: 'Search', hint: 'Patients · doctors · meds', icon: '⌕', roles: ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT'], group: 'Command' },
  { href: '/appointments', label: 'Appointments', hint: 'Schedule & timeline', icon: '◐', roles: ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'PATIENT'], group: 'Care' },
  { href: '/lab-pharmacy', label: 'Lab & Pharmacy', hint: 'Results & inventory', icon: '⬡', roles: ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECHNICIAN', 'PHARMACIST', 'PATIENT'], group: 'Care' },
  { href: '/records', label: 'Records', hint: 'EMR & prescriptions', icon: '▤', roles: ['DOCTOR', 'NURSE', 'PATIENT'], group: 'Records' },
  { href: '/billing', label: 'Billing', hint: 'Invoices & payments', icon: '⬣', roles: ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT', 'PATIENT'], group: 'Records' },
  { href: '/portal', label: 'Portal', hint: 'Patient home', icon: '◎', roles: ['PATIENT'], group: 'Records' },
  { href: '/notifications', label: 'Notifications', hint: 'Live clinical signals', icon: '◉', roles: ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT', 'PATIENT'], group: 'Operations' },
];

export function linksForRole(role: string | undefined): NavEntry[] {
  if (!role) return [{ href: '/login', label: 'Sign in', hint: 'Continue', icon: '→', roles: [], group: 'Account' }];
  return NAV_ENTRIES.filter((link) => link.roles.includes(role));
}

const GROUP_ORDER: Array<NavEntry['group']> = ['Command', 'Care', 'Records', 'Operations'];

function initials(email: string | undefined, role: string | undefined): string {
  if (email) {
    const handle = email.split('@')[0];
    const parts = handle.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return handle.slice(0, 2).toUpperCase();
  }
  return (role ?? 'MC').slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearSession = useAuthStore((state) => state.clearSession);
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        router.push('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => apiGet<{ unread: number }>(`/notifications/unread-count`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
    refetchInterval: 30000,
  });

  const links = useMemo(() => linksForRole(user?.role), [user?.role]);
  const groups = useMemo(() => {
    const map = new Map<NavEntry['group'], NavEntry[]>();
    for (const link of links) {
      if (!map.has(link.group)) map.set(link.group, []);
      map.get(link.group)?.push(link);
    }
    return GROUP_ORDER.flatMap((group) => (map.has(group) ? [{ group, items: map.get(group) ?? [] }] : []));
  }, [links]);

  const crumb = useMemo(() => {
    const match = NAV_ENTRIES.find((entry) => entry.href === pathname);
    if (match) return match.label;
    if (pathname.startsWith('/encounters')) return 'Encounter';
    if (pathname.startsWith('/doctors')) return 'Doctor schedule';
    if (pathname.startsWith('/hospitals')) return 'Hospital';
    if (pathname === '/') return 'Overview';
    const segment = pathname.split('/').filter(Boolean).pop() ?? 'Overview';
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  }, [pathname]);

  if (!accessToken) {
    return <div id="main-content" className="mc-auth-backdrop">{children}</div>;
  }

  const sidebar = (
    <div className="mc-sidebar-inner">
      <Link href="/dashboard" className="mc-brand" aria-label="MedCore home">
        <span className="mc-brand-mark" aria-hidden="true">M</span>
        {!collapsed && (
          <span className="mc-brand-text">
            <span className="mc-brand-name">MedCore</span>
            <span className="mc-brand-sub">Clinical intelligence</span>
          </span>
        )}
      </Link>
      <div className="mc-sidebar-scroll mc-scroll-thin">
        {groups.map(({ group, items }) => (
          <div key={group} className="mc-nav-group">
            {!collapsed && <p className="mc-meta-label mc-nav-group-label">{group}</p>}
            <ul className="mc-nav-list">
              {items.map((link) => {
                const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? `${link.label} — ${link.hint}` : undefined}
                      className={cn('mc-nav-item', active && 'mc-nav-item-active', collapsed && 'mc-nav-item-collapsed')}
                    >
                      <span className="mc-nav-icon" aria-hidden="true">{link.icon}</span>
                      {!collapsed && (
                        <span className="mc-nav-text">
                          <span className="mc-nav-label">{link.label}</span>
                          <span className="mc-nav-hint">{link.hint}</span>
                        </span>
                      )}
                      {!collapsed && link.href === '/notifications' && (unread.data?.unread ?? 0) > 0 && (
                        <span className="mc-nav-count" aria-label={`${unread.data?.unread} unread`}>{unread.data?.unread}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mc-sidebar-footer">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="mc-collapse-btn"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '→' : '←'}
          {!collapsed && <span>Collapse</span>}
        </button>
        <div className={cn('mc-profile', collapsed && 'mc-profile-collapsed')}>
          <span className="mc-avatar" aria-hidden="true">{initials(user?.email, user?.role)}</span>
          {!collapsed && (
            <span className="mc-profile-text">
              <span className="mc-profile-email" title={user?.email}>{user?.email ?? 'Signed in'}</span>
              <span className="mc-profile-role">{user?.role}</span>
            </span>
          )}
          {!collapsed && (
            <button type="button" onClick={clearSession} className="mc-signout" aria-label="Sign out">
              ⏻
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn('mc-shell', collapsed && 'mc-shell-collapsed')}>
      <aside className="mc-sidebar" aria-label="Primary">
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="mc-mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="mc-mobile-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="mc-mobile-panel">{sidebar}</aside>
        </div>
      )}
      <div className="mc-main-column">
        <header className="mc-header">
          <div className="mc-header-row">
            <button type="button" className="mc-icon-btn mc-only-mobile" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              ☰
            </button>
            <nav aria-label="Breadcrumb" className="mc-crumbs">
              <Link href="/dashboard">Command</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{crumb}</span>
            </nav>
            <form
              className="mc-header-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                router.push(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : '/search');
              }}
            >
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search patients, doctors, medicines…  (Ctrl+K)"
                aria-label="Global search"
              />
              <kbd aria-hidden="true">⌘K</kbd>
            </form>
            <div className="mc-header-actions">
              <Link href="/notifications" className="mc-icon-btn" aria-label={`Notifications${unread.data?.unread ? `, ${unread.data.unread} unread` : ''}`}>
                ◉
                {(unread.data?.unread ?? 0) > 0 && <span className="mc-dot" aria-hidden="true" />}
              </Link>
              <button type="button" onClick={toggleTheme} className="mc-icon-btn" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
                {theme === 'dark' ? '☾' : '☀'}
              </button>
              <button type="button" onClick={clearSession} className="mc-icon-btn" aria-label="Sign out">
                ⏻
              </button>
            </div>
          </div>
        </header>
        <div id="main-content" className="mc-content">
          {children}
        </div>
      </div>
      <style jsx global>{`
        .mc-auth-backdrop { min-height: 100vh; }
        .mc-shell { display: grid; grid-template-columns: 272px minmax(0, 1fr); min-height: 100vh; }
        .mc-shell-collapsed { grid-template-columns: 84px minmax(0, 1fr); }
        .mc-sidebar { position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--mc-border); background: color-mix(in srgb, var(--mc-bg-elevated) 88%, transparent); backdrop-filter: blur(18px); z-index: 30; }
        .mc-sidebar-inner { display: flex; flex-direction: column; height: 100%; padding: 18px 14px 14px; gap: 14px; }
        .mc-brand { display: flex; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 14px; }
        .mc-brand-mark { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; font-family: var(--mc-font-display); font-weight: 800; font-size: 1.15rem; color: #fff; background: linear-gradient(135deg, #5f7dff, #22d3ee 68%, #a78bfa); box-shadow: var(--mc-glow); flex: none; }
        .mc-brand-text { display: grid; line-height: 1.1; }
        .mc-brand-name { font-family: var(--mc-font-display); font-weight: 750; font-size: 1.02rem; letter-spacing: -0.01em; }
        .mc-brand-sub { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mc-text-faint); }
        .mc-sidebar-scroll { flex: 1; overflow-y: auto; display: grid; gap: 14px; align-content: start; padding-right: 2px; }
        .mc-nav-group-label { padding: 0 10px; margin: 0 0 7px; }
        .mc-nav-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
        .mc-nav-item { position: relative; display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 12px; border: 1px solid transparent; color: var(--mc-text-muted); transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease; }
        .mc-nav-item:hover { background: color-mix(in srgb, var(--mc-accent) 9%, transparent); color: var(--mc-text); }
        .mc-nav-item-active { background: var(--mc-nav-active); border-color: var(--mc-border-strong); color: var(--mc-text); box-shadow: var(--mc-glow); }
        .mc-nav-item-active::before { content: ""; position: absolute; left: -14px; top: 9px; bottom: 9px; width: 3px; border-radius: 999px; background: linear-gradient(180deg, var(--mc-accent), var(--mc-accent-2)); }
        .mc-nav-item-collapsed { justify-content: center; padding: 10px 0; }
        .mc-nav-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--mc-border); background: color-mix(in srgb, var(--mc-surface) 80%, transparent); font-size: 0.95rem; flex: none; }
        .mc-nav-item-active .mc-nav-icon { border-color: var(--mc-border-strong); background: color-mix(in srgb, var(--mc-accent) 20%, var(--mc-surface)); }
        .mc-nav-text { display: grid; line-height: 1.15; min-width: 0; }
        .mc-nav-label { font-size: 0.86rem; font-weight: 650; }
        .mc-nav-hint { font-size: 0.7rem; color: var(--mc-text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mc-nav-count { margin-left: auto; min-width: 22px; height: 22px; padding: 0 6px; display: grid; place-items: center; border-radius: 999px; font-size: 0.7rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #5f7dff, #22d3ee); }
        .mc-sidebar-footer { display: grid; gap: 10px; border-top: 1px solid var(--mc-border); padding-top: 12px; }
        .mc-collapse-btn { display: flex; align-items: center; gap: 8px; justify-content: center; border: 1px solid var(--mc-border); background: transparent; color: var(--mc-text-muted); border-radius: 10px; padding: 7px; font-size: 0.78rem; }
        .mc-profile { display: flex; align-items: center; gap: 10px; border: 1px solid var(--mc-border); border-radius: 14px; padding: 9px 10px; background: color-mix(in srgb, var(--mc-surface) 78%, transparent); }
        .mc-profile-collapsed { justify-content: center; }
        .mc-avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; font-size: 0.75rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #3b5bff, #7c3aed); flex: none; }
        .mc-profile-text { display: grid; min-width: 0; line-height: 1.2; }
        .mc-profile-email { font-size: 0.76rem; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
        .mc-profile-role { font-size: 0.66rem; letter-spacing: 0.08em; color: var(--mc-text-faint); }
        .mc-signout { margin-left: auto; border: 1px solid var(--mc-border); background: transparent; color: var(--mc-text-muted); border-radius: 9px; width: 30px; height: 30px; }
        .mc-main-column { min-width: 0; display: flex; flex-direction: column; }
        .mc-header { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--mc-border); background: var(--mc-overlay); backdrop-filter: blur(18px); }
        /* The header must never push the page wider than the viewport: every
           flex child is allowed to shrink (min-width: 0) and the breadcrumb
           truncates instead of forcing its intrinsic width. */
        .mc-header-row { display: flex; align-items: center; gap: 12px; max-width: 1240px; margin: 0 auto; padding: 12px 20px; min-width: 0; }
        .mc-header-row > * { min-width: 0; }
        .mc-crumbs { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--mc-text-faint); white-space: nowrap; min-width: 0; overflow: hidden; flex: 0 1 auto; }
        .mc-crumbs a, .mc-crumbs [aria-current="page"] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mc-crumbs a:hover { color: var(--mc-text); }
        .mc-crumbs [aria-current="page"] { color: var(--mc-text); font-weight: 650; }
        .mc-header-search { flex: 1; max-width: 470px; margin-left: auto; display: flex; align-items: center; gap: 9px; border: 1px solid var(--mc-border); border-radius: 12px; background: var(--mc-input-bg); padding: 8px 11px; }
        .mc-header-search input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 0.84rem; }
        .mc-header-search input::placeholder { color: var(--mc-text-faint); }
        .mc-header-search kbd { font-family: var(--mc-font-mono); font-size: 0.66rem; border: 1px solid var(--mc-border); border-radius: 6px; padding: 2px 6px; color: var(--mc-text-faint); }
        .mc-header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: none; }
        .mc-header-search + .mc-header-actions { margin-left: 0; }
        .mc-icon-btn { position: relative; display: grid; place-items: center; width: 36px; height: 36px; flex: none; border-radius: 11px; border: 1px solid var(--mc-border); background: color-mix(in srgb, var(--mc-surface) 82%, transparent); color: var(--mc-text-muted); font-size: 1rem; transition: transform 140ms ease, border-color 140ms ease, color 140ms ease; }
        .mc-icon-btn:hover { transform: translateY(-1px); border-color: var(--mc-border-strong); color: var(--mc-text); }
        .mc-dot { position: absolute; top: 7px; right: 7px; width: 8px; height: 8px; border-radius: 999px; background: var(--mc-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mc-danger) 22%, transparent); }
        .mc-content { max-width: 1240px; width: 100%; margin: 0 auto; padding: 26px 20px 64px; }
        .mc-only-mobile { display: none; }
        .mc-mobile-drawer { display: none; }
        @media (max-width: 1023px) {
          .mc-shell, .mc-shell-collapsed { grid-template-columns: minmax(0, 1fr); }
          .mc-sidebar { display: none; }
          .mc-only-mobile { display: grid; }
          .mc-header-search kbd { display: none; }
          .mc-mobile-drawer { display: block; position: fixed; inset: 0; z-index: 60; }
          .mc-mobile-scrim { position: absolute; inset: 0; background: rgba(2, 6, 18, 0.6); backdrop-filter: blur(3px); }
          .mc-mobile-panel { position: absolute; left: 0; top: 0; bottom: 0; width: min(320px, 86vw); border-right: 1px solid var(--mc-border); background: var(--mc-bg-elevated); overflow-y: auto; }
          .mc-mobile-panel .mc-sidebar-inner { height: 100%; }
        }
        @media (max-width: 640px) {
          .mc-header-row { padding: 10px 14px; gap: 8px; }
          .mc-header-search { display: none; }
          .mc-content { padding: 18px 14px 56px; }
          /* Small phones: keep the current page name, drop the "Command /"
             prefix so the crumb never competes with the action buttons. */
          .mc-crumbs a, .mc-crumbs span[aria-hidden="true"] { display: none; }
        }
      `}</style>
    </div>
  );
}
