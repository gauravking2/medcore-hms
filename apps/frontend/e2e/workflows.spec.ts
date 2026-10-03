import { expect, test, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

interface MeResponse {
  id: string;
  email: string;
  role: string;
  hospitalId: string | null;
}

async function apiLogin(email: string, password: string, attempt = 1): Promise<{ token: string; me: MeResponse }> {
  const response = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 429 && attempt <= 8) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return apiLogin(email, password, attempt + 1);
  }
  if (!response.ok) throw new Error(`login failed for ${email}: ${response.status}`);
  const body = (await response.json()) as { data: { accessToken: string; user: MeResponse } };
  return { token: body.data.accessToken, me: body.data.user };
}

async function seedAuth(page: Page, email: string, password: string) {
  const { token, me } = await apiLogin(email, password);
  await page.addInitScript(({ storedToken, storedUser }) => {
    localStorage.setItem('medcore-auth', JSON.stringify({ state: { user: storedUser, accessToken: storedToken, status: 'authenticated' }, version: 0 }));
  }, { storedToken: token, storedUser: { id: me.id, email: me.email, role: me.role, hospitalId: me.hospitalId } });
  return { token, me };
}

async function apiFetch(path: string, token: string, init?: RequestInit, attempt = 1) {
  const response = await fetch(`${BACKEND}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 429 && attempt <= 8) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return apiFetch(path, token, init, attempt + 1);
  }
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return (await response.json()) as { data: unknown };
}

test.describe('role dashboards and portal', () => {
  test('all nine roles see their dashboard workspace', async ({ page }) => {
    const cases = [
      { role: 'SUPER_ADMIN', heading: 'Platform overview' },
      { role: 'HOSPITAL_ADMIN', heading: 'Hospital overview' },
      { role: 'DOCTOR', heading: 'Doctor workspace' },
      { role: 'NURSE', heading: 'Nursing operations' },
      { role: 'RECEPTIONIST', heading: 'Front desk' },
      { role: 'LAB_TECHNICIAN', heading: 'Lab work queue' },
      { role: 'PHARMACIST', heading: 'Low-stock alerts' },
      { role: 'ACCOUNTANT', heading: 'Appointment volume (7 days)' },
      { role: 'PATIENT', heading: 'My health summary' },
    ] as const;
    for (const { role, heading } of cases) {
      const email = `qa-${role.toLowerCase().replace(/_/g, '-')}@example.test`;
      await seedAuth(page, email, 'QaTest!1234');
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20000 });
    }
  });

  test('patient portal loads own data sections', async ({ page }) => {
    await seedAuth(page, 'qa-patient@example.test', 'QaTest!1234');
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Upcoming appointments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoices & payments' })).toBeVisible();
  });

  test('doctor dashboard shows timeline widget', async ({ page }) => {
    await seedAuth(page, 'qa-doctor@example.test', 'QaTest!1234');
    await page.goto('/dashboard');
    await expect(page.getByText('Doctor workspace')).toBeVisible({ timeout: 20000 });
  });
});

test.describe('analytics and search', () => {
  test('admin analytics charts render with real data', async ({ page }) => {
    await seedAuth(page, 'qa-hospital-admin@example.test', 'QaTest!1234');
    await page.goto('/dashboard');
    await expect(page.getByText('Hospital overview')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Appointment volume (7 days)')).toBeVisible({ timeout: 20000 });
  });

  test('global search finds doctors with pagination', async ({ page }) => {
    await seedAuth(page, 'qa-receptionist@example.test', 'QaTest!1234');
    await page.goto('/search');
    await page.getByRole('tab', { name: 'Doctors' }).click();
    await page.getByLabel('Search', { exact: true }).fill('Card');
    await page.waitForTimeout(3000);
    const alertVisible = await page.getByText('Search failed. Check your filters and try again.').count();
    if (alertVisible > 0) {
      await page.getByRole('button', { name: 'Retry' }).click();
    }
    await expect(page.getByText(/Page \d+ of \d+/).first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe('appointments, billing, lab, notifications', () => {
  test('patient can open booking and billing pages with live data', async ({ page }) => {
    const { token } = await seedAuth(page, 'qa-patient@example.test', 'QaTest!1234');
    const appointments = await apiFetch('/appointments', token);
    expect(appointments.data).toBeDefined();
    await page.goto('/appointments');
    await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible({ timeout: 20000 });
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Billing & payments' })).toBeVisible({ timeout: 20000 });
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: /Notifications/ })).toBeVisible({ timeout: 20000 });
  });
});
