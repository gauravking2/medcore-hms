// QA harness: drives a real Chromium browser over every page at every required
// breakpoint, recording layout overflow, card padding, console errors and
// failed network responses. Run with: node .qa-tools/browser-audit.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = 'D:\\study\\commandcode\\intermo proj 3';
const LOGS = `${ROOT}\\.qa-tools\\logs`;
mkdirSync(LOGS, { recursive: true });

const BACKEND = 'http://localhost:3001';
const FRONTEND = 'http://localhost:3000';

const BREAKPOINTS = [
  [320, 844], [360, 800], [390, 844], [430, 932],
  [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
];

const PAGES = [
  ['/', 'guest'],
  ['/login', 'guest'],
  ['/register', 'guest'],
  ['/forgot-password', 'guest'],
  ['/reset-password?email=qa-patient@example.test&token=abc', 'guest'],
  ['/dashboard', 'patient'],
  ['/appointments', 'patient'],
  ['/billing', 'patient'],
  ['/records', 'patient'],
  ['/lab-pharmacy', 'patient'],
  ['/notifications', 'patient'],
  ['/portal', 'patient'],
];

// Roles to sweep over the authenticated shell routes.
const ROLE_ROUTES = {
  'qa-super-admin@example.test': ['/dashboard', '/search', '/appointments', '/notifications'],
  'qa-hospital-admin@example.test': ['/dashboard', '/search', '/notifications'],
  'qa-doctor@example.test': ['/dashboard', '/appointments', '/records', '/lab-pharmacy', '/notifications'],
  'qa-nurse@example.test': ['/dashboard', '/appointments', '/records', '/lab-pharmacy', '/notifications'],
  'qa-receptionist@example.test': ['/dashboard', '/appointments', '/billing', '/notifications'],
  'qa-lab-technician@example.test': ['/dashboard', '/lab-pharmacy', '/search', '/notifications'],
  'qa-pharmacist@example.test': ['/dashboard', '/lab-pharmacy', '/search', '/notifications'],
  'qa-accountant@example.test': ['/dashboard', '/billing', '/search', '/notifications'],
  'qa-patient@example.test': ['/dashboard', '/appointments', '/billing', '/records', '/lab-pharmacy', '/portal', '/notifications'],
};

async function apiLogin(email, password = 'QaTest!1234') {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const body = await res.json();
  return { token: body.data.accessToken, user: body.data.user };
}

function sessionScript(token, user) {
  return `localStorage.setItem('medcore-auth', ${JSON.stringify(
    JSON.stringify({ state: { user, accessToken: token, status: 'authenticated' }, version: 0 }),
  )});`;
}

const measure = () => {
  const d = document.documentElement;
  const vw = d.clientWidth;
  const offenders = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  });
  const zeroPadCards = [];
  document.querySelectorAll('.mc-card, .mc-glass').forEach((c) => {
    const cs = getComputedStyle(c);
    const padTop = parseFloat(cs.paddingTop);
    const title = c.querySelector('.mc-card-title, .mc-section-title, h2, h3');
    let titleGap = null;
    if (title) {
      const tr = title.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      titleGap = Math.round(tr.top - cr.top);
    }
    if (padTop === 0 || (titleGap !== null && titleGap < 8)) {
      zeroPadCards.push({
        cls: (typeof c.className === 'string' ? c.className : '').slice(0, 60),
        padTop,
        titleGap,
        titleText: (title?.textContent ?? '').slice(0, 24),
      });
    }
  });
  return {
    overflow: d.scrollWidth - vw,
    viewport: vw,
    offenderCount: offenders.length,
    offenders: offenders.slice(0, 5),
    zeroPadCards: zeroPadCards.slice(0, 6),
  };
};

// The repository's playwright config uses the system Edge build on Windows
// (no downloaded browsers), so reuse the same executable here.
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const results = [];
const consoleErrors = [];

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 200) });
  });
  page.on('pageerror', (err) => consoleErrors.push({ url: page.url(), text: `PAGEERROR ${err.message}`.slice(0, 200) }));
  page.on('response', (res) => {
    const s = res.status();
    if (s >= 400) consoleErrors.push({ url: res.url().slice(0, 120), text: `HTTP ${s}`, network: true });
  });
  return page;
}

// 1. Guest + patient sweep over every breakpoint.
for (const [label, email] of [['guest', null], ['patient', 'qa-patient@example.test']]) {
  const ctx = await browser.newContext();
  if (email) {
    const { token, user } = await apiLogin(email);
    await ctx.addInitScript(sessionScript(token, user));
  }
  const page = await newPage(ctx);
  for (const [path] of PAGES) {
    if (label === 'guest' && !['/', '/login', '/register', '/forgot-password', '/reset-password?email=qa-patient@example.test&token=abc'].includes(path)) continue;
    if (label === 'patient' && ['/', '/login', '/register', '/forgot-password'].includes(path)) continue;
    for (const [w, h] of BREAKPOINTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${FRONTEND}${path}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(400);
      const m = await page.evaluate(measure);
      results.push({ label, path, w, h, ...m });
    }
  }
  await ctx.close();
}

// 2. Role sweep at desktop + one mobile width.
for (const [email, routes] of Object.entries(ROLE_ROUTES)) {
  const ctx = await browser.newContext();
  const { token, user } = await apiLogin(email);
  await ctx.addInitScript(sessionScript(token, user));
  const page = await newPage(ctx);
  for (const path of routes) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${FRONTEND}${path}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(400);
      const m = await page.evaluate(measure);
      results.push({ label: email, path, w, h, ...m });
    }
  }
  await ctx.close();
}

await browser.close();

const failing = results.filter((r) => r.overflow > 1 || r.offenderCount > 0 || r.zeroPadCards.length > 0);
const report = {
  totalChecks: results.length,
  failingChecks: failing.length,
  overflowIssues: results.filter((r) => r.overflow > 1).length,
  zeroPadIssues: results.filter((r) => r.zeroPadCards.length > 0).length,
  consoleErrors: consoleErrors.length,
  failing,
  consoleErrorSample: consoleErrors.slice(0, 40),
};
writeFileSync(`${LOGS}\\browser-audit.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalChecks: report.totalChecks, failingChecks: report.failingChecks, overflowIssues: report.overflowIssues, zeroPadIssues: report.zeroPadIssues, consoleErrors: report.consoleErrors }, null, 2));
for (const f of failing.slice(0, 25)) {
  console.log(`FAIL ${f.label} ${f.path} @${f.w}x${f.h} overflow=${f.overflow} offenders=${f.offenderCount} zeroPad=${f.zeroPadCards.length}`);
  if (f.offenders.length) console.log('   offenders:', JSON.stringify(f.offenders));
  if (f.zeroPadCards.length) console.log('   cards:', JSON.stringify(f.zeroPadCards));
}
