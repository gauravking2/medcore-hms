import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'mc-btn-primary',
  secondary: 'mc-btn-secondary',
  outline: 'mc-btn-outline',
  ghost: 'mc-btn-ghost',
  danger: 'mc-btn-danger',
};

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'mc-btn-sm',
  md: 'mc-btn-md',
  lg: 'mc-btn-lg',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn('mc-btn', variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
