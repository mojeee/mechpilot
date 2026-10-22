// M4: a closed outline becomes a sketch, EXTRUDE builds a body in the kernel worker, the volume
// is right, a HOLE cuts it, undo removes the feature, and the samples build.
/// <reference lib="dom" />
import { test } from '@playwright/test';
import { command, expect, launch, menu } from './app';

type Build = { mesh: { positions: Float32Array } | null; properties: { volume: number } | null; errors: { feature: string; message: string }[]; status: Record<string, string> } | null;
type Store = {
  editor: { doc: { entityOrder: string[]; partOrder: string[]; parts: Record<string, { features: { id: string; kind: string }[] }> } };
  activePart: string | null;
  build: Build;
  building: boolean;
  select(ids: string[]): void;
  run(cmd: unknown): boolean;
  setActivePart(id: string | null): void;
};
const store = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __mp: Store }).__mp);
const volume = async (page: import('@playwright/test').Page) => {
  const s = await store(page);
  return s.building || !s.build ? null : (s.build.properties?.volume ?? -1);
};

test('sketch, extrude, hole, undo, and the samples build', async () => {
  const { page, close } = await launch({ softwareGl: true });
  try {
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    // A 100 × 60 rectangle as four lines, selected, made into a sketch and extruded 10 mm.
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      const p = [
        [0, 0],
        [100, 0],
        [100, 60],
        [0, 60],
      ];
      s.run({ kind: 'addEntities', entities: p.map(([x, y], i) => ({ id: `r${i}`, type: 'line', layer: '0', a: { x, y }, b: { x: p[(i + 1) % 4][0], y: p[(i + 1) % 4][1] } })) });
      s.select(['r0', 'r1', 'r2', 'r3']);
    });
    await command(page, 'SKETCH');
    await command(page, 'EXTRUDE 10');
    await expect.poll(async () => (await store(page)).activePart, { timeout: 20_000 }).not.toBeNull();
    await expect(page.locator('.viewer-wrap')).toBeVisible();
    await expect.poll(() => volume(page), { timeout: 120_000 }).not.toBeNull();
    expect(await volume(page)).toBeCloseTo(100 * 60 * 10, 3);
    await expect(page.locator('.right-panel .tab.on')).toHaveText('Features');

    // A circle at the centre becomes a second sketch; HOLE M6 cuts a Ø6.6 through hole.
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      s.run({ kind: 'addEntities', entities: [{ id: 'c1', type: 'circle', layer: '0', center: { x: 50, y: 30 }, radius: 3.3 }] });
      s.select(['c1']);
    });
    await command(page, 'SKETCH XY 10');
    await command(page, 'HOLE M6');
    await expect.poll(async () => (await store(page)).editor.doc.parts[(await store(page)).activePart!].features.length, { timeout: 20_000 }).toBe(4);
    const expected = 100 * 60 * 10 - Math.PI * 3.3 * 3.3 * 10;
    await expect.poll(() => volume(page), { timeout: 120_000 }).toBeCloseTo(expected, 0);
    const built = (await store(page)).build!;
    expect(built.errors).toEqual([]);
    expect(Object.values(built.status).every((v) => v === 'ok')).toBe(true);

    // Undo removes the hole and the body rebuilds to the full block.
    await command(page, 'U');
    await expect.poll(() => volume(page), { timeout: 120_000 }).toBeCloseTo(100 * 60 * 10, 0);

    // A feature that cannot build is explained, not fatal: a 40 mm fillet on 10 mm edges.
    await command(page, 'FILLET 40');
    await expect.poll(async () => (await store(page)).build?.errors.length ?? 0, { timeout: 120_000 }).toBeGreaterThan(0);
    await expect(page.locator('.feature.err .feature-error')).toBeVisible();
    expect(await volume(page)).toBeCloseTo(100 * 60 * 10, 0);

    // The samples open and build.
    for (const [name, min] of [
      ['Stepped shaft', 100_000],
      ['Sheet-metal cover', 10_000],
    ] as const) {
      await menu(page, 'File', 'Open sample', name);
      await page.evaluate(() => {
        const s = (window as unknown as { __mp: Store }).__mp;
        s.setActivePart(s.editor.doc.partOrder[0]);
      });
      await expect.poll(() => volume(page), { timeout: 180_000 }).not.toBeNull();
      const b = (await store(page)).build!;
      expect(b.errors, name).toEqual([]);
      expect(b.properties!.volume).toBeGreaterThan(min);
    }
  } finally {
    await close();
  }
});
