import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'raised' | 'glow' | 'flat';
  entrance?: boolean;
  entranceDelay?: number;
}

const tones: Record<NonNullable<CardProps['tone']>, string> = {
  default: 'mc-card',
  raised: 'mc-card mc-card-raised',
  glow: 'mc-card mc-card-glow',
  flat: 'mc-card mc-card-flat',
};

type MotionDivProps = React.ComponentProps<typeof motion.div>;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = 'default', entrance = false, entranceDelay = 0, ...props }, ref) => {
    if (!entrance) {
      return <div ref={ref} className={cn(tones[tone], className)} {...(props as React.HTMLAttributes<HTMLDivElement>)} />;
    }
    const motionProps = props as unknown as MotionDivProps;
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: entranceDelay, ease: [0.22, 1, 0.36, 1] }}
        className={cn(tones[tone], className)}
        {...motionProps}
      />
    );
  },
);
Card.displayName = 'Card';

export function GlassCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mc-glass', className)} {...props} />;
}

export function StatCard({
  label,
  value,
  hint,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}) {
  return (
    <div className={cn('mc-stat', accent && `mc-stat-${accent}`, className)}>
      <p className="mc-meta-label">{label}</p>
      <p className="mc-kpi-number mc-stat-value">{value}</p>
      {hint && <div className="mc-stat-hint">{hint}</div>}
    </div>
  );
}
