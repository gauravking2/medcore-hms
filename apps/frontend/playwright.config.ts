import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const EDGE_WINDOWS_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const LINUX_CHROMIUM = `${process.env.HOME ?? '/home/gazio'}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

function browserExecutable(): string | undefined {
  if (process.platform === 'win32') return EDGE_WINDOWS_PATH;
  if (existsSync(LINUX_CHROMIUM)) return LINUX_CHROMIUM;
  return undefined;
}

const EXECUTABLE = browserExecutable();

export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(EXECUTABLE ? { launchOptions: { executablePath: EXECUTABLE, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] } } : {}),
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}) } },
  ],
});
