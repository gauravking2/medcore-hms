// Portable QA harness: drives a real Chromium browser over every page at every
// required breakpoint, recording layout overflow, corner/text containment,
// console errors and failed network responses.
// Run with: node .qa-tools/audit.mjs [--quick]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, 'logs');
mkdirSync(LOGS, { recursive: true });

const BACKEND = process.env.QA_BACKEND ?? 'http://localhost:3001';
const FRONTEND = process.env.QA_FRONTEND ?? 'http://localhost:3000';
const QUICK = process.argv.includes('--quick');

const BREAKPOINTS = QUICK
  ? [[390, 844], [768, 1024], [1440, 900]]
  : [
      [320, 844], [360, 800], [390, 844], [430, 932],
      [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
    ];

const GUEST_PAGES = ['/', '/login', '/register', '/forgot-password', '/reset-password'];

const ROLE_ROUTES = {
  'qa-super-admin@example.test': ['/dashboard', '/search', '/appointments', '/notifications', '/lab-pharmacy', '/billing'],
  'qa-hospital-admin@example.test': ['/dashboard', '/search', '/appointments', '/notifications', '/lab-pharmacy', '/billing'],
  'qa-doctor@example.test': ['/dashboard', '/search', '/appointments', '/records', '/lab-pharmacy', '/notifications'],
  'qa-nurse@example.test': ['/dashboard', '/appointments', '/records', '/lab-pharmacy', '/notifications'],
  'qa-receptionist@example.test': ['/dashboard', '/appointments', '/billing', '/search', '/notifications'],
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

// Root-cause oriented measurement: rather than only checking scrollWidth, walk
// every element and report those whose painted box crosses outside the
// viewport, plus any rounded container whose child content is painted above
// content-box top — that is exactly the "text crossing the rounded corner" bug.
const measure = () => {
  const d = document.documentElement;
  const vw = d.clientWidth;
  const pageOverflow = d.scrollWidth - vw;

  const outsideViewport = [];
  const escapedRounded = [];

  const rounded = /^(mc-card|mc-glass|mc-stat|mc-state|mc-error|mc-modal|mc-toast|mc-notif|mc-timeline-card|mc-searchbar|mc-tabs|mc-auth-card|mc-table-empty)$/;

  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (el.classList.contains('sr-only')) return;
    if (el.closest('.table-scroll')) return;
    if (r.right > vw + 1 || r.left < -1) {
      outsideViewport.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }

    const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [];
    if (!cls.some((c) => rounded.test(c))) return;
    const cs = getComputedStyle(el);
    const br = el.getBoundingClientRect();
    const padTop = parseFloat(cs.paddingTop) || 0;
    // Compare only DESCENDANTS against the container's content box: the
    // container itself always starts at its own top, so including it here
    // produced a false positive on every card.
    const probes = el.querySelectorAll('h1,h2,h3,p,span,strong,small,label,li');
    for (const probe of probes) {
      const pr = probe.getBoundingClientRect();
      if (pr.height === 0) continue;
      if (pr.top < br.top + Math.min(padTop, 12) - 0.5) {
        escapedRounded.push({
          container: (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).join('.'),
          padTop,
          child: probe.tagName.toLowerCase(),
          childCls: (typeof probe.className === 'string' ? probe.className : '').slice(0, 50),
          childTop: Math.round(pr.top - br.top),
          text: (probe.textContent ?? '').trim().slice(0, 30),
        });
        break;
      }
    }
  });

  return {
    overflow: pageOverflow,
    viewport: vw,
    outsideCount: outsideViewport.length,
    outsideViewport: outsideViewport.slice(0, 6),
    escapedCount: escapedRounded.length,
    escapedRounded: escapedRounded.slice(0, 6),
  };
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const results = [];
const problems = [];

const clean = (t) => t.replace(/\s+/g, ' ').slice(0, 200);

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push({ label, kind: 'console', url: page.url(), text: clean(msg.text()) });
  });
  page.on('pageerror', (err) => problems.push({ label, kind: 'pageerror', url: page.url(), text: clean(`PAGEERROR ${err.message}`) }));
  page.on('response', (res) => {
    const s = res.status();
    if (s < 400) return;
    // The API is same-origin proxied through /api; recording both the backend
    // and the frontend copy of one failure double-counts it.
    const url = res.url();
    if (url.includes('localhost:3001')) return;
    problems.push({ label, kind: 'network', url: url.slice(0, 130), text: `HTTP ${s}`, status: s, method: res.request().method() });
  });
}

async function sweep(page, label, routes) {
  for (const path of routes) {
    for (const [w, h] of BREAKPOINTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${FRONTEND}${path}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(300);
      results.push({ label, path, w, h, ...(await page.evaluate(measure)) });
    }
  }
}

{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page, 'guest');
  await sweep(page, 'guest', GUEST_PAGES);
  await ctx.close();
}

for (const [email, routes] of Object.entries(ROLE_ROUTES)) {
  let creds;
  try {
    creds = await apiLogin(email);
  } catch (error) {
    problems.push({ label: email, kind: 'login', text: String(error.message) });
    continue;
  }
  const ctx = await browser.newContext();
  await ctx.addInitScript(sessionScript(creds.token, creds.user));
  const page = await ctx.newPage();
  watch(page, email);
  await sweep(page, email, routes);
  await ctx.close();
}

await browser.close();

const failing = results.filter((r) => r.overflow > 1 || r.outsideCount > 0 || r.escapedCount > 0);
const report = {
  totalChecks: results.length,
  failingChecks: failing.length,
  overflowIssues: results.filter((r) => r.overflow > 1).length,
  escapedIssues: results.filter((r) => r.escapedCount > 0).length,
  outsideIssues: results.filter((r) => r.outsideCount > 0).length,
  consoleErrors: problems.filter((p) => p.kind === 'console' || p.kind === 'pageerror').length,
  networkErrors: problems.filter((p) => p.kind === 'network').length,
  failing,
  problems: problems.slice(0, 80),
};
writeFileSync(join(LOGS, 'audit.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  totalChecks: report.totalChecks,
  failingChecks: report.failingChecks,
  overflowIssues: report.overflowIssues,
  escapedIssues: report.escapedIssues,
  outsideIssues: report.outsideIssues,
  consoleErrors: report.consoleErrors,
  networkErrors: report.networkErrors,
}, null, 2));

for (const f of failing.slice(0, 30)) {
  console.log(`FAIL ${f.label} ${f.path} @${f.w}x${f.h} overflow=${f.overflow} outside=${f.outsideCount} escaped=${f.escapedCount}`);
  if (f.outsideViewport.length) console.log('   outside:', JSON.stringify(f.outsideViewport));
  if (f.escapedRounded.length) console.log('   escaped:', JSON.stringify(f.escapedRounded));
}

const byStatus = {};
for (const p of problems.filter((p) => p.kind === 'network')) {
  const key = `${p.status} ${p.url.replace(/^https?:\/\/[^/]+/, '')}`;
  byStatus[key] = (byStatus[key] ?? 0) + 1;
}
console.log('NETWORK:', JSON.stringify(byStatus, null, 1));

const byConsole = {};
for (const p of problems.filter((p) => p.kind === 'console' || p.kind === 'pageerror')) {
  byConsole[p.text] = (byConsole[p.text] ?? 0) + 1;
}
console.log('CONSOLE:', JSON.stringify(byConsole, null, 1));