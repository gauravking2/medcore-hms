import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  id = 'mc-search',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('mc-searchbar', className)}>
      <span aria-hidden="true" className="mc-searchbar-icon">⌕</span>
      <label htmlFor={id} className="sr-only">Search</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="mc-searchbar-clear">
          ×
        </button>
      )}
    </div>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mc-filterbar', className)} role="group" aria-label="Filters">{children}</div>;
}

export function FilterChip({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={Boolean(active)} onClick={onClick} className={cn('mc-chip', active && 'mc-chip-active')}>
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = 'Tabs',
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="mc-tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('mc-tab', value === option.value && 'mc-tab-active')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="mc-modal-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <div className="mc-modal-scrim" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="mc-modal"
          >
            <div className="mc-modal-head">
              <div>
                <h2 className="mc-modal-title">{title}</h2>
                {description && <p className="mc-modal-description">{description}</p>}
              </div>
              <button type="button" onClick={onClose} className="mc-icon-ghost" aria-label="Close dialog">×</button>
            </div>
            <div className="mc-modal-body">{children}</div>
            {actions && <div className="mc-modal-actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  emptyTitle = 'No results',
  emptyMessage = 'Nothing matches the current filters.',
  emptyAction,
}: {
  columns: Array<{ key: string; header: string; render: (row: T) => React.ReactNode; align?: 'left' | 'right' }>;
  rows: T[];
  keyOf: (row: T, index: number) => string;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="mc-table-empty">
        <p className="mc-state-title">{emptyTitle}</p>
        <p className="mc-state-message">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={column.align === 'right' ? { textAlign: 'right' } : undefined}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={keyOf(row, index)}>
              {columns.map((column) => (
                <td key={column.key} style={column.align === 'right' ? { textAlign: 'right' } : undefined}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ items }: { items: Array<{ id: string; time: string; title: string; detail?: string; status?: string; accent?: boolean }> }) {
  if (items.length === 0) {
    return <p className="mc-muted-text">No timeline entries.</p>;
  }
  return (
    <ol className="mc-timeline">
      {items.map((item) => (
        <li key={item.id} className={cn('mc-timeline-item', item.accent && 'mc-timeline-accent')}>
          <span className="mc-timeline-rail" aria-hidden="true" />
          <div className="mc-timeline-card">
            <p className="mc-timeline-time mc-mono">{item.time}</p>
            <p className="mc-timeline-title">{item.title}</p>
            {item.detail && <p className="mc-timeline-detail">{item.detail}</p>}
            {item.status && <p className="mc-timeline-status">{item.status}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ToastRegion({ toasts }: { toasts: Array<{ id: string; title: string; message?: string; tone?: 'success' | 'error' | 'info' }> }) {
  return (
    <div className="mc-toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div key={toast.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('mc-toast', toast.tone && `mc-toast-${toast.tone}`)}>
            <p className="mc-toast-title">{toast.title}</p>
            {toast.message && <p className="mc-toast-message">{toast.message}</p>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
