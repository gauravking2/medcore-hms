'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthShell, Button, ErrorCard, Field, Input } from '../../components/auth-shell';
import { ApiError, apiPost } from '../../lib/api';

const schema = z.object({ email: z.string().email('Enter a valid email address.') });

export default function ForgotPasswordPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function onSubmit(values: z.infer<typeof schema>) {
    setError(null);
    setStatus(null);
    try {
      await apiPost('/auth/forgot-password', values);
      setStatus('If an account exists, a password reset was initiated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.');
    }
  }

  return (
    <AuthShell eyebrow="Recovery" title="Forgot password" description="Enter your account email to start a reset.">
      <form className="mc-form" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Email" htmlFor="forgotEmail" error={form.formState.errors.email?.message}>
          <Input id="forgotEmail" type="email" placeholder="Email" invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
        </Field>
        {status && <p role="status" className="mc-status-ok">{status}</p>}
        {error && <ErrorCard message={error} />}
        <Button disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <style jsx>{`
        .mc-form { display: grid; gap: 12px; }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
      `}</style>
    </AuthShell>
  );
}
