// Starts the built app (out/) with a fresh profile, and small helpers that drive it the way a
// user does: the in-app menus and the command line.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..');

export interface App {
  app: ElectronApplication;
  page: Page;
  /** Where files saved by the app go (MP_SAVE_DIR), so no dialog opens. */
  saveDir: string;
  close(): Promise<void>;
}

/** `aiFake` runs the assistant against the scripted fake provider (MP_AI_FAKE=1, no key, no network). */
export async function launch(opts: { env?: Record<string, string>; aiFake?: boolean } = {}): Promise<App> {
  const profile = mkdtempSync(join(tmpdir(), 'mp-e2e-'));
  const saveDir = mkdtempSync(join(tmpdir(), 'mp-e2e-save-'));
  const app = await electron.launch({
    args: ['.', '--no-sandbox', ...(process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [])],
    cwd: root,
    env: { ...process.env, MP_PROFILE: profile, MP_SAVE_DIR: saveDir, ...(opts.aiFake ? { MP_AI_FAKE: '1' } : {}), ...opts.env },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar', { timeout: 60_000 });
  return { app, page, saveDir, close: () => app.close() };
}

/** Click a top-menu title, then an item by its visible text (optionally inside a submenu). */
export async function menu(page: Page, title: string, item: string, sub?: string): Promise<void> {
  await page.locator('.top-menu .menu-title', { hasText: title }).click();
  if (sub) {
    // Click rather than hover: the submenu opens on both, and a click is not racy.
    await page.locator('.menu-item.has-sub', { hasText: item }).click();
    await page.locator('.menu-list.sub .menu-item', { hasText: sub }).first().click();
  } else await page.locator('.menu-list .menu-item', { hasText: item }).first().click();
}

/** Type a command (or a point) in the command line and press Enter. */
export async function command(page: Page, text: string): Promise<void> {
  const input = page.locator('.command-line input');
  await input.fill(text);
  await input.press('Enter');
}

export async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('.statusbar .entities').textContent()) ?? '';
  const m = /(\d+) (?:entities|of (\d+) selected)/.exec(text);
  if (!m) throw new Error(`no entity count in status bar: ${text}`);
  return Number(m[2] ?? m[1]);
}

export { expect };
