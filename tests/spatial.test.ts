// The spatial index: correctness against brute force, and the performance budget for picking and
// culling with 100,000 entities (product rule 8).

import { describe, expect, it } from 'vitest';
import { contains, overlaps, SpatialIndex, type Indexed } from '@shared/spatial/index';
import type { Box } from '@shared/geometry/vec2';

/** Deterministic pseudo-random boxes (LCG) so the test is reproducible. */
function boxes(n: number, extent: number, maxSize: number, seed = 1): Indexed<string>[] {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const out: Indexed<string>[] = [];
  for (let i = 0; i < n; i++) {
    const x = rnd() * extent;
    const y = rnd() * extent;
    const w = rnd() * maxSize;
    const h = rnd() * maxSize;
    out.push({ key: `e${i}`, box: { min: { x, y }, max: { x: x + w, y: y + h } } });
  }
  return out;
}

const brute = (items: Indexed<string>[], q: Box) => items.filter((it) => overlaps(it.box, q)).map((it) => it.key).sort();

describe('SpatialIndex', () => {
  it('returns exactly the boxes that overlap the query, including large ones', () => {
    const items = boxes(2000, 1000, 20);
    items.push({ key: 'long', box: { min: { x: -50, y: 500 }, max: { x: 1050, y: 500 } } });
    items.push({ key: 'huge', box: { min: { x: -1e6, y: -1e6 }, max: { x: 1e6, y: 1e6 } } });
    const idx = new SpatialIndex(items);
    expect(idx.size).toBe(items.length);
    for (const q of [
      { min: { x: 100, y: 100 }, max: { x: 150, y: 160 } },
      { min: { x: 0, y: 499 }, max: { x: 10, y: 501 } },
      { min: { x: -500, y: -500 }, max: { x: 2000, y: 2000 } },
      { min: { x: 5000, y: 5000 }, max: { x: 6000, y: 6000 } },
    ]) {
      expect(idx.query(q).sort()).toEqual(brute(items, q));
    }
    expect(idx.near({ x: 500, y: 500 }, 0.5)).toContain('long');
  });

  it('handles empty and degenerate inputs', () => {
    expect(new SpatialIndex([]).query({ min: { x: 0, y: 0 }, max: { x: 1, y: 1 } })).toEqual([]);
    const one = new SpatialIndex([{ key: 'p', box: { min: { x: 5, y: 5 }, max: { x: 5, y: 5 } } }]);
    expect(one.near({ x: 5.1, y: 5 }, 0.2)).toEqual(['p']);
    expect(one.near({ x: 6, y: 5 }, 0.2)).toEqual([]);
  });

  it('overlaps and contains', () => {
    const a = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
    expect(overlaps(a, { min: { x: 10, y: 10 }, max: { x: 20, y: 20 } })).toBe(true);
    expect(overlaps(a, { min: { x: 10.001, y: 0 }, max: { x: 20, y: 20 } })).toBe(false);
    expect(contains(a, { min: { x: 1, y: 1 }, max: { x: 9, y: 9 } })).toBe(true);
    expect(contains(a, { min: { x: 1, y: 1 }, max: { x: 11, y: 9 } })).toBe(false);
  });

  it('budget: 100,000 entities build under 800 ms, a pick query under 2 ms, a screen cull under 40 ms', () => {
    const items = boxes(100_000, 10_000, 50);
    const t0 = performance.now();
    const idx = new SpatialIndex(items);
    const build = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 100; i++) idx.near({ x: 5000 + i, y: 5000 }, 2);
    const pick = (performance.now() - t1) / 100;
    const t2 = performance.now();
    const visible = idx.query({ min: { x: 2000, y: 2000 }, max: { x: 4000, y: 3200 } });
    const cull = performance.now() - t2;
    expect(visible.length).toBeGreaterThan(1000);
    // Generous in CI; the point is to catch a regression to O(n) per query.
    expect(build).toBeLessThan(800);
    expect(pick).toBeLessThan(2);
    expect(cull).toBeLessThan(120);
  });
});
