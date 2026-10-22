// Screenshots of the real app for the website (site/img/*.png): the sample drawing (landing hero),
// its sheet, and the constrained sketch with its degree-of-freedom colouring, each in the dark and
// the light theme, at a 1440 × 900 window. Not a test of behaviour, so it is skipped in CI; run it
// after `npm run build` with:
//   npx playwright test -c e2e/playwright.config.ts screenshots
// then `npm run build:site` to pick the new images up.
/// <reference lib="dom" />
import { _electron as electron, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, expect, menu } from './app';

const root = join(__dirname, '..');
const outDir = join(root, 'site', 'img');
const WIDTH = 1440;
const HEIGHT = 900;

type Theme = 'dark' | 'light';
type Store = {
  editor: { doc: { partOrder: string[] } };
  build: { properties: { volume: number } | null } | null;
  building: boolean;
  setActivePart(id: string | null): void;
  diagnosis: { status: string } | null;
  freedom: Record<string, string>;
  select(ids: string[]): void;
  openFile(path: string): Promise<void>;
  updateSettings(patch: { theme?: Theme; canvas?: 'dark' | 'white' }): Promise<void>;
};
const store = (page: Page) => page.evaluate(() => (window as unknown as { __mp: Store }).__mp);

/** Two animation frames: the canvas has drawn whatever the last change asked for. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

async function shot(page: Page, name: string): Promise<void> {
  // The pointer off the canvas, so no hover highlight or cursor readout shows.
  await page.mouse.move(WIDTH - 2, 2);
  await settle(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

test.skip(!!process.env.CI, 'Website screenshots are taken by hand, not in CI');

test('website screenshots', async () => {
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'mp-shots-'));
  const saveDir = mkdtempSync(join(tmpdir(), 'mp-shots-save-'));
  const app = await electron.launch({
    // Device scale factor 1: the PNGs are exactly 1440 × 900 whatever the display scaling.
    args: ['.', '--no-sandbox', '--force-device-scale-factor=1'],
    cwd: root,
    env: { ...process.env, MP_PROFILE: profile, MP_SAVE_DIR: saveDir },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.topbar', { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(size.w, size.h);
    }, { w: WIDTH, h: HEIGHT });
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([WIDTH, HEIGHT]);

    // MP_SHOTS_SAMPLE: open this file instead of the bundled sample (when the sample in the working
    // tree is newer than the app in out/).
    const sample = process.env.MP_SHOTS_SAMPLE;
    if (sample) await page.evaluate((p) => (window as unknown as { __mp: Store }).__mp.openFile(p), sample);
    else await menu(page, 'File', 'Open sample', 'Mounting bracket');
    await expect(page.locator('.doc-title')).toContainText('Mounting bracket');
    await expect.poll(async () => (await store(page)).diagnosis?.status, { timeout: 30_000 }).toBe('solved');
    await expect.poll(async () => (await store(page)).freedom.e1, { timeout: 30_000 }).toBe('constrained');

    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((theme) => (window as unknown as { __mp: Store }).__mp.updateSettings({ theme, canvas: theme === 'dark' ? 'dark' : 'white' }), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // Landing hero: the whole drawing in model space, Properties panel.
      await page.locator('.sheet-tabs .stab').first().click();
      await page.evaluate(() => (window as unknown as { __mp: Store }).__mp.select([]));
      await command(page, 'ZE');
      await page.locator('.right-panel .tab', { hasText: 'Layers' }).click();
      await shot(page, `hero-${theme}`);

      // The sketch: constraint glyphs and the degree-of-freedom colouring, with the Checks tab.
      await page.locator('.right-panel .tab', { hasText: 'Checks' }).click();
      await command(page, 'ZE');
      await shot(page, `sketch-${theme}`);

      // The sheet: A3 with frame, zones and the ISO 7200 title block.
      await page.locator('.sheet-tabs .stab', { hasText: 'Sheet 1' }).click();
      await expect(page.locator('.right-panel .tab.on')).toHaveText('Sheets');
      await shot(page, `sheet-${theme}`);
    }

    // The 3D part: the stepped shaft sample built in the kernel, Features tab open.
    await menu(page, 'File', 'Open sample', 'Stepped shaft');
    await expect(page.locator('.doc-title')).toContainText('Stepped shaft');
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      s.setActivePart(s.editor.doc.partOrder[0]);
    });
    await expect.poll(async () => {
      const s = await store(page);
      return !s.building && s.build?.properties ? s.build.properties.volume : null;
    }, { timeout: 120_000 }).not.toBeNull();
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((theme) => (window as unknown as { __mp: Store }).__mp.updateSettings({ theme, canvas: theme === 'dark' ? 'dark' : 'white' }), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.locator('.right-panel .tab', { hasText: 'Features' }).click();
      await page.waitForTimeout(500);
      await shot(page, `part-${theme}`);
    }
  } finally {
    await app.close();
  }
});
