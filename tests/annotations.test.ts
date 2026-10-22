// Dimensions and symbols as primitives (ISO 129-1): measured values, text with tolerances, the
// geometry of the drawn parts, and the annotation scale.

import { describe, expect, it } from 'vitest';
import { annotationPrims, DEFAULT_DIM_STYLE, dimensionPrims, dimensionText, dimensionValue, type AnnotationCtx } from '@shared/draw/annotations';
import type { Prim } from '@shared/draw/primitives';
import { transformPrims } from '@shared/draw/primitives';
import { translation } from '@shared/geometry/transform';
import type { AnnotationEntity, DimensionEntity } from '@shared/doc/types';
import { dist } from '@shared/geometry/vec2';
import { entityBox, distToEntity } from '@shared/doc/document';

const ctx: AnnotationCtx = { style: { ...DEFAULT_DIM_STYLE } };
const lin = (over: Partial<DimensionEntity> = {}): DimensionEntity => ({ id: 'd', layer: 'dimensions', type: 'dimension', kind: 'linear', a: { x: 0, y: 0 }, b: { x: 80, y: 10 }, position: { x: 0, y: 30 }, rotation: 0, ...over });

const polylines = (prims: Prim[]) => prims.filter((p): p is Prim & { kind: 'polyline' } => p.kind === 'polyline');
const texts = (prims: Prim[]) => prims.filter((p): p is Prim & { kind: 'text' } => p.kind === 'text');
const polygons = (prims: Prim[]) => prims.filter((p): p is Prim & { kind: 'polygon' } => p.kind === 'polygon');

describe('dimension values', () => {
  it('linear projects on the direction, aligned measures the distance', () => {
    expect(dimensionValue(lin())).toBe(80);
    expect(dimensionValue(lin({ rotation: Math.PI / 2 }))).toBe(10);
    expect(dimensionValue(lin({ kind: 'aligned' }))).toBeCloseTo(Math.hypot(80, 10), 12);
  });
  it('angular is in degrees, counter-clockwise from a to b', () => {
    const d = lin({ kind: 'angular', center: { x: 0, y: 0 }, a: { x: 10, y: 0 }, b: { x: 0, y: 10 }, position: { x: 7, y: 7 } });
    expect(dimensionValue(d)).toBeCloseTo(90, 12);
  });
  it('radius and diameter from the centre and a point on the curve', () => {
    expect(dimensionValue(lin({ kind: 'radius', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }))).toBe(5);
    expect(dimensionValue(lin({ kind: 'diameter', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }))).toBe(10);
  });
  it('ordinate is signed along the axis', () => {
    expect(dimensionValue(lin({ kind: 'ordinate', a: { x: 10, y: 0 }, b: { x: 4, y: 9 }, rotation: 0 }))).toBe(-6);
  });
});

describe('dimension text', () => {
  it('uses the style decimals, trims trailing zeros, writes a comma on ISO drawings, adds ⌀ and R', () => {
    expect(dimensionText(lin(), ctx).main).toBe('80');
    expect(dimensionText(lin({ b: { x: 12.5, y: 0 } }), ctx).main).toBe('12,5');
    expect(dimensionText(lin({ b: { x: 12.3456, y: 0 } }), ctx).main).toBe('12,35');
    expect(dimensionText(lin({ b: { x: 12.5, y: 0 } }), { ...ctx, standard: 'asme' }).main).toBe('12.5');
    expect(dimensionText(lin({ kind: 'diameter', b: { x: 10, y: 0 } }), ctx).main).toBe('⌀20');
    expect(dimensionText(lin({ kind: 'radius', b: { x: 10, y: 0 } }), ctx).main).toBe('R10');
    expect(dimensionText(lin({ kind: 'angular', center: { x: 0, y: 0 }, a: { x: 1, y: 0 }, b: { x: 0, y: 1 } }), ctx).main).toBe('90°');
  });
  it('override text keeps the measured value through <>', () => {
    expect(dimensionText(lin({ text: '4× <>' }), ctx).main).toBe('4× 80');
    expect(dimensionText(lin({ prefix: '2× ', suffix: ' (ref)' }), ctx).main).toBe('2× 80 (ref)');
  });
  it('writes deviations with their signs, upper above lower (ISO 129-1)', () => {
    const t = dimensionText(lin({ tolerance: { kind: 'deviation', upper: 0.02, lower: -0.01 } }), ctx);
    expect(t.main).toBe('80');
    expect(t.upper).toBe('+0,02');
    expect(t.lower).toBe('−0,01');
    expect(dimensionText(lin({ tolerance: { kind: 'symmetric', value: 0.1 } }), ctx).main).toBe('80 ±0,10');
    const lim = dimensionText(lin({ tolerance: { kind: 'limits', upper: 80.02, lower: 79.98 } }), ctx);
    expect(lim.upper).toBe('80,02');
    expect(lim.lower).toBe('79,98');
  });
  it('writes a fit class after the value and the deviations from the library when known', () => {
    const noLib = dimensionText(lin({ kind: 'diameter', b: { x: 10, y: 0 }, tolerance: { kind: 'fit', cls: 'H7' } }), ctx);
    expect(noLib.main).toBe('⌀20 H7');
    expect(noLib.upper).toBeUndefined();
    const withLib = dimensionText(lin({ kind: 'diameter', b: { x: 10, y: 0 }, tolerance: { kind: 'fit', cls: 'H7' } }), { ...ctx, fit: (cls, nominal) => (cls === 'H7' && nominal === 20 ? { upper: 0.021, lower: 0 } : null) });
    expect(withLib.upper).toBe('+0,021');
    expect(withLib.lower).toBe('0,000');
  });
});

describe('dimension geometry', () => {
  it('a linear dimension has two extension lines, a dimension line through the position, two arrowheads and the text above', () => {
    const prims = dimensionPrims(lin({ b: { x: 80, y: 0 } }), ctx);
    const lines = polylines(prims);
    const dimLine = lines.find((l) => l.points.length === 2 && Math.abs(l.points[0].y - 30) < 1e-9 && Math.abs(l.points[1].y - 30) < 1e-9);
    expect(dimLine).toBeDefined();
    expect(Math.abs(dimLine!.points[1].x - dimLine!.points[0].x)).toBeCloseTo(80, 9);
    // Extension lines start at the points (no gap by default) and overshoot 8 × 0.25 = 2 mm past
    // the dimension line (ISO 129-1:2004, 5.4).
    const ext = lines.filter((l) => l !== dimLine);
    expect(ext.length).toBe(2);
    expect(Math.min(...ext.map((l) => l.points[0].y))).toBeCloseTo(0, 9);
    expect(Math.max(...ext.map((l) => l.points[1].y))).toBeCloseTo(32, 9);
    expect(polygons(prims).length).toBe(2);
    const t = texts(prims);
    expect(t.length).toBe(1);
    expect(t[0].text).toBe('80');
    expect(t[0].position.y).toBeGreaterThan(30);
  });
  it('arrowheads are 30° closed filled triangles of length h (ISO 129-1:2004, 5.3.2)', () => {
    const tri = polygons(dimensionPrims(lin({ b: { x: 80, y: 0 } }), ctx))[0];
    expect(tri.points.length).toBe(3);
    const len = dist(tri.points[0], { x: (tri.points[1].x + tri.points[2].x) / 2, y: (tri.points[1].y + tri.points[2].y) / 2 });
    expect(len).toBeCloseTo(3.5, 9);
    const half = dist(tri.points[1], tri.points[2]) / 2;
    expect(Math.atan(half / len) * 2).toBeCloseTo((30 * Math.PI) / 180, 9);
  });
  it('the annotation scale divides the paper sizes', () => {
    const half = { style: { ...DEFAULT_DIM_STYLE, annotationScale: 0.5 } };
    const t = texts(dimensionPrims(lin({ b: { x: 80, y: 0 } }), half))[0];
    expect(t.height).toBeCloseTo(7, 9);
    const tri = polygons(dimensionPrims(lin({ b: { x: 80, y: 0 } }), half))[0];
    expect(dist(tri.points[0], { x: (tri.points[1].x + tri.points[2].x) / 2, y: (tri.points[1].y + tri.points[2].y) / 2 })).toBeCloseTo(7, 9);
  });
  it('text reads from the bottom or the right: a dimension measured leftwards is not upside down', () => {
    const t = texts(dimensionPrims(lin({ rotation: Math.PI, b: { x: 80, y: 0 } }), ctx))[0];
    expect(t.rotation).toBeCloseTo(0, 9);
    const v = texts(dimensionPrims(lin({ rotation: -Math.PI / 2, a: { x: 0, y: 0 }, b: { x: 0, y: 50 }, position: { x: 20, y: 0 } }), ctx))[0];
    expect(v.rotation).toBeCloseTo(Math.PI / 2, 9);
  });
  it('an angular dimension draws an arc through the position', () => {
    const prims = dimensionPrims(lin({ kind: 'angular', center: { x: 0, y: 0 }, a: { x: 10, y: 0 }, b: { x: 0, y: 10 }, position: { x: 20, y: 0 } }), ctx);
    const arc = prims.find((p) => p.kind === 'arc');
    expect(arc && arc.kind === 'arc' && arc.radius).toBe(20);
    expect(texts(prims)[0].text).toBe('90°');
  });
  it('a radius dimension puts an arrowhead on the curve', () => {
    const prims = dimensionPrims(lin({ kind: 'radius', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, position: { x: 20, y: 15 } }), ctx);
    const tri = polygons(prims)[0];
    expect(dist(tri.points[0], { x: 0, y: 0 })).toBeCloseTo(10, 9);
    expect(texts(prims)[0].text).toBe('R10');
  });
});

describe('symbols', () => {
  it('balloon, surface, gdt and datum produce primitives around their position', () => {
    const items: AnnotationEntity[] = [
      { id: 'b', layer: '0', type: 'balloon', position: { x: 50, y: 50 }, text: '3', leader: { x: 10, y: 10 } },
      { id: 's', layer: '0', type: 'surface', position: { x: 0, y: 0 }, rotation: 0, removal: 'required', ra: 3.2 },
      { id: 'g', layer: '0', type: 'gdt', position: { x: 0, y: 0 }, rotation: 0, characteristic: 'flatness', tolerance: '0.05', datums: ['A'] },
      { id: 'n', layer: '0', type: 'note', position: { x: 0, y: 0 }, text: 'DEBURR\nALL EDGES', height: 3.5, rotation: 0, leader: [{ x: -20, y: -10 }] },
      { id: 'd', layer: '0', type: 'datum', position: { x: 0, y: 0 }, rotation: 0, label: 'A' },
    ];
    for (const e of items) {
      const prims = annotationPrims(e as Parameters<typeof annotationPrims>[0], ctx);
      expect(prims.length, e.type).toBeGreaterThan(0);
      const box = entityBox(e, ctx);
      expect(box.max.x).toBeGreaterThanOrEqual(box.min.x);
      // The entity is pickable at its position (within 2 mm).
      expect(distToEntity({ x: e.position.x + 0.5, y: e.position.y + 0.5 }, e, ctx)).toBeLessThan(5);
    }
    const g = annotationPrims(items[2] as Parameters<typeof annotationPrims>[0], ctx);
    // The characteristic symbol is drawn with lines (fonts rarely have ISO 1101 glyphs); the text compartments remain.
    expect(texts(g).map((t) => t.text)).toEqual(['0.05', 'A']);
    expect(g.some((p) => p.kind === 'polyline' && p.closed && p.points.length === 4)).toBe(true);
    expect(texts(annotationPrims(items[3] as Parameters<typeof annotationPrims>[0], ctx)).length).toBe(2);
    expect(texts(annotationPrims(items[1] as Parameters<typeof annotationPrims>[0], ctx))[0].text).toBe('Ra 3.2');
  });
});

describe('transformPrims', () => {
  it('moves every primitive kind', () => {
    const prims = dimensionPrims(lin({ b: { x: 80, y: 0 } }), ctx);
    const moved = transformPrims(prims, translation(5, 7));
    const t0 = texts(prims)[0];
    const t1 = texts(moved)[0];
    expect(t1.position.x - t0.position.x).toBeCloseTo(5, 12);
    expect(t1.position.y - t0.position.y).toBeCloseTo(7, 12);
    expect(t1.height).toBe(t0.height);
  });
});
