// The 3D kernel with the real engine (replicad on opencascade.js, WebAssembly): the feature tree,
// mass properties, exports and their round trips, sections and projections. The engine is large
// (about 23 MB) and is loaded once for the whole file.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawRectangle, isShape3D, makePlane, measureVolume, setOC } from 'replicad';
import { newDocument } from '@shared/doc/document';
import type { Document, Entity, Feature, Part, SketchPlane } from '@shared/doc/types';
import { createKernel, type Kernel } from '@shared/cad/kernel';
import { buildPart, clearBuildCache, crc32, holeDiameter, VIEW_CAMERAS } from '@shared/cad/build';
import { planeFrame, toWorld } from '@shared/cad/profile';
import type { BuildResult } from '@shared/cad/protocol';

// The first STEP read and write load OpenCascade's STEP modules (about 1 s each, more when the
// whole suite runs in parallel).
vi.setConfig({ testTimeout: 30_000 });

let kernel: Kernel;

beforeAll(async () => {
  const t0 = performance.now();
  kernel = await createKernel();
  console.log(`[cad-build] engine loaded in ${Math.round(performance.now() - t0)} ms`);
}, 120_000);
afterAll(() => kernel?.dispose());

/* ---------- documents ---------- */

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Entity => ({
  id,
  type: 'polyline',
  layer: '0',
  closed: true,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
});
const circle = (id: string, x: number, y: number, r: number): Entity => ({ id, type: 'circle', layer: '0', center: { x, y }, radius: r });
const line = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, type: 'line', layer: '0', a: { x: ax, y: ay }, b: { x: bx, y: by } });

function docOf(entities: Entity[], features: Feature[], partId = 'p1'): Document {
  const d = newDocument('Test');
  const part: Part = { id: partId, name: 'Bracket', features };
  return { ...d, entities: Object.fromEntries(entities.map((e) => [e.id, e])), entityOrder: entities.map((e) => e.id), parts: { [partId]: part }, partOrder: [partId] };
}

const sketch = (id: string, entities: string[], plane: SketchPlane = 'XY', offset = 0): Feature => ({ id, name: id, kind: 'sketch', plane, offset, entities });
const extrude = (id: string, sk: string, distance: number, extra: Partial<Extract<Feature, { kind: 'extrude' }>> = {}): Feature => ({ id, name: id, kind: 'extrude', sketch: sk, distance, direction: 'normal', op: 'add', ...extra });

/** A 100 × 60 × 10 plate from the origin. */
const PLATE_ENTITIES: Entity[] = [rect('r', 0, 0, 100, 60)];
const PLATE: Feature[] = [sketch('s1', ['r']), extrude('e1', 's1', 10)];
const HOLE_CENTRES: [number, number][] = [
  [10, 10],
  [90, 10],
  [10, 50],
  [90, 50],
];
/** The plate with four M8 clearance holes (ISO 273, medium) drilled from the top face. */
function bracket(): Document {
  return docOf(
    [...PLATE_ENTITIES, ...HOLE_CENTRES.map(([x, y], i) => circle(`c${i}`, x, y, 4.5))],
    [...PLATE, sketch('s2', ['c0', 'c1', 'c2', 'c3'], 'XY', 10), { id: 'h1', name: 'Holes', kind: 'hole', sketch: 's2', spec: { kind: 'clearance', thread: 'M8', series: 'medium' }, depth: 'through' }],
  );
}

const build = (doc: Document, partId = 'p1') => kernel.build(doc, partId);
const vol = (r: BuildResult) => r.properties?.volume ?? NaN;

/* ---------- planes ---------- */

describe('sketch planes', () => {
  it('extrudes a 10 × 20 rectangle on XY, XZ and YZ along each plane normal', async () => {
    const expected: Record<SketchPlane, { min: number[]; max: number[] }> = {
      XY: { min: [0, 0, 0], max: [10, 20, 5] },
      // XZ: sketch x → X, sketch y → Z, normal −Y.
      XZ: { min: [0, -5, 0], max: [10, 0, 20] },
      YZ: { min: [0, 0, 0], max: [5, 10, 20] },
    };
    for (const plane of ['XY', 'XZ', 'YZ'] as const) {
      const r = await build(docOf([rect('r', 0, 0, 10, 20)], [sketch('s', ['r'], plane), extrude('e', 's', 5)]));
      expect(r.errors).toEqual([]);
      const bb = r.properties?.bbox;
      bb?.min.forEach((v, i) => expect(v).toBeCloseTo(expected[plane].min[i], 9));
      bb?.max.forEach((v, i) => expect(v).toBeCloseTo(expected[plane].max[i], 9));
      expect(vol(r)).toBeCloseTo(1000, 9);
    }
  });

  it('agrees with replicad: makePlane(name, offset) has the same origin, x direction and normal', async () => {
    for (const plane of ['XY', 'XZ', 'YZ'] as const) {
      const f = planeFrame(plane, 7);
      const p = makePlane(plane, 7);
      expect(p.origin.toTuple().map((v) => v + 0)).toEqual(f.origin.map((v) => v + 0));
      expect(p.xDir.toTuple().map((v) => v + 0)).toEqual(f.x.map((v) => v + 0));
      expect(p.zDir.toTuple().map((v) => v + 0)).toEqual(f.normal.map((v) => v + 0));
      // A drawing placed by replicad lands where the pure mapping says.
      const solid = drawRectangle(10, 20).translate(5, 10).sketchOnPlane(plane, 7).extrude(1);
      const [min, max] = solid.boundingBox.bounds;
      const a = toWorld(f, { x: 0, y: 0 });
      const b = toWorld(f, { x: 10, y: 20 });
      for (let i = 0; i < 3; i++) {
        expect(Math.min(min[i], max[i])).toBeCloseTo(Math.min(a[i], b[i], a[i] + f.normal[i]), 6);
        expect(Math.max(min[i], max[i])).toBeCloseTo(Math.max(a[i], b[i], a[i] + f.normal[i]), 6);
      }
      if (!isShape3D(solid)) throw new Error('a solid expected');
      expect(measureVolume(solid)).toBeCloseTo(200, 9);
    }
  });

  it('extrudes in reverse and on both sides of the plane', async () => {
    const rev = await build(docOf(PLATE_ENTITIES, [sketch('s1', ['r']), extrude('e1', 's1', 10, { direction: 'reverse' })]));
    expect(rev.properties?.bbox.min[2]).toBeCloseTo(-10, 9);
    expect(rev.properties?.bbox.max[2]).toBeCloseTo(0, 9);
    const both = await build(docOf(PLATE_ENTITIES, [sketch('s1', ['r']), extrude('e1', 's1', 10, { direction: 'both' })]));
    expect(both.properties?.bbox.min[2]).toBeCloseTo(-5, 9);
    expect(both.properties?.bbox.max[2]).toBeCloseTo(5, 9);
    expect(vol(both)).toBeCloseTo(60000, 6);
  });
});

/* ---------- features ---------- */

describe('feature tree', () => {
  it('extrudes a 100 × 60 rectangle by 10: volume 60000 mm³, bounding box, area, centre of mass', async () => {
    const r = await build(docOf(PLATE_ENTITIES, PLATE));
    expect(r.status).toEqual({ s1: 'ok', e1: 'ok' });
    expect(Math.abs(vol(r) - 60000)).toBeLessThanOrEqual(1e-6);
    expect(r.properties?.bbox).toEqual({ min: [0, 0, 0], max: [100, 60, 10] });
    expect(r.properties?.area).toBeCloseTo(2 * (6000 + 1000 + 600), 6);
    r.properties?.centerOfMass.forEach((v, i) => expect(v).toBeCloseTo([50, 30, 5][i], 9));
    // The mesh: one face id per triangle, six faces, edges as segment pairs.
    const m = r.mesh;
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.indices.length % 3).toBe(0);
    expect(m.faceIds.length).toBe(m.indices.length / 3);
    expect(new Set(m.faceIds).size).toBe(6);
    expect(m.positions.length).toBe(m.normals.length);
    expect(m.edges.length % 6).toBe(0);
    expect(m.edges.length / 6).toBe(12); // twelve straight edges, one segment each
  });

  it('extrudes a profile with holes and with arcs', async () => {
    const r = await build(docOf([rect('r', 0, 0, 100, 60), circle('c', 50, 30, 10)], [sketch('s1', ['r', 'c']), extrude('e1', 's1', 10)]));
    expect(vol(r)).toBeCloseTo(60000 - Math.PI * 100 * 10, 6);
  });

  it('drills four ISO 273 M8 clearance holes (medium, Ø9) through the plate', async () => {
    expect(holeDiameter({ kind: 'clearance', thread: 'M8', series: 'medium' })).toBe(9);
    const r = await build(bracket());
    expect(r.errors).toEqual([]);
    expect(r.status.h1).toBe('ok');
    expect(Math.abs(vol(r) - (60000 - 4 * Math.PI * 4.5 ** 2 * 10))).toBeLessThanOrEqual(1e-6);
  });

  it('drills blind holes to a depth and tapped holes from the tap-drill table', async () => {
    const d = bracket();
    const blind = structuredClone(d);
    const h = blind.parts.p1.features[3];
    if (h.kind === 'hole') h.depth = 4;
    const rb = await build(blind);
    expect(vol(rb)).toBeCloseTo(60000 - 4 * Math.PI * 4.5 ** 2 * 4, 6);
    const tapped = structuredClone(d);
    const t2 = tapped.parts.p1.features[3];
    if (t2.kind === 'hole') t2.spec = { kind: 'tapped', thread: 'M8' };
    const drill = holeDiameter({ kind: 'tapped', thread: 'M8' });
    const rt = await build(tapped);
    expect(rt.errors).toEqual([]);
    expect(vol(rt)).toBeCloseTo(60000 - 4 * Math.PI * (drill / 2) ** 2 * 10, 6);
  });

  it('names the threads the library has when the thread is unknown', async () => {
    const d = bracket();
    const h = d.parts.p1.features[3];
    if (h.kind === 'hole') h.spec = { kind: 'clearance', thread: 'M7.5', series: 'medium' };
    const r = await build(d);
    expect(r.status.h1).toBe('failed');
    expect(r.errors[0].message).toMatch(/^The library has no clearance hole for the thread 'M7\.5'\. Threads in the library: .*M8/);
    expect(vol(r)).toBeCloseTo(60000, 6); // the plate is still there
  });

  it('says so when the holes are drilled away from the body', async () => {
    const d = bracket();
    const s2 = d.parts.p1.features[2];
    if (s2.kind === 'sketch') s2.offset = 0; // the bottom face: drilling −Z goes out of the plate
    const r = await build(d);
    expect(r.status.h1).toBe('failed');
    expect(r.errors[0].message).toBe("The holes of 'Holes' do not touch the body: they are drilled along −Z from the sketch plane at 0 mm.");
  });

  it('revolves a stepped profile around the x axis: π·(15²·20 + 10²·10)', async () => {
    const shaft: Entity = {
      id: 'p',
      type: 'polyline',
      layer: '0',
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 15 },
        { x: 0, y: 15 },
      ],
    };
    const r = await build(docOf([shaft], [sketch('s', ['p']), { id: 'rv', name: 'Shaft', kind: 'revolve', sketch: 's', axis: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, angle: 360, op: 'add' }]));
    expect(r.errors).toEqual([]);
    expect(Math.abs(vol(r) - Math.PI * (15 ** 2 * 20 + 10 ** 2 * 10))).toBeLessThanOrEqual(1e-3);
    // A quarter turn is a quarter of the volume.
    const q = await build(docOf([shaft], [sketch('s', ['p']), { id: 'rv', name: 'Shaft', kind: 'revolve', sketch: 's', axis: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, angle: 90, op: 'add' }]));
    expect(vol(q)).toBeCloseTo((Math.PI * (15 ** 2 * 20 + 10 ** 2 * 10)) / 4, 3);
  });

  it('refuses a revolve whose profile crosses the axis', async () => {
    const r = await build(docOf([rect('r', 0, -5, 30, 15)], [sketch('s', ['r']), { id: 'rv', name: 'Shaft', kind: 'revolve', sketch: 's', axis: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, angle: 360, op: 'add' }]));
    expect(r.status.rv).toBe('failed');
    expect(r.errors[0].message).toBe("The profile of 'Shaft' crosses the axis of revolution.");
    expect(r.mesh).toBeNull();
  });

  it('fillets the vertical edges of a box: the volume drops by 4·(1 − π/4)·r²·h', async () => {
    const radius = 5;
    const r = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'f', name: 'Fillet', kind: 'fillet', edges: { kind: 'parallelTo', axis: 'Z' }, radius }]));
    expect(r.errors).toEqual([]);
    expect(vol(r)).toBeCloseTo(60000 - 4 * (1 - Math.PI / 4) * radius ** 2 * 10, 6);
  });

  it('chamfers the vertical edges: the volume drops by 4·d²/2·h', async () => {
    const d = 4;
    const r = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'c', name: 'Chamfer', kind: 'chamfer', edges: { kind: 'parallelTo', axis: 'Z' }, distance: d }]));
    expect(r.errors).toEqual([]);
    expect(vol(r)).toBeCloseTo(60000 - 4 * ((d * d) / 2) * 10, 6);
  });

  it('selects edges in a plane, by length and in a box', async () => {
    const top = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'c', name: 'Chamfer', kind: 'chamfer', edges: { kind: 'inPlane', plane: 'XY', offset: 10 }, distance: 1 }]));
    // Four top edges chamfered 1 × 1: prisms along the perimeter, minus the corner overlaps.
    expect(top.errors).toEqual([]);
    expect(vol(top)).toBeLessThan(60000);
    const byLength = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'c', name: 'Chamfer', kind: 'chamfer', edges: { kind: 'ofLength', length: 10 }, distance: 4 }]));
    expect(vol(byLength)).toBeCloseTo(60000 - 4 * 8 * 10, 6); // the four vertical edges are the 10 mm ones
    const inBox = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'c', name: 'Chamfer', kind: 'chamfer', edges: { kind: 'inBox', min: [-1, -1, -1], max: [1, 1, 11] }, distance: 4 }]));
    expect(vol(inBox)).toBeCloseTo(60000 - 8 * 10, 6); // only the vertical edge at the origin lies fully inside
  });

  it('reports a fillet that does not fit, and keeps the body', async () => {
    const r = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'f', name: 'Fillet', kind: 'fillet', edges: { kind: 'all' }, radius: 50 }]));
    expect(r.status.f).toBe('failed');
    expect(r.errors).toEqual([{ feature: 'f', message: 'The fillet of 50 mm does not fit on these edges; try a smaller radius or fewer edges.', hint: undefined }]);
    expect(Math.abs(vol(r) - 60000)).toBeLessThanOrEqual(1e-6);
    expect(r.mesh).not.toBeNull();
  });

  it('shells a box with the top face removed: outer − inner volume', async () => {
    const th = 2;
    const r = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'sh', name: 'Shell', kind: 'shell', thickness: th, faces: [{ kind: 'normal', direction: 'Z+' }] }]));
    expect(r.errors).toEqual([]);
    expect(vol(r)).toBeCloseTo(60000 - (100 - 2 * th) * (60 - 2 * th) * (10 - th), 6);
  });

  it('shells a box closed (no face removed): a hollow inside', async () => {
    const th = 2;
    const r = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'sh', name: 'Shell', kind: 'shell', thickness: th, faces: [] }]));
    expect(r.errors).toEqual([]);
    expect(vol(r)).toBeCloseTo(60000 - (100 - 2 * th) * (60 - 2 * th) * (10 - 2 * th), 6);
  });

  it('mirrors the body and fuses both halves', async () => {
    const r = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'm', name: 'Mirror', kind: 'mirror', plane: 'YZ', offset: 0 }]));
    expect(vol(r)).toBeCloseTo(120000, 6);
    expect(r.properties?.bbox.min[0]).toBeCloseTo(-100, 9);
    // Across a plane through the middle: the halves overlap completely.
    const mid = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'm', name: 'Mirror', kind: 'mirror', plane: 'YZ', offset: 50 }]));
    expect(vol(mid)).toBeCloseTo(60000, 6);
  });

  it('repeats the body in a grid and around an axis', async () => {
    const grid = await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'pt', name: 'Grid', kind: 'pattern', mode: 'linear', counts: [3, 2], spacing: [150, 100], axes: ['X', 'Y'] }]));
    expect(vol(grid)).toBeCloseTo(6 * 60000, 5);
    const lug: Entity[] = [rect('r', 50, -5, 70, 5)];
    const ring = await build(docOf(lug, [sketch('s', ['r']), extrude('e', 's', 10), { id: 'pt', name: 'Ring', kind: 'pattern', mode: 'circular', axis: 'Z', count: 6, angle: 360 }]));
    expect(vol(ring)).toBeCloseTo(6 * 2000, 6);
    expect(ring.properties?.centerOfMass[0]).toBeCloseTo(0, 6);
    const arc = await build(docOf(lug, [sketch('s', ['r']), extrude('e', 's', 10), { id: 'pt', name: 'Arc', kind: 'pattern', mode: 'circular', axis: 'Z', count: 3, angle: 90 }]));
    expect(vol(arc)).toBeCloseTo(3 * 2000, 6);
    expect(arc.properties?.bbox.max[1]).toBeCloseTo(70, 6); // the last copy sits at 90°
  });

  it('cuts with an extrude, and says so when the cut misses', async () => {
    const pocket = await build(docOf([...PLATE_ENTITIES, rect('q', 20, 20, 40, 40)], [...PLATE, sketch('s2', ['q'], 'XY', 10), extrude('cut', 's2', 3, { direction: 'reverse', op: 'cut' })]));
    expect(vol(pocket)).toBeCloseTo(60000 - 20 * 20 * 3, 6);
    const miss = await build(docOf([...PLATE_ENTITIES, rect('q', 200, 20, 240, 40)], [...PLATE, sketch('s2', ['q'], 'XY', 10), extrude('cut', 's2', 3, { direction: 'reverse', op: 'cut' })]));
    expect(miss.status.cut).toBe('failed');
    expect(miss.errors[0].message).toBe("The cut 'cut' does not touch the body.");
  });

  it('skips suppressed features and the features of a failed sketch', async () => {
    const r = await build(docOf([...PLATE_ENTITIES, line('l1', 0, 0, 10, 0), line('l2', 10, 0, 10, 10)], [...PLATE, { id: 'f', name: 'Fillet', kind: 'fillet', edges: { kind: 'all' }, radius: 1, suppressed: true }, sketch('open', ['l1', 'l2']), extrude('e2', 'open', 5)]));
    expect(r.status).toEqual({ s1: 'ok', e1: 'ok', f: 'skipped', open: 'failed', e2: 'skipped' });
    expect(r.errors.map((e) => e.feature)).toEqual(['open']);
    expect(r.errors[0].message).toBe("The sketch 'open' is not closed: the start of line l1 at (0, 0) meets nothing.");
    expect(vol(r)).toBeCloseTo(60000, 6);
  });

  it('builds ellipse arcs and splines exactly (no flattening)', async () => {
    // Half an ellipse closed by its major axis: π·a·b/2 × height.
    const half = await build(docOf([{ id: 'el', type: 'ellipse', layer: '0', center: { x: 0, y: 0 }, major: { x: 30, y: 0 }, ratio: 0.5, start: 0, end: Math.PI }, line('l', -30, 0, 30, 0)], [sketch('s', ['el', 'l']), extrude('e', 's', 2)]));
    expect(half.errors).toEqual([]);
    expect(vol(half)).toBeCloseTo(((Math.PI * 30 * 15) / 2) * 2, 6);
    // A full rotated ellipse.
    const full = await build(docOf([{ id: 'el', type: 'ellipse', layer: '0', center: { x: 5, y: 5 }, major: { x: 12, y: 16 }, ratio: 0.25, start: 0, end: 2 * Math.PI }], [sketch('s', ['el']), extrude('e', 's', 1)]));
    expect(vol(full)).toBeCloseTo(Math.PI * 20 * 5, 6);
    expect(full.properties?.centerOfMass[0]).toBeCloseTo(5, 6);
    // A cubic spline over a chord: area = (3/20)·… for a Bézier; compare with the exact Bézier area
    // ∫ y dx = (Δx-weighted) by Green's formula on its control points (degree 3).
    const cps = [
      { x: 0, y: 0 },
      { x: 10, y: 30 },
      { x: 40, y: 30 },
      { x: 50, y: 0 },
    ];
    const spl = await build(docOf([{ id: 'sp', type: 'spline', layer: '0', degree: 3, controlPoints: cps, knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false }, line('l', 50, 0, 0, 0)], [sketch('s', ['sp', 'l']), extrude('e', 's', 1)]));
    expect(spl.errors).toEqual([]);
    expect(vol(spl)).toBeCloseTo(bezierArea(cps), 6);
  });

  it('imports a STEP file kept in the document as the base body', async () => {
    const text = await kernel.exportStep(bracket(), 'p1');
    const data = Buffer.from(text, 'utf8').toString('base64');
    const r = await build(docOf([], [{ id: 'i', name: 'Imported', kind: 'import', format: 'step', data, sourceName: 'bracket.step' }]));
    expect(r.status.i).toBe('ok');
    expect(vol(r)).toBeCloseTo(60000 - 4 * Math.PI * 4.5 ** 2 * 10, 6);
    const bad = await build(docOf([], [{ id: 'i', name: 'Imported', kind: 'import', format: 'step', data: Buffer.from('not a step file').toString('base64'), sourceName: 'junk.step' }]));
    expect(bad.status.i).toBe('failed');
    expect(bad.errors[0].message).toBe("The STEP file 'junk.step' could not be read.");
  });
});

/** Exact area under a cubic Bézier closed by its chord (Green's theorem on the polynomial). */
function bezierArea(p: { x: number; y: number }[]): number {
  // Integrate x dy − y dx over the curve numerically with high-order Gauss–Legendre: exact for polynomials of degree ≤ 9.
  const xs = [-0.9681602395076261, -0.8360311073266358, -0.6133714327005904, -0.3242534234038089, 0, 0.3242534234038089, 0.6133714327005904, 0.8360311073266358, 0.9681602395076261];
  const ws = [0.0812743883615744, 0.1806481606948574, 0.2606106964029354, 0.3123470770400029, 0.3302393550012598, 0.3123470770400029, 0.2606106964029354, 0.1806481606948574, 0.0812743883615744];
  const pt = (u: number) => {
    const a = (1 - u) ** 3;
    const b = 3 * u * (1 - u) ** 2;
    const c = 3 * u * u * (1 - u);
    const d = u ** 3;
    return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
  };
  const der = (u: number) => {
    const a = -3 * (1 - u) ** 2;
    const b = 3 * (1 - u) ** 2 - 6 * u * (1 - u);
    const c = 6 * u * (1 - u) - 3 * u * u;
    const d = 3 * u * u;
    return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
  };
  let s = 0;
  xs.forEach((x, i) => {
    const u = (x + 1) / 2;
    const q = pt(u);
    const dq = der(u);
    s += (ws[i] / 2) * (q.x * dq.y - q.y * dq.x);
  });
  // The chord from the end back to the start passes through the origin line y = 0: it adds nothing.
  return Math.abs(s / 2);
}

/* ---------- exports and round trips (product rule 1) ---------- */

describe('exports', () => {
  it('writes STEP and reads it back with the same volume', async () => {
    const text = await kernel.exportStep(bracket(), 'p1');
    expect(text.startsWith('ISO-10303-21')).toBe(true);
    expect(text).toMatch(/MILLI/); // SI unit prefix of the length unit: millimetres
    expect(text).toMatch(/PRODUCT\('Bracket'/); // the part's name
    const back = await kernel.importStep(text, 'bracket.step');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(Math.abs(back.properties.volume - (60000 - 4 * Math.PI * 4.5 ** 2 * 10))).toBeLessThanOrEqual(1e-6);
    expect(back.properties.bbox).toEqual({ min: [0, 0, 0], max: [100, 60, 10] });
    const bad = await kernel.importStep('hello', 'x.step');
    expect(bad).toEqual({ ok: false, message: "The STEP file 'x.step' could not be read: it has no solid that OpenCascade can open." });
  });

  it('writes binary STL: 84 + 50·n bytes, and ASCII STL', async () => {
    const data = await kernel.exportStl(bracket(), 'p1', true);
    const n = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
    expect(n).toBeGreaterThan(12);
    expect(data.length).toBe(84 + 50 * n);
    const ascii = new TextDecoder().decode(await kernel.exportStl(bracket(), 'p1', false));
    expect(ascii.startsWith('solid Bracket')).toBe(true);
    expect(ascii.match(/facet normal/g)?.length).toBe(n);
  });

  it('writes a 3MF package: a stored ZIP with a valid central directory and the mesh in millimetres', async () => {
    const zip = await kernel.export3mf(bracket(), 'p1');
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    for (const e of entries) expect(crc32(e.data)).toBe(e.crc);
    const model = new TextDecoder().decode(entries[2].data);
    expect(model).toContain('<vertices>');
    expect(model).toContain('unit="millimeter"');
    const stl = await kernel.exportStl(bracket(), 'p1', true);
    const n = new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
    expect(model.match(/<triangle /g)?.length).toBe(n);
    // Welded: every vertex index used by a triangle exists.
    const vertexCount = model.match(/<vertex /g)?.length ?? 0;
    const maxIndex = Math.max(...[...model.matchAll(/v[123]="(\d+)"/g)].map((m) => Number(m[1])));
    expect(maxIndex).toBeLessThan(vertexCount);
    expect(vertexCount).toBeLessThan(3 * n);
  });
});

/** Read a stored ZIP through its central directory (APPNOTE 4.3.12, 4.3.16). */
function readZip(zip: Uint8Array): { name: string; crc: number; data: Uint8Array }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; crc: number; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint16(local + 8, true)).toBe(0); // stored
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, crc, data: zip.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

/* ---------- sections and projections ---------- */

describe('sections', () => {
  it('cuts the bracket with the XY plane at 5 mm: one outer loop and four holes', async () => {
    const s = await kernel.section(bracket(), 'p1', 'XY', 5);
    expect(s.loops).toHaveLength(5);
    const sizes = s.loops.map((l) => {
      const xs = l.map((p) => p.x);
      const ys = l.map((p) => p.y);
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    });
    const big = sizes.filter(([w]) => w > 50);
    expect(big).toHaveLength(1);
    expect(big[0][0]).toBeCloseTo(100, 9);
    expect(big[0][1]).toBeCloseTo(60, 9);
    // The four holes: every point at 4.5 mm from one of the centres.
    const holes = s.loops.filter((_, i) => sizes[i][0] < 50);
    expect(holes).toHaveLength(4);
    for (const l of holes) {
      const c = HOLE_CENTRES.find(([x, y]) => Math.hypot(l[0].x - x, l[0].y - y) < 5);
      expect(c).toBeDefined();
      if (c) for (const p of l) expect(Math.hypot(p.x - c[0], p.y - c[1])).toBeCloseTo(4.5, 6);
    }
    // 3D points lie on the plane.
    for (const l of s.loops3d) for (const p of l) expect(p[2]).toBeCloseTo(5, 9);
  });
});

describe('projections for drawing views (ISO 5456-2, first angle)', () => {
  const bounds = (lines: { x: number; y: number }[][]) => {
    const pts = lines.flat();
    return { x: [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))], y: [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))] };
  };
  const boxWithHole = () => docOf([rect('r', 0, 0, 100, 60), circle('c', 30, 20, 5)], [sketch('s1', ['r', 'c']), extrude('e1', 's1', 10)]);

  it('front view: X across, Z up; the hole is hidden', async () => {
    const v = await kernel.project(boxWithHole(), 'p1', 'front');
    expect(v.visible.length).toBeGreaterThanOrEqual(4);
    expect(v.hidden.length).toBeGreaterThan(0);
    const b = bounds(v.visible);
    b.x.forEach((x, i) => expect(x).toBeCloseTo([0, 100][i], 6));
    b.y.forEach((y, i) => expect(y).toBeCloseTo([0, 10][i], 6));
    // The hole's sides are hidden vertical lines at x = 25 and x = 35, from z = 0 to z = 10.
    const vertical = v.hidden.filter((l) => l.every((p) => Math.abs(p.x - l[0].x) < 1e-9) && Math.abs(l[0].y - l[l.length - 1].y) > 1);
    expect(vertical.map((l) => Math.round(l[0].x * 1e6) / 1e6).sort((a, c) => a - c)).toEqual([25, 35]);
    for (const l of vertical) expect(bounds([l]).y).toEqual([0, 10]);
  });

  it('top view: X across, Y up; the hole is a visible circle', async () => {
    const v = await kernel.project(boxWithHole(), 'p1', 'top');
    const b = bounds(v.visible);
    b.x.forEach((x, i) => expect(x).toBeCloseTo([0, 100][i], 6));
    b.y.forEach((y, i) => expect(y).toBeCloseTo([0, 60][i], 6));
    const onCircle = v.visible.filter((l) => l.every((p) => Math.abs(Math.hypot(p.x - 30, p.y - 20) - 5) < 1e-6));
    expect(onCircle.length).toBeGreaterThan(0);
  });

  it('the other views follow the camera table', async () => {
    const expected: Record<string, { x: number[]; y: number[] }> = {
      right: { x: [0, 60], y: [0, 10] },
      left: { x: [-60, 0], y: [0, 10] },
      back: { x: [-100, 0], y: [0, 10] },
      bottom: { x: [0, 100], y: [-60, 0] },
    };
    for (const dir of ['right', 'left', 'back', 'bottom'] as const) {
      const v = await kernel.project(boxWithHole(), 'p1', dir);
      const b = bounds(v.visible);
      b.x.forEach((x, i) => expect(x).toBeCloseTo(expected[dir].x[i], 6));
      b.y.forEach((y, i) => expect(y).toBeCloseTo(expected[dir].y[i], 6));
    }
    const iso = await kernel.project(boxWithHole(), 'p1', 'iso');
    expect(iso.visible.length).toBeGreaterThan(6);
    // Every camera is right-handed: x × up = toward the viewer.
    for (const cam of Object.values(VIEW_CAMERAS)) {
      const n = cam.toViewer;
      const x = cam.x;
      const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
      expect(Math.hypot(...y)).toBeCloseTo(1, 12);
    }
  });
});

/* ---------- performance budget (product rule 8) ---------- */

describe('performance', () => {
  it('builds the bracket with holes in under 3 s, and again in under 1 s', async () => {
    clearBuildCache();
    const d = bracket();
    let t0 = performance.now();
    const first = await build(d);
    const firstMs = performance.now() - t0;
    t0 = performance.now();
    const again = await build(d);
    const againMs = performance.now() - t0;
    // A change in the last feature: the plate is reused, only the holes are drilled again.
    const changed = structuredClone(d);
    const h = changed.parts.p1.features[3];
    if (h.kind === 'hole') h.depth = 5;
    t0 = performance.now();
    const edited = await build(changed);
    const editedMs = performance.now() - t0;
    // No cache at all, warm engine.
    t0 = performance.now();
    buildPart(d, 'p1', undefined, { cache: false });
    const uncachedMs = performance.now() - t0;
    console.log(`[cad-build] bracket: first ${firstMs.toFixed(1)} ms, again ${againMs.toFixed(1)} ms, last feature edited ${editedMs.toFixed(1)} ms, uncached ${uncachedMs.toFixed(1)} ms`);
    expect(first.errors).toEqual([]);
    expect(vol(again)).toBe(vol(first));
    expect(vol(edited)).toBeCloseTo(60000 - 4 * Math.PI * 4.5 ** 2 * 5, 6);
    expect(firstMs).toBeLessThan(3000);
    expect(againMs).toBeLessThan(1000);
    expect(uncachedMs).toBeLessThan(1000);
  });
});

describe('kernel', () => {
  it('stays healthy after feature errors', async () => {
    await build(docOf(PLATE_ENTITIES, [...PLATE, { id: 'f', name: 'Fillet', kind: 'fillet', edges: { kind: 'all' }, radius: 500 }]));
    expect(kernel.healthy).toBe(true);
    setOC(undefined as never); // a stray caller cannot break the kernel: every call sets its engine again
    const r = await build(docOf(PLATE_ENTITIES, PLATE));
    expect(vol(r)).toBeCloseTo(60000, 6);
  });
});
