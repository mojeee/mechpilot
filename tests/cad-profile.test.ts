// Sketch profiles for the 3D kernel (shared/cad/profile.ts): pure, no WebAssembly.

import { describe, expect, it } from 'vitest';
import type { Entity, LineEntity } from '@shared/doc/types';
import { clampedKnots, splinePoint } from '@shared/geometry/flatten';
import {
  bezierPoint,
  buildProfile,
  chainPolylines,
  crossesAxis,
  holePoints,
  penSteps,
  planeFrame,
  signedArea,
  splineToBeziers,
  toPlane,
  toWorld,
  type ProfileResult,
} from '@shared/cad/profile';

const L = (id: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({ id, type: 'line', layer: '0', a: { x: ax, y: ay }, b: { x: bx, y: by } });
const C = (id: string, x: number, y: number, r: number): Entity => ({ id, type: 'circle', layer: '0', center: { x, y }, radius: r });
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
const docOf = (entities: Entity[]) => ({ entities: Object.fromEntries(entities.map((e) => [e.id, e])) });
const profile = (entities: Entity[], name = 'Base'): ProfileResult => buildProfile(docOf(entities), { name, entities: entities.map((e) => e.id) });
const okProfile = (r: ProfileResult) => {
  if (!r.ok) throw new Error(r.error.message);
  return r.profile;
};

describe('chaining loops', () => {
  it('chains lines given in any order and direction into one loop', () => {
    // A 100 × 60 rectangle: the lines are shuffled and two run backwards.
    const p = okProfile(profile([L('e3', 100, 60, 0, 60), L('e1', 0, 0, 100, 0), L('e4', 0, 0, 0, 60), L('e2', 100, 60, 100, 0)]));
    expect(p.loops).toHaveLength(1);
    expect(p.regions).toHaveLength(1);
    expect(Math.abs(p.regions[0].outer.area)).toBeCloseTo(6000, 9);
    expect(p.regions[0].outer.entities.slice().sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('joins end points that are within 1e-6 mm, and snaps them so the loop closes exactly', () => {
    const p = okProfile(profile([L('a', 0, 0, 10, 0), L('b', 10 + 4e-7, 0, 10, 10), L('c', 10, 10, 0, 1e-7)]));
    const seg = p.loops[0].shape;
    expect(seg.kind).toBe('path');
    if (seg.kind !== 'path') return;
    const first = seg.segments[0].a;
    const last = seg.segments[seg.segments.length - 1].b;
    expect(last).toEqual(first);
    for (let i = 1; i < seg.segments.length; i++) expect(seg.segments[i].a).toEqual(seg.segments[i - 1].b);
  });

  it('finds the outer loop and the holes inside it', () => {
    const p = okProfile(profile([C('h1', 10, 10, 4.5), rect('r', 0, 0, 100, 60), C('h2', 90, 10, 4.5), C('h3', 10, 50, 4.5), C('h4', 90, 50, 4.5)]));
    expect(p.regions).toHaveLength(1);
    expect(p.regions[0].outer.entities).toEqual(['r']);
    expect(p.regions[0].holes.map((h) => h.entities[0]).sort()).toEqual(['h1', 'h2', 'h3', 'h4']);
  });

  it('treats an island inside a hole as a second region, and separate outlines as separate regions', () => {
    const p = okProfile(profile([rect('outer', 0, 0, 100, 100), rect('hole', 20, 20, 80, 80), rect('island', 40, 40, 60, 60), rect('apart', 200, 0, 220, 20)]));
    expect(p.regions).toHaveLength(3);
    const byOuter = Object.fromEntries(p.regions.map((r) => [r.outer.entities[0], r.holes.map((h) => h.entities[0])]));
    expect(byOuter).toEqual({ outer: ['hole'], island: [], apart: [] });
  });

  it('builds a slot from lines and arcs (area 2r·L + πr²)', () => {
    const r = 5;
    const p = okProfile(
      profile([
        L('l1', 0, 0, 40, 0),
        { id: 'a1', type: 'arc', layer: '0', center: { x: 40, y: 5 }, radius: r, start: -Math.PI / 2, end: Math.PI / 2 },
        L('l2', 40, 10, 0, 10),
        { id: 'a2', type: 'arc', layer: '0', center: { x: 0, y: 5 }, radius: r, start: Math.PI / 2, end: (3 * Math.PI) / 2 },
      ]),
    );
    // The outline is flattened within 0.01 mm, so its area is a little short of the exact one.
    expect(Math.abs(p.loops[0].area)).toBeCloseTo(2 * r * 40 + Math.PI * r * r, 0);
    const shape = p.loops[0].shape;
    if (shape.kind !== 'path') throw new Error('path expected');
    expect(shape.segments.map((s) => s.kind).sort()).toEqual(['arc', 'arc', 'line', 'line']);
  });

  it('reads polyline bulges as arcs', () => {
    // The same slot as one closed polyline with two half-circle bulges (bulge = tan(180°/4) = 1).
    const p = okProfile(
      profile([
        {
          id: 'p',
          type: 'polyline',
          layer: '0',
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 10 },
            { x: 0, y: 10 },
          ],
          bulges: [0, 1, 0, 1],
        },
      ]),
    );
    expect(Math.abs(p.loops[0].area)).toBeCloseTo(400 + Math.PI * 25, 0);
    const { steps } = penSteps(p.loops[0].shape.kind === 'path' ? p.loops[0].shape.segments : []);
    expect(steps.map((s) => s.op)).toEqual(['line', 'arc', 'line', 'arc']);
    const arc = steps[1];
    if (arc.op !== 'arc') throw new Error('arc expected');
    expect(arc.via.x).toBeCloseTo(45, 9);
    expect(arc.via.y).toBeCloseTo(5, 9);
  });

  it('keeps full circles and ellipses as closed shapes', () => {
    const p = okProfile(profile([C('c', 0, 0, 10), { id: 'el', type: 'ellipse', layer: '0', center: { x: 100, y: 0 }, major: { x: 0, y: 20 }, ratio: 0.5, start: 0, end: Math.PI * 2 }]));
    const kinds = p.loops.map((l) => l.shape.kind).sort();
    expect(kinds).toEqual(['circle', 'ellipse']);
    const el = p.loops.find((l) => l.shape.kind === 'ellipse');
    expect(Math.abs(el?.area ?? 0)).toBeCloseTo(Math.PI * 20 * 10, 0);
    if (el?.shape.kind === 'ellipse') expect(el.shape.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it('closes a half ellipse with a line (an elliptical arc segment, ccw)', () => {
    const p = okProfile(profile([{ id: 'el', type: 'ellipse', layer: '0', center: { x: 0, y: 0 }, major: { x: 30, y: 0 }, ratio: 0.5, start: 0, end: Math.PI }, L('l', -30, 0, 30, 0)]));
    expect(Math.abs(p.loops[0].area)).toBeCloseTo((Math.PI * 30 * 15) / 2, 0);
    const shape = p.loops[0].shape;
    if (shape.kind !== 'path') throw new Error('path expected');
    const { steps } = penSteps(shape.segments);
    const e = steps.find((s) => s.op === 'ellipse');
    expect(e && e.op === 'ellipse' && { rx: e.rx, ry: e.ry, long: e.long }).toEqual({ rx: 30, ry: 15, long: false });
  });
});

describe('splines', () => {
  it('splits a clamped B-spline into Bézier pieces that follow the curve exactly', () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 25 },
      { x: 50, y: -5 },
      { x: 60, y: 10 },
      { x: 80, y: 0 },
    ];
    const knots = clampedKnots(cps.length, 3);
    const beziers = splineToBeziers(3, cps, knots);
    expect(beziers).not.toBeNull();
    if (!beziers) return;
    expect(beziers).toHaveLength(3); // 6 control points, degree 3: three spans
    // Piece k covers [knots[3+k], knots[4+k]]: sample both and compare.
    beziers.forEach((q, k) => {
      const u0 = knots[3 + k];
      const u1 = knots[4 + k];
      for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        const a = bezierPoint(q, s);
        const b = splinePoint({ degree: 3, controlPoints: cps, knots }, u0 + (u1 - u0) * s);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
      }
    });
  });

  it('declines a knot vector that is not clamped', () => {
    expect(splineToBeziers(3, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }], [0, 1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });

  it('closes a spline profile with a line', () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 10, y: 30 },
      { x: 40, y: 30 },
      { x: 50, y: 0 },
    ];
    const p = okProfile(profile([{ id: 's', type: 'spline', layer: '0', degree: 3, controlPoints: cps, knots: clampedKnots(4, 3), closed: false }, L('l', 50, 0, 0, 0)]));
    // A single cubic Bézier over the chord: area = 3/20·|…| = (3/10)·(Δx)·(y1 + y2)/… — compare with sampling instead.
    const pts = Array.from({ length: 2001 }, (_, i) => bezierPoint(cps, i / 2000));
    expect(Math.abs(p.loops[0].area)).toBeCloseTo(Math.abs(signedArea(pts)), 1);
  });
});

describe('errors in plain words', () => {
  it('names the open end, its entity and where it is', () => {
    const r = profile([L('e7', 120, 0, 120, 70), L('e5', 0, 70, 0, 0), L('e6', 0, 0, 120, 0)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toBe("The sketch 'Base' is not closed: the end of line e7 at (120, 70) meets nothing.");
    expect(r.error.at).toEqual({ x: 120, y: 70 });
    expect(r.error.entities).toEqual(['e7']);
  });

  it('reports a branch where three curves meet', () => {
    const r = profile([L('a', 0, 0, 10, 0), L('b', 10, 0, 10, 10), L('c', 10, 10, 0, 0), L('d', 0, 0, -10, 0)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/^The sketch 'Base' branches at \(0, 0\): line a, line c, line d meet there/);
  });

  it('reports curves that cross', () => {
    // A closed bow tie: the two diagonals cross at (5, 5).
    const r = profile([L('d1', 0, 0, 10, 10), L('t', 10, 10, 0, 10), L('d2', 0, 10, 10, 0), L('b', 10, 0, 0, 0)]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/cross or overlap near \(5, 5\): line d[12] and line d[12]\./);
      expect(r.error.at?.x).toBeCloseTo(5, 9);
    }
  });

  it('reports a circle that cuts the outline', () => {
    const r = profile([rect('r', 0, 0, 100, 60), C('c', 100, 30, 10)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/cross or overlap/);
  });

  it('reports a missing entity and an empty sketch', () => {
    const missing = buildProfile(docOf([]), { name: 'S', entities: ['gone'] });
    expect(!missing.ok && missing.error.message).toBe("The sketch 'S' uses gone, which is no longer in the drawing.");
    const empty = buildProfile(docOf([{ id: 'tx', type: 'text', layer: '0', position: { x: 0, y: 0 }, text: 'hi', height: 3.5, rotation: 0 }]), { name: 'S', entities: ['tx'] });
    expect(!empty.ok && empty.error.message).toBe("The sketch 'S' has no lines, arcs or circles to make a profile.");
  });
});

describe('planes', () => {
  it('maps sketch coordinates onto XY, XZ and YZ with the offset along the normal', () => {
    const p = { x: 3, y: 4 };
    expect(toWorld(planeFrame('XY', 2), p)).toEqual([3, 4, 2]);
    // XZ: normal −Y, so a positive offset moves the plane to −Y (a front view reads x → X, y → Z).
    expect(toWorld(planeFrame('XZ', 2), p)).toEqual([3, -2, 4]);
    expect(toWorld(planeFrame('YZ', 2), p)).toEqual([2, 3, 4]);
    for (const plane of ['XY', 'XZ', 'YZ'] as const) {
      const f = planeFrame(plane, 7.5);
      expect(toPlane(f, toWorld(f, p))).toEqual(p);
      // Right-handed: x × y = normal.
      const c = [f.x[1] * f.y[2] - f.x[2] * f.y[1], f.x[2] * f.y[0] - f.x[0] * f.y[2], f.x[0] * f.y[1] - f.x[1] * f.y[0]];
      expect(c.map((v) => v + 0)).toEqual(f.normal.map((v) => v + 0));
    }
  });
});

describe('other uses of a sketch', () => {
  it('collects hole positions without duplicates', () => {
    const pts = holePoints(docOf([C('c', 10, 10, 2), L('l', 10, 10, 50, 10), rect('r', 0, 0, 5, 5)]), ['c', 'l', 'r']);
    expect(pts).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ]);
  });

  it('tells when a profile crosses a revolve axis', () => {
    const p = okProfile(profile([rect('r', 0, 0, 30, 15)]));
    expect(crossesAxis(p, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
    expect(crossesAxis(p, { x: 0, y: 5 }, { x: 1, y: 5 })).toBe(true);
  });

  it('chains section polylines into loops', () => {
    const { loops, open } = chainPolylines([
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
      ],
      [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
    ]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(Math.abs(signedArea(loops[0]))).toBe(1);
    expect(open).toHaveLength(1);
  });
});
