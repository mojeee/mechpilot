// Performance budget (product rule 8): 100,000 entities; pan and zoom stay smooth. Measured in
// the built app with real rendering: average frame time while panning, zoomed in (culling does the
// work) and at zoom extents (every entity is drawn, batched by style).
/// <reference lib="dom" />
import { test } from '@playwright/test';
import { expect, launch } from './app';

test('100,000 entities: pan at 60 fps zoomed in, and under 40 ms per frame at zoom extents', async () => {
  const { page, close } = await launch();
  try {
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    const stats = await page.evaluate(async () => {
      type Store = {
        run(cmd: unknown): boolean;
        zoomExtents(): void;
        zoomAt(p: { x: number; y: number }, k: number): void;
        panBy(dx: number, dy: number): void;
        canvasSize: { w: number; h: number };
        editor: { doc: { entityOrder: string[] } };
      };
      const s = (window as unknown as { __mp: Store }).__mp;
      // 100k entities over a 10 m square: lines, circles, arcs and short polylines.
      const entities: unknown[] = [];
      let seed = 7;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      for (let i = 0; i < 100_000; i++) {
        const x = rnd() * 10_000;
        const y = rnd() * 10_000;
        const k = i % 4;
        if (k === 0) entities.push({ id: `p${i}`, type: 'line', layer: '0', a: { x, y }, b: { x: x + rnd() * 40 - 20, y: y + rnd() * 40 - 20 } });
        else if (k === 1) entities.push({ id: `p${i}`, type: 'circle', layer: 'hidden', center: { x, y }, radius: 1 + rnd() * 10 });
        else if (k === 2) entities.push({ id: `p${i}`, type: 'arc', layer: 'centre', center: { x, y }, radius: 2 + rnd() * 10, start: rnd() * 6, end: rnd() * 6 });
        else entities.push({ id: `p${i}`, type: 'polyline', layer: '0', points: [{ x, y }, { x: x + 5, y: y + 2 }, { x: x + 9, y: y - 3 }], closed: false });
      }
      const t0 = performance.now();
      s.run({ kind: 'addEntities', entities });
      const addMs = performance.now() - t0;
      const frames = async (n: number, step: () => void) => {
        const times: number[] = [];
        for (let i = 0; i < n; i++) {
          const a = performance.now();
          step();
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          times.push(performance.now() - a);
        }
        times.sort((p, q) => p - q);
        return { avg: times.reduce((p, q) => p + q, 0) / n, p90: times[Math.floor(n * 0.9)] };
      };
      s.zoomExtents();
      await new Promise((r) => setTimeout(r, 500));
      const extents = await frames(30, () => s.panBy(3, 2));
      // Zoom in ~100x around the centre: a few hundred entities in view.
      const c = { x: s.canvasSize.w / 2, y: s.canvasSize.h / 2 };
      for (let i = 0; i < 10; i++) s.zoomAt(c, 1.585);
      await new Promise((r) => setTimeout(r, 300));
      const zoomed = await frames(60, () => s.panBy(4, 3));
      const zooming = await frames(30, () => s.zoomAt(c, 1.02));
      const now = (window as unknown as { __mp: Store; __mpPerf: unknown }).__mp;
      return { count: now.editor.doc.entityOrder.length, addMs, extents, zoomed, zooming, render: (window as unknown as { __mpPerf: unknown }).__mpPerf };
    });
    console.log('perf', JSON.stringify(stats));
    expect(stats.count).toBe(100_000);
    // Each step waits two animation frames, so a display-rate frame shows up as ≤ ~34 ms here
    // (two 16.7 ms frames). The budget: pan and zoom never drop below the display rate.
    expect(stats.zoomed.avg).toBeLessThan(36);
    expect(stats.zooming.avg).toBeLessThan(36);
    expect(stats.extents.avg).toBeLessThan(36);
  } finally {
    await close();
  }
});
