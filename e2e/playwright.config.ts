// End-to-end tests of the built Electron app, one per workflow. Run: npm run test:e2e (builds
// first). On Linux without a display the script wraps the run in xvfb-run.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // One app at a time: every test starts its own Electron.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../out/e2e-report', open: 'never' }]],
  outputDir: '../out/e2e-results',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
