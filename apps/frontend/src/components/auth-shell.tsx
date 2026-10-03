'use client';

import Link from 'next/link';
import { Card } from './ui/card';
import { Field, Input } from './ui/input';
import { Button } from './ui/button';
import { ErrorCard } from './ui/states';

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  backHref = '/login',
  backLabel = '← Sign in',
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="mc-auth mc-auth-slim">
      <Card tone="raised" entrance className="mc-auth-card">
        <Link href={backHref} className="mc-back-link">{backLabel}</Link>
        <p className="mc-meta-label mc-eyebrow">{eyebrow}</p>
        <h1 className="mc-auth-heading">{title}</h1>
        <p className="mc-auth-description">{description}</p>
        <div className="mc-auth-body">{children}</div>
      </Card>
      <style jsx>{`
        .mc-auth { min-height: calc(100vh - 120px); display: grid; place-items: center; padding: 36px 0 24px; }
        .mc-auth-slim { align-content: center; }
        .mc-auth-card { width: 100%; max-width: 30rem; padding: 30px; display: grid; gap: 4px; }
        .mc-back-link { font-size: 0.82rem; color: var(--mc-accent-2); font-weight: 650; }
        .mc-auth-heading { margin: 8px 0 0; font-size: 1.9rem; }
        .mc-auth-description { margin: 8px 0 0; font-size: 0.86rem; color: var(--mc-text-muted); }
        .mc-auth-body { display: grid; gap: 12px; margin-top: 16px; }
      `}</style>
    </main>
  );
}

export { Button, Card, ErrorCard, Field, Input };
