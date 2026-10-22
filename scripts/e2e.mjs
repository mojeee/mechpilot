// End-to-end tests of the built Electron app (e2e/*.e2e.ts, Playwright): builds, then runs them.
// On Linux without a display they run under xvfb-run. Extra arguments go to Playwright, e.g.
//   npm run test:e2e -- -g "sample"
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!process.argv.includes('--no-build')) run('npm', ['run', 'build']);
const pw = ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...process.argv.slice(2).filter((a) => a !== '--no-build')];
if (process.platform === 'linux' && !process.env.DISPLAY) run('xvfb-run', ['-a', '-s', '-screen 0 1920x1200x24', 'npx', ...pw]);
else run('npx', pw);
