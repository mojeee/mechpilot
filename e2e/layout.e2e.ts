// M0: the app starts with its main layout, opens the sample, draws with the command line, undoes,
// saves without a dialog, and the background worker answers.
import { test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { command, entityCount, expect, launch, menu } from './app';

test('main layout, sample project, command line, undo, save, worker', async () => {
  const { page, saveDir, close } = await launch();
  try {
    for (const sel of ['.topbar', '.tool-palette', '.canvas', '.right-panel', '.command-line', '.statusbar']) await expect(page.locator(sel)).toBeVisible();
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    await expect(page.locator('.statusbar')).toContainText('0 entities');

    await menu(page, 'File', 'Open sample', 'Mounting bracket');
    await expect(page.locator('.doc-title')).toContainText('Mounting bracket');
    // The sample: 23 geometry entities plus 16 annotations (dimensions, symbols, note, balloon).
    expect(await entityCount(page)).toBe(39);

    await page.locator('.right-panel .tab', { hasText: 'Layers' }).click();
    await expect(page.locator('.layers .layer')).toHaveCount(4);

    await command(page, 'L');
    await expect(page.locator('.cl-prompt')).toContainText('first point');
    await command(page, '0,100');
    await command(page, '@50,0');
    await command(page, '');
    expect(await entityCount(page)).toBe(40);
    await command(page, 'U');
    expect(await entityCount(page)).toBe(39);
    await command(page, 'REDO');
    expect(await entityCount(page)).toBe(40);

    await command(page, 'NOPE');
    await expect(page.locator('.cl-message')).toContainText('Unknown command');

    await menu(page, 'File', 'Save');
    await expect(page.locator('.cl-message')).toContainText('Saved');
    const files = readdirSync(saveDir);
    expect(files).toEqual(['Mounting bracket.mechpilot.json']);
    const saved = JSON.parse(readFileSync(join(saveDir, files[0]), 'utf8')) as { format: string; entityOrder: string[] };
    expect(saved.format).toBe('mechpilot');
    expect(saved.entityOrder.length).toBe(40);

    await menu(page, 'View', 'Italiano');
    await expect(page.locator('.right-panel .tab').first()).toHaveText('Proprietà');
  } finally {
    await close();
  }
});
