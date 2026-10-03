import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'neutral',
  ORDERED: 'warning',
  SAMPLE_COLLECTED: 'info',
  PROCESSING: 'primary',
  RESULT_UPLOADED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  VOID: 'neutral',
  UNPAID: 'warning',
  UNREAD: 'primary',
  READ: 'neutral',
  ARCHIVED: 'neutral',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'neutral',
  PENDING_VERIFICATION: 'warning',
  HIGH: 'danger',
  LOW: 'warning',
  NORMAL: 'success',
  EMERGENCY: 'danger',
};

export function toneForStatus(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function StatusBadge({ status, tone, className }: { status: string; tone?: Tone; className?: string }) {
  const resolved = tone ?? toneForStatus(status);
  const label = status.replace(/_/g, ' ');
  const readable = status === 'EMERGENCY' || resolved === 'danger' ? 'Critical' : status === 'HIGH' ? 'High' : null;
  return (
    <span className={cn('mc-badge', `mc-badge-${resolved}`, className)} aria-label={`Status ${label}${readable ? `, ${readable}` : ''}`}>
      <span aria-hidden="true" className="mc-badge-dot" />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('mc-skeleton', className)} />;
}

export function LoadingSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('mc-skeleton-stack', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="mc-skeleton" style={{ opacity: 1 - index * 0.16 }} />
      ))}
    </div>
  );
}

export function StateCard({ title, message, action, icon = '◈', className }: { title: string; message: string; action?: React.ReactNode; icon?: string; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className={cn('mc-state', className)}>
      <span className="mc-state-icon" aria-hidden="true">{icon}</span>
      <p className="mc-state-title">{title}</p>
      <p className="mc-state-message">{message}</p>
      {action && <div className="mc-state-action">{action}</div>}
    </motion.div>
  );
}

export function ErrorCard({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('mc-error', className)}>
      <p className="mc-error-title">Something needs attention</p>
      <p className="mc-error-message">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mc-btn mc-btn-outline mc-btn-sm">
          Retry
        </button>
      )}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="mc-page-header">
      <div className="mc-page-header-text">
        <p className="mc-meta-label mc-eyebrow">{eyebrow}</p>
        <h1 className="mc-page-title">{title}</h1>
        {description && <p className="mc-page-description">{description}</p>}
        {meta && <div className="mc-page-meta">{meta}</div>}
      </div>
      {actions && <div className="mc-page-actions">{actions}</div>}
    </motion.div>
  );
}

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mc-section-header">
      <div>
        <h2 className="mc-section-title">{title}</h2>
        {hint && <p className="mc-section-hint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ email, role, size = 36 }: { email?: string; role?: string; size?: number }) {
  const handle = (email ?? '').split('@')[0];
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const text = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : handle.slice(0, 2).toUpperCase() || (role ?? 'MC').slice(0, 2).toUpperCase();
  return (
    <span className="mc-avatar-lg" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.32) }} aria-hidden="true">
      {text}
    </span>
  );
}

export function Breadcrumbs({ trail }: { trail: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mc-breadcrumbs">
      {trail.map((item, index) => (
        <span key={`${item.label}-${index}`} className="mc-crumb">
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}
