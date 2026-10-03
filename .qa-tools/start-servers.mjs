// QA helper: launches the built backend and the Next dev server detached so the
// agent shell can keep working. Delete when QA is finished.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

const ROOT = 'D:\\study\\commandcode\\intermo proj 3';
const LOGS = `${ROOT}\\.qa-tools\\logs`;
mkdirSync(LOGS, { recursive: true });

const backendEnv = {
  ...process.env,
  DATABASE_URL: 'postgresql://medcore:change-me-locally@localhost:5432/medcore?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'local-only-change-this-secret-32-characters',
  BACKEND_PORT: '3001',
  FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
  COOKIE_SECURE: 'false',
  NODE_ENV: 'development',
};

const frontendEnv = {
  ...process.env,
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  PORT: '3000',
};

function launch(name, command, args, cwd, env) {
  const out = openSync(`${LOGS}\\${name}.log`, 'a');
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  console.log(`${name} -> pid ${child.pid}`);
}

const target = process.argv[2] ?? 'all';
if (target === 'backend' || target === 'all') {
  launch('backend', 'node', ['dist/main.js'], `${ROOT}\\apps\\backend`, backendEnv);
}
if (target === 'frontend' || target === 'all') {
  // Spawn the Next CLI through node directly: Node 24 refuses to spawn .cmd
  // shims without a shell on Windows.
  launch('frontend', process.execPath, [`${ROOT}\\node_modules\\next\\dist\\bin\\next`, 'start', '-p', '3000'], `${ROOT}\\apps\\frontend`, frontendEnv);
}