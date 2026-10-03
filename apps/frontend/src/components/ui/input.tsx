import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, children, ...props }, ref) => {
    void children;
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn('mc-input', invalid && 'mc-input-invalid', className)} {...props} />;
  },
);
Input.displayName = 'Input';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="mc-field">
      <label className="mc-field-label" htmlFor={htmlFor}>{label}</label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': describedBy })
        : children}
      {error ? (
        <p className="mc-field-error" role="alert" id={errorId}>{error}</p>
      ) : hint ? (
        <p className="mc-field-hint" id={hintId}>{hint}</p>
      ) : null}
    </div>
  );
}
