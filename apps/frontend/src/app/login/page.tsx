'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/input';
import { ErrorCard } from '../../components/ui/states';
import { ApiError, apiPost } from '../../lib/api';
import { useAuthStore, type AuthUser } from '../../lib/auth-store';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
  deviceId: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const registered = useSearchParams().get('registered') === '1';
  const setSession = useAuthStore((state) => state.setSession);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const result = await apiPost<{ user: AuthUser; accessToken: string }>('/auth/login', values);
      setSession(result.user, result.accessToken);
      router.push('/dashboard');
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Sign-in failed. Please try again.');
    }
  }

  return (
    <main className="mc-auth">
      <div className="mc-auth-grid">
        <section className="mc-auth-brand" aria-label="MedCore overview">
          <Link href="/" className="mc-brand">
            <span className="mc-brand-mark" aria-hidden="true">M</span>
            <span className="mc-brand-text">
              <span className="mc-brand-name">MedCore</span>
              <span className="mc-brand-sub">Clinical intelligence</span>
            </span>
          </Link>
          <h1 className="mc-auth-title">Command center for modern hospital care.</h1>
          <p className="mc-auth-subtitle">Scheduling, encounters, pharmacy, billing, and live clinical signals — composed for every role.</p>
          <ul className="mc-auth-points">
            <li><strong>Role workspaces</strong><span>Doctor, nurse, lab, pharmacy, billing, patient.</span></li>
            <li><strong>Live operations</strong><span>Slots, queues, stock, payments, notifications.</span></li>
            <li><strong>Tenant-safe</strong><span>Every record scoped server-side by hospital.</span></li>
          </ul>
        </section>
        <Card tone="raised" entrance className="mc-auth-card">
          <p className="mc-meta-label mc-eyebrow">Welcome back</p>
          <h2 className="mc-auth-heading">Sign in</h2>
          {registered && <p role="status" className="mc-status-ok">Account created. Sign in with your new credentials.</p>}
          <form className="mc-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="email" invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
            </Field>
            <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete="current-password" invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
            </Field>
            {serverError && <ErrorCard message={serverError} />}
            <Button className="mc-w-full" size="lg" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <div className="mc-auth-links">
            <Link href="/register">Create an account</Link>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
        </Card>
      </div>
      <style jsx>{`
        .mc-auth { min-height: calc(100vh - 120px); display: grid; place-items: center; padding: 36px 0 24px; }
        .mc-auth-grid { width: 100%; display: grid; gap: 26px; grid-template-columns: 1.05fr 0.95fr; align-items: center; }
        .mc-auth-brand { display: grid; gap: 22px; align-content: start; justify-items: start; width: 100%; max-width: 32rem; justify-self: center; padding-inline: clamp(8px, 3vw, 44px); }
        .mc-brand { display: flex; align-items: center; gap: 12px; }
        .mc-brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; font-family: var(--mc-font-display); font-weight: 800; color: #fff; background: linear-gradient(135deg, #5f7dff, #22d3ee 68%, #a78bfa); box-shadow: var(--mc-glow); }
        .mc-brand-text { display: grid; line-height: 1.1; }
        .mc-brand-name { font-family: var(--mc-font-display); font-weight: 750; font-size: 1.05rem; }
        .mc-brand-sub { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mc-text-faint); }
        .mc-auth-title { margin: 0; font-size: clamp(2rem, 4.6vw, 3.2rem); line-height: 1.02; max-width: 16ch; }
        .mc-auth-subtitle { margin: 0; color: var(--mc-text-muted); font-size: 1rem; max-width: 46ch; }
        .mc-auth-points { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .mc-auth-points li { display: grid; gap: 2px; border: 1px solid var(--mc-border); border-radius: 14px; padding: 12px 14px; background: color-mix(in srgb, var(--mc-surface) 78%, transparent); }
        .mc-auth-points strong { font-size: 0.86rem; }
        .mc-auth-points span { font-size: 0.8rem; color: var(--mc-text-muted); }
        .mc-auth-card { padding: 30px; }
        .mc-auth-heading { margin: 8px 0 4px; font-size: 1.9rem; }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; margin: 12px 0 0; }
        .mc-form { display: grid; gap: 14px; margin-top: 16px; }
        .mc-w-full { width: 100%; }
        .mc-auth-links { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; font-size: 0.84rem; }
        .mc-auth-links a { color: var(--mc-accent-2); font-weight: 650; }
        @media (max-width: 900px) { .mc-auth-grid { grid-template-columns: minmax(0, 1fr); } .mc-auth-brand { display: none; } }
      `}</style>
    </main>
  );
}
