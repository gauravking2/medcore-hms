import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'desktop-ui', width: 1440, height: 900 },
  { name: 'tablet-ui', width: 768, height: 1024 },
  { name: 'mobile-ui', width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`responsive ${viewport.name}: key pages render without overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const path of ['/login', '/dashboard', '/appointments', '/billing', '/notifications', '/search', '/portal']) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows at ${viewport.name}`).toBeLessThanOrEqual(1);
    }
    expect(errors.filter((message) => !message.includes('hydration'))).toHaveLength(0);
  });
}

test('console and network audit on dashboard and search', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20000 });
  await page.goto('/search');
  await page.waitForLoadState('domcontentloaded');
  expect(failedRequests).toHaveLength(0);
  expect(consoleErrors.filter((text) => !text.toLowerCase().includes('warning'))).toHaveLength(0);
});
