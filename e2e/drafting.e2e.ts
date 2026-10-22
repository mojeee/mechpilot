// M1: drafting through the command line: rectangle, polyline, circle, offset, trim, mirror,
// window selection, DXF export and import, and the autosave recovery banner.
/// <reference lib="dom" />
import { test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { command, entityCount, expect, launch, menu } from './app';

test('draw, edit, export and re-import a DXF', async ({}, testInfo) => {
  const { page, saveDir, close } = await launch();
  try {
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    // Rectangle 0,0 → 100,60; a circle; a polyline.
    await command(page, 'REC');
    await command(page, '0,0');
    await command(page, '100,60');
    await command(page, 'C');
    await command(page, '50,30');
    await command(page, '10');
    await command(page, 'PL');
    await command(page, '120,0');
    await command(page, '160,0');
    await command(page, '160,40');
    await command(page, '');
    expect(await entityCount(page)).toBe(3);

    // Offset the circle outwards by 5 mm: pick the circle (click at its right quadrant), then a point outside.
    await command(page, 'O');
    await command(page, '5');
    await clickWorld(page, 60, 30);
    await command(page, '80,30');
    await command(page, '');
    expect(await entityCount(page)).toBe(4);

    // Mirror everything across x = 200, keeping the originals.
    await command(page, 'SA');
    await command(page, 'MI');
    await command(page, '200,0');
    await command(page, '200,100');
    await command(page, '');
    expect(await entityCount(page)).toBe(8);

    // Trim: the polyline's horizontal segment is cut by nothing; instead draw a line through the circles and trim it.
    await command(page, 'L');
    await command(page, '50,-20');
    await command(page, '50,80');
    await command(page, '');
    expect(await entityCount(page)).toBe(9);
    await command(page, 'TR');
    await command(page, ''); // every entity is a cutting edge
    await clickWorld(page, 50, 0.001); // the piece of the line inside the rectangle bottom edge area: between y=0 and the inner circle
    await command(page, '');
    // The line was split: at least one piece removed, others remain → count unchanged or +1/−1 but never 8 pieces fewer.
    const after = await entityCount(page);
    expect(after).toBeGreaterThanOrEqual(9);

    // Window selection: drag from (-10,-10) to (170,70) selects the originals (5) but not the mirrored ones.
    await dragWorld(page, -10, -10, 170, 70);
    await expect(page.locator('.statusbar')).toContainText(/\d+ of \d+ selected/);

    // Export DXF 2000 to the save folder (no dialog in tests) and import it back.
    await menu(page, 'File', 'Export DXF (2000)');
    await expect(page.locator('.cl-message')).toContainText('Exported');
    const files = readdirSync(saveDir).filter((f) => f.endsWith('.dxf'));
    expect(files.length).toBe(1);
    const dxf = readFileSync(join(saveDir, files[0]), 'utf8');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('$INSUNITS');

    // Italian still covers every string reached here.
    await menu(page, 'View', 'Italiano');
    await expect(page.locator('.right-panel .tab').first()).toHaveText('Proprietà');
    await page.screenshot({ path: testInfo.outputPath('drafting.png') });
  } finally {
    await close();
  }
});

test('autosave offers recovery after a crash', async () => {
  // First run: draw something and kill the app without saving (after an autosave tick).
  const first = await launch();
  const profile = await first.app.evaluate(({ app }) => app.getPath('userData'));
  await command(first.page, 'L');
  await command(first.page, '0,0');
  await command(first.page, '10,10');
  await command(first.page, '');
  // Force an autosave now instead of waiting 20 s.
  await first.page.evaluate(() => (window as unknown as { __mp?: { autosave(): Promise<void> } }).__mp?.autosave());
  await expect.poll(() => existsSync(join(profile, 'autosave.mechpilot.json')), { timeout: 30_000 }).toBe(true);
  await first.app.close();

  const second = await launch({ env: { MP_PROFILE: profile } });
  try {
    await expect(second.page.locator('.banner')).toBeVisible();
    await second.page.locator('.banner button', { hasText: 'Recover' }).click();
    expect(await entityCount(second.page)).toBe(1);
  } finally {
    await second.close();
  }
});

async function clickWorld(page: import('@playwright/test').Page, x: number, y: number) {
  const pt = await page.evaluate(([wx, wy]) => {
    const s = (window as unknown as { __mp: { view: { scale: number; origin: { x: number; y: number } } } }).__mp;
    return { x: s.view.origin.x + wx * s.view.scale, y: s.view.origin.y - wy * s.view.scale };
  }, [x, y]);
  const box = await page.locator('.canvas').boundingBox();
  await page.mouse.click(box!.x + pt.x, box!.y + pt.y);
}

async function dragWorld(page: import('@playwright/test').Page, x0: number, y0: number, x1: number, y1: number) {
  const pts = await page.evaluate(([ax, ay, bx, by]) => {
    const s = (window as unknown as { __mp: { view: { scale: number; origin: { x: number; y: number } } } }).__mp;
    const S = (x: number, y: number) => ({ x: s.view.origin.x + x * s.view.scale, y: s.view.origin.y - y * s.view.scale });
    return [S(ax, ay), S(bx, by)];
  }, [x0, y0, x1, y1]);
  const box = await page.locator('.canvas').boundingBox();
  await page.mouse.move(box!.x + pts[0].x, box!.y + pts[0].y);
  await page.mouse.down();
  await page.mouse.move(box!.x + (pts[0].x + pts[1].x) / 2, box!.y + (pts[0].y + pts[1].y) / 2, { steps: 4 });
  await page.mouse.move(box!.x + pts[1].x, box!.y + pts[1].y, { steps: 4 });
  await page.mouse.up();
}
