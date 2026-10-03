import { expect, test, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

async function fetchWithRetry(url: string, init?: RequestInit, attempt = 1): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 429 && attempt <= 8) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    return fetchWithRetry(url, init, attempt + 1);
  }
  return response;
}

async function apiLogin(email: string, password: string, attempt = 1): Promise<string> {
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
  const body = (await response.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

async function authPage(page: Page, path: string, email: string, password: string) {
  const token = await apiLogin(email, password);
  const meResponse = await fetchWithRetry(`${BACKEND}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!meResponse.ok) throw new Error(`me failed for ${email}: ${meResponse.status}`);
  const meBody = (await meResponse.json()) as { data: { id: string; email: string; role: string; hospitalId: string | null } };
  const me = meBody.data;
  await page.addInitScript(({ storedToken, storedUser }) => {
    localStorage.setItem(
      'medcore-auth',
      JSON.stringify({ state: { user: storedUser, accessToken: storedToken, status: 'authenticated' }, version: 0 }),
    );
  }, {
    storedToken: token,
    storedUser: { id: me.id, email: me.email, role: me.role, hospitalId: me.hospitalId },
  });
  await page.goto(path);
  return token;
}

test.describe('auth', () => {
  test('patient register validation + login + wrong password + protected page', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-patient-${stamp}@example.test`;
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter a valid email address.').first()).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('E2eTest!1234');
    await page.getByLabel('Role').fill('PATIENT');
    await page.getByLabel('Hospital').fill('northstar-demo');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/login?registered=1', { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20000 });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Wrong!1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible({ timeout: 20000 });

    await page.getByLabel('Password').fill('E2eTest!1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'My health summary' })).toBeVisible({ timeout: 20000 });
  });

  test('all nine roles can reach role dashboards', async ({ page }) => {
    const cases = [
      { role: 'SUPER_ADMIN', email: 'qa-super-admin@example.test', heading: 'Platform overview' },
      { role: 'HOSPITAL_ADMIN', email: 'qa-hospital-admin@example.test', heading: 'Hospital overview' },
      { role: 'DOCTOR', email: 'qa-doctor@example.test', heading: 'Doctor workspace' },
      { role: 'NURSE', email: 'qa-nurse@example.test', heading: 'Nursing operations' },
      { role: 'RECEPTIONIST', email: 'qa-receptionist@example.test', heading: 'Front desk' },
      { role: 'LAB_TECHNICIAN', email: 'qa-lab-technician@example.test', heading: 'Lab work queue' },
      { role: 'PHARMACIST', email: 'qa-pharmacist@example.test', heading: 'Low-stock alerts' },
      { role: 'ACCOUNTANT', email: 'qa-accountant@example.test', heading: 'Appointment volume (7 days)' },
      { role: 'PATIENT', email: 'qa-patient@example.test', heading: 'My health summary' },
    ] as const;
    for (const { email, heading } of cases) {
      await authPage(page, '/dashboard', email, 'QaTest!1234');
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20000 });
    }
  });
});
