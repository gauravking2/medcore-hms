'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthShell, Button, ErrorCard, Field, Input } from '../../components/auth-shell';
import { ApiError, apiPost } from '../../lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  token: z.string().min(32, 'Reset token is required.'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/, 'Use upper, lower, digit, and special character.'),
});

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '', token: '', newPassword: '' } });

  async function onSubmit(values: z.infer<typeof schema>) {
    setError(null);
    try {
      await apiPost('/auth/reset-password', values);
      router.push('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.');
    }
  }

  return (
    <AuthShell eyebrow="Recovery" title="Reset password" description="Paste the reset token, then choose a strong new password.">
      <form className="mc-form" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Email" htmlFor="resetEmail" error={form.formState.errors.email?.message}>
          <Input id="resetEmail" type="email" placeholder="Email" invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
        </Field>
        <Field label="Reset token" htmlFor="resetToken" error={form.formState.errors.token?.message}>
          <Input id="resetToken" placeholder="Reset token" invalid={Boolean(form.formState.errors.token)} {...form.register('token')} />
        </Field>
        <Field label="New password" htmlFor="resetPassword" error={form.formState.errors.newPassword?.message}>
          <Input id="resetPassword" type="password" placeholder="New password" autoComplete="new-password" invalid={Boolean(form.formState.errors.newPassword)} {...form.register('newPassword')} />
        </Field>
        {error && <ErrorCard message={error} />}
        <Button disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
      <style jsx>{`
        .mc-form { display: grid; gap: 12px; }
      `}</style>
    </AuthShell>
  );
}
