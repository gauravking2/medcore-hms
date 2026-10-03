'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/input';
import { ErrorCard } from '../../components/ui/states';
import { ApiError, apiPost } from '../../lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/, 'Use upper, lower, digit, and special character.'),
  role: z.enum(['PATIENT', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN']),
  hospitalSlug: z.string().min(1, 'Hospital identifier is required.'),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', role: 'PATIENT', hospitalSlug: 'northstar-demo' },
  });

  const emailError = form.formState.errors.email?.message;
  const passwordError = form.formState.errors.password?.message;

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await apiPost('/auth/register', values);
      router.push('/login?registered=1');
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Registration failed. Please try again.');
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
          <h1 className="mc-auth-title">Join your hospital command center.</h1>
          <p className="mc-auth-subtitle">Role-scoped access with hospital tenant isolation enforced on every request.</p>
        </section>
        <Card tone="raised" entrance className="mc-auth-card">
          <p className="mc-meta-label mc-eyebrow">Get started</p>
          <h2 className="mc-auth-heading">Create an account</h2>
          <form className="mc-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Field label="Email" htmlFor="email" error={emailError}>
              <Input id="email" type="email" autoComplete="email" invalid={Boolean(emailError)} {...form.register('email')} />
            </Field>
            <Field label="Password" htmlFor="password" error={passwordError} hint="Upper, lower, digit, and special character.">
              <Input id="password" type="password" autoComplete="new-password" invalid={Boolean(passwordError)} {...form.register('password')} />
            </Field>
            <div className="mc-form-grid">
              <Field label="Role" htmlFor="role" error={form.formState.errors.role?.message}>
                <Input id="role" invalid={Boolean(form.formState.errors.role)} {...form.register('role')} />
              </Field>
              <Field label="Hospital" htmlFor="hospitalSlug" error={form.formState.errors.hospitalSlug?.message}>
                <Input id="hospitalSlug" invalid={Boolean(form.formState.errors.hospitalSlug)} {...form.register('hospitalSlug')} />
              </Field>
            </div>
            {serverError && <ErrorCard message={serverError} />}
            <Button size="lg" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
          <div className="mc-auth-links">
            <Link href="/login">Already registered? Sign in</Link>
          </div>
        </Card>
      </div>
      <style jsx>{`
        .mc-auth { min-height: calc(100vh - 120px); display: grid; place-items: center; padding: 36px 0 24px; }
        .mc-auth-grid { width: 100%; display: grid; gap: 26px; grid-template-columns: 1.05fr 0.95fr; align-items: center; }
        .mc-auth-brand { display: grid; gap: 14px; align-content: start; }
        .mc-brand { display: flex; align-items: center; gap: 12px; }
        .mc-brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; font-family: var(--mc-font-display); font-weight: 800; color: #fff; background: linear-gradient(135deg, #5f7dff, #22d3ee 68%, #a78bfa); box-shadow: var(--mc-glow); }
        .mc-brand-text { display: grid; line-height: 1.1; }
        .mc-brand-name { font-family: var(--mc-font-display); font-weight: 750; font-size: 1.05rem; }
        .mc-brand-sub { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mc-text-faint); }
        .mc-auth-title { margin: 6px 0 0; font-size: clamp(2rem, 4.6vw, 3rem); line-height: 1.02; max-width: 16ch; }
        .mc-auth-subtitle { margin: 0; color: var(--mc-text-muted); max-width: 44ch; }
        .mc-auth-card { padding: 30px; }
        .mc-auth-heading { margin: 8px 0 4px; font-size: 1.9rem; }
        .mc-form { display: grid; gap: 14px; margin-top: 16px; }
        .mc-form-grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
        .mc-auth-links { display: flex; margin-top: 18px; font-size: 0.84rem; }
        .mc-auth-links a { color: var(--mc-accent-2); font-weight: 650; }
        @media (max-width: 900px) { .mc-auth-grid { grid-template-columns: minmax(0, 1fr); } .mc-auth-brand { display: none; } .mc-form-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
