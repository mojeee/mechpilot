// M3: constraints through the command line, the solver moving geometry, driving dimensions,
// conflicts explained, and the sample sketch solving on open.
/// <reference lib="dom" />
import { test } from '@playwright/test';
import { command, entityCount, expect, launch, menu } from './app';

type Store = {
  editor: { doc: { entityOrder: string[]; entities: Record<string, { type: string; a?: { x: number; y: number }; b?: { x: number; y: number } }>; constraintOrder: string[] } };
  diagnosis: { status: string; dof: number; conflicting: string[] } | null;
  freedom: Record<string, string>;
  select(ids: string[]): void;
  run(cmd: unknown): boolean;
};
const store = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __mp: Store }).__mp);

test('constrain two lines, drive a dimension, explain a conflict', async () => {
  const { page, close } = await launch();
  try {
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    // Two lines: a horizontal-ish one and a slanted one.
    await command(page, 'L');
    await command(page, '0,0');
    await command(page, '100,5');
    await command(page, '');
    await command(page, 'L');
    await command(page, '100,5');
    await command(page, '130,60');
    await command(page, '');
    expect(await entityCount(page)).toBe(2);
    const ids = (await store(page)).editor.doc.entityOrder;
    // Constraints by command: horizontal on the first line, perpendicular between them, through the store
    // (the tools need canvas picks; the commands are what the tools run).
    await page.evaluate((ids) => {
      const s = (window as unknown as { __mp: Store }).__mp;
      s.run({ kind: 'addConstraints', constraints: [{ id: 'k1', kind: 'horizontal', entity: ids[0] }, { id: 'k2', kind: 'coincident', p1: { entity: ids[0], point: 'b' }, p2: { entity: ids[1], point: 'a' } }, { id: 'k3', kind: 'perpendicular', a: ids[0], b: ids[1] }] });
    }, ids);
    await expect.poll(async () => (await store(page)).diagnosis?.status, { timeout: 20_000 }).toBe('solved');
    const after = await store(page);
    const l1 = after.editor.doc.entities[ids[0]];
    const l2 = after.editor.doc.entities[ids[1]];
    expect(Math.abs(l1.a!.y - l1.b!.y)).toBeLessThan(1e-7);
    // Perpendicular: the second line is vertical now.
    expect(Math.abs(l2.a!.x - l2.b!.x)).toBeLessThan(1e-7);
    await expect(page.locator('.statusbar .dof')).toContainText(/DOF/);

    // A conflict: vertical on the first line too.
    await page.evaluate((ids) => (window as unknown as { __mp: Store }).__mp.run({ kind: 'addConstraints', constraints: [{ id: 'k4', kind: 'vertical', entity: ids[0] }] }), ids);
    await expect.poll(async () => (await store(page)).diagnosis?.status, { timeout: 20_000 }).toBe('conflicting');
    await expect(page.locator('.statusbar .dof')).toContainText('Over-constrained');
    await page.locator('.right-panel .tab', { hasText: 'Checks' }).click();
    await expect(page.locator('.finding-group h3.err')).toContainText('Conflicting');
    // One-click fix: remove the first conflicting constraint listed.
    await page.locator('.finding-group .finding .btn').first().click();
    await expect.poll(async () => (await store(page)).diagnosis?.status, { timeout: 20_000 }).toBe('solved');
    // Undo brings the conflict back, with the solver's moves bundled in the same step.
    await command(page, 'U');
    await expect.poll(async () => (await store(page)).editor.doc.constraintOrder.length, { timeout: 20_000 }).toBe(4);

    // The sample opens and its sketch solves (driving 120 × 80 keeps the plate as drawn).
    await menu(page, 'File', 'Open sample', 'Mounting bracket');
    await expect.poll(async () => (await store(page)).diagnosis?.status, { timeout: 30_000 }).toBe('solved');
    const sample = await store(page);
    const top = sample.editor.doc.entities.e5;
    expect(Math.abs(top.a!.x - top.b!.x)).toBeCloseTo(100, 6);
    // The freedom colouring arrives after the solve (a second worker call).
    await expect.poll(async () => (await store(page)).freedom.e1, { timeout: 30_000 }).toBe('constrained');
  } finally {
    await close();
  }
});
