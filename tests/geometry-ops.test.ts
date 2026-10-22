import { describe, expect, it } from 'vitest';
import {
  arrayPolar,
  arrayRectangular,
  centerOf,
  chamfer,
  endpointsOf,
  extend,
  fillet,
  lengthOf,
  midpointOf,
  offsetEntity,
  offsetIsApproximate,
  splitAt,
  trim,
} from '@shared/geometry/ops';
import { closestPointOnEntity } from '@shared/geometry/intersect';
import { bulgeToArc, ellipsePoint, interpolateSpline, polylineSegments, splinePoint } from '@shared/geometry/flatten';
import { add, angleOf, dist, fromAngle, normAngle, sub, vec, type Vec2 } from '@shared/geometry/vec2';
import { distToPolyline } from '@shared/doc/document';
import { sequentialIds } from '@shared/ids';
import type { ArcEntity, CircleEntity, EllipseEntity, Entity, LineEntity, PolylineEntity, SplineEntity } from '@shared/doc/types';

const close = (p: Vec2, q: Vec2, digits = 12): void => {
  expect(p.x).toBeCloseTo(q.x, digits);
  expect(p.y).toBeCloseTo(q.y, digits);
};
const line = (ax: number, ay: number, bx: number, by: number, id = 'l'): LineEntity => ({ id, layer: '0', type: 'line', a: vec(ax, ay), b: vec(bx, by) });
const circle = (x: number, y: number, r: number, id = 'c'): CircleEntity => ({ id, layer: '0', type: 'circle', center: vec(x, y), radius: r });
const arc = (x: number, y: number, r: number, start: number, end: number, id = 'a'): ArcEntity => ({ id, layer: '0', type: 'arc', center: vec(x, y), radius: r, start, end });
const poly = (pts: [number, number][], closed: boolean, bulges?: number[], id = 'p'): PolylineEntity => {
  const p: PolylineEntity = { id, layer: '0', type: 'polyline', points: pts.map(([x, y]) => vec(x, y)), closed };
  if (bulges) p.bulges = bulges;
  return p;
};
const arcStart = (a: ArcEntity): Vec2 => add(a.center, fromAngle(a.start, a.radius));
const arcEnd = (a: ArcEntity): Vec2 => add(a.center, fromAngle(a.end, a.radius));
/** Distance from p to the infinite line through a line entity. */
const distToLine = (p: Vec2, l: LineEntity): number => {
  const d = sub(l.b, l.a);
  return Math.abs(d.x * (p.y - l.a.y) - d.y * (p.x - l.a.x)) / Math.hypot(d.x, d.y);
};

describe('offset', () => {
  it('a line on both sides', () => {
    const ids = sequentialIds('n');
    const l = line(0, 0, 10, 0);
    expect(offsetEntity(l, 2, vec(5, 3), ids)).toEqual({ id: 'n1', layer: '0', type: 'line', a: vec(0, 2), b: vec(10, 2) });
    expect(offsetEntity(l, 2, vec(5, -1), ids)).toEqual({ id: 'n2', layer: '0', type: 'line', a: vec(0, -2), b: vec(10, -2) });
    // A slanted line: every point moves by the distance along the normal.
    const s = offsetEntity(line(0, 0, 3, 4), 5, vec(0, 10), ids) as LineEntity;
    close(s.a, vec(-4, 3));
    close(s.b, vec(-1, 7));
    expect(offsetEntity(l, 2, vec(5, 0), ids)).toBeNull();
    expect(offsetEntity(l, 0, vec(5, 1), ids)).toBeNull();
  });

  it('circles inward and outward, null when the radius vanishes', () => {
    const ids = sequentialIds('n');
    const c = circle(0, 0, 10);
    expect((offsetEntity(c, 2, vec(0, 20), ids) as CircleEntity).radius).toBe(12);
    expect((offsetEntity(c, 3, vec(1, 0), ids) as CircleEntity).radius).toBe(7);
    expect(offsetEntity(c, 10, vec(1, 0), ids)).toBeNull();
    expect(offsetEntity(c, 12, vec(1, 0), ids)).toBeNull();
  });

  it('arcs keep their angles', () => {
    const a = arc(0, 0, 10, 0.25, 2);
    const o = offsetEntity(a, 1.5, vec(0, 3), sequentialIds('n')) as ArcEntity;
    expect(o).toEqual({ ...a, id: 'n1', radius: 8.5 });
    expect((offsetEntity(a, 1.5, vec(0, 30), sequentialIds('n')) as ArcEntity).radius).toBe(11.5);
  });

  it('closed rectangle outward: sides at the distance, corners rounded around the vertices', () => {
    const rect = poly([[0, 0], [20, 0], [20, 10], [0, 10]], true);
    const o = offsetEntity(rect, 2, vec(30, 5), sequentialIds('n')) as PolylineEntity;
    expect(o.type).toBe('polyline');
    expect(o.closed).toBe(true);
    expect(o.points).toHaveLength(8);
    const segs = polylineSegments(o);
    const straight = segs.filter((s) => s.bulge === 0);
    const round = segs.filter((s) => s.bulge !== 0);
    expect(straight).toHaveLength(4);
    expect(round).toHaveLength(4);
    // Each straight side is parallel to an original side, 2 mm away, as long as it.
    const orig = polylineSegments(rect);
    for (const s of straight) {
      const match = orig.find((g) => Math.abs(distToLine(s.a, line(g.a.x, g.a.y, g.b.x, g.b.y)) - 2) < 1e-12 && Math.abs(distToLine(s.b, line(g.a.x, g.a.y, g.b.x, g.b.y)) - 2) < 1e-12);
      expect(match).toBeDefined();
      expect(dist(s.a, s.b)).toBeCloseTo(dist(match!.a, match!.b), 12);
    }
    // Each corner is a quarter circle of radius 2 around an original vertex.
    for (const s of round) {
      expect(s.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
      const g = bulgeToArc(s.a, s.b, s.bulge)!;
      expect(g.radius).toBeCloseTo(2, 12);
      expect(rect.points.some((p) => dist(p, g.center) < 1e-12)).toBe(true);
    }
    // Every vertex of the result is exactly 2 mm from the rectangle.
    for (const p of o.points) expect(distToPolyline(p, rect.points, true)).toBeCloseTo(2, 12);
  });

  it('closed rectangle inward: sharp corners, exact', () => {
    const rect = poly([[0, 0], [20, 0], [20, 10], [0, 10]], true);
    const o = offsetEntity(rect, 2, vec(10, 5), sequentialIds('n')) as PolylineEntity;
    expect(o.points).toEqual([vec(2, 2), vec(18, 2), vec(18, 8), vec(2, 8)]);
    expect(o.bulges).toBeUndefined();
    // The same rectangle drawn clockwise gives the same result.
    const cw = poly([[0, 0], [0, 10], [20, 10], [20, 0]], true);
    const o2 = offsetEntity(cw, 2, vec(10, 5), sequentialIds('n')) as PolylineEntity;
    for (const p of o2.points) expect(distToPolyline(p, cw.points, true)).toBeCloseTo(2, 12);
    expect(o2.points).toHaveLength(4);
  });

  it('polyline with a bulge: the arc keeps centre and angle, radius ± distance', () => {
    // Straight to (10,0), then a half circle ccw around (10,5) to (10,10), tangent to the straight part.
    const p = poly([[0, 0], [10, 0], [10, 10]], false, [0, 1, 0]);
    const inside = offsetEntity(p, 1, vec(5, 1), sequentialIds('n')) as PolylineEntity;
    expect(inside.points.length).toBe(3);
    close(inside.points[0], vec(0, 1));
    close(inside.points[1], vec(10, 1));
    close(inside.points[2], vec(10, 9));
    expect(inside.bulges).toEqual([0, 1, 0]);
    const outside = offsetEntity(p, 1, vec(5, -1), sequentialIds('n')) as PolylineEntity;
    close(outside.points[0], vec(0, -1));
    close(outside.points[1], vec(10, -1));
    close(outside.points[2], vec(10, 11));
    // Inward by more than the radius: the arc vanishes and is dropped.
    const gone = offsetEntity(p, 6, vec(5, 1), sequentialIds('n')) as PolylineEntity;
    expect(gone.points).toEqual([vec(0, 6), vec(10, 6)]);
  });

  it('a closed slot (two half circles) offsets exactly on both sides', () => {
    const slot = poly([[0, 0], [10, 0], [10, 10], [0, 10]], true, [0, 1, 0, 1]);
    const out = offsetEntity(slot, 1, vec(20, 5), sequentialIds('n')) as PolylineEntity;
    expect(out.points).toEqual([vec(0, -1), vec(10, -1), vec(10, 11), vec(0, 11)]);
    expect(out.bulges).toEqual([0, 1, 0, 1]);
    const inn = offsetEntity(slot, 1, vec(5, 5), sequentialIds('n')) as PolylineEntity;
    expect(inn.points).toEqual([vec(0, 1), vec(10, 1), vec(10, 9), vec(0, 9)]);
  });

  it('a short edge that the inward offset consumes is dropped', () => {
    // Rectangle with a 0.5 mm chamfer at the top right; offset inward by 2 mm.
    const shape = poly([[0, 0], [20, 0], [20, 9.5], [19.5, 10], [0, 10]], true);
    const o = offsetEntity(shape, 2, vec(10, 5), sequentialIds('n')) as PolylineEntity;
    expect(o.points).toHaveLength(4);
    for (const [p, q] of [[o.points[0], vec(2, 2)], [o.points[1], vec(18, 2)], [o.points[2], vec(18, 8)], [o.points[3], vec(2, 8)]]) close(p, q);
  });

  it('a concave L corner is trimmed, a convex one rounded', () => {
    const L = poly([[0, 0], [10, 0], [10, 10]], false);
    // Left of travel (inside the turn): concave, trimmed to (9, 1).
    const inner = offsetEntity(L, 1, vec(5, 5), sequentialIds('n')) as PolylineEntity;
    expect(inner.points).toEqual([vec(0, 1), vec(9, 1), vec(9, 10)]);
    // Right of travel: a quarter arc of radius 1 around (10, 0).
    const outer = offsetEntity(L, 1, vec(5, -5), sequentialIds('n')) as PolylineEntity;
    expect(outer.points).toEqual([vec(0, -1), vec(10, -1), vec(11, 0), vec(11, 10)]);
    expect(outer.bulges![1]).toBeCloseTo(Math.tan(Math.PI / 8), 12);
  });

  it('ellipses and splines give a polyline approximation', () => {
    const el: EllipseEntity = { id: 'e', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: Math.PI * 2 };
    expect(offsetIsApproximate(el)).toBe(true);
    expect(offsetIsApproximate(line(0, 0, 1, 1))).toBe(false);
    const o = offsetEntity(el, 1, vec(0, 20), sequentialIds('n')) as PolylineEntity;
    expect(o.type).toBe('polyline');
    expect(o.closed).toBe(true);
    for (const p of o.points) expect(dist(closestPointOnEntity(p, el).point, p)).toBeCloseTo(1, 2);
  });
});

describe('fillet', () => {
  it('two perpendicular lines: tangent arc, lines trimmed, picked sides kept', () => {
    const a = line(-10, 0, 20, 0, 'A');
    const b = line(0, -10, 0, 20, 'B');
    const r = fillet(a, b, 3, vec(15, 0), vec(0, 15), sequentialIds('n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const arcE = r.arc!;
    expect(arcE.id).toBe('n1');
    expect(arcE.layer).toBe('0');
    close(arcE.center, vec(3, 3));
    expect(distToLine(arcE.center, a)).toBeCloseTo(3, 12);
    expect(distToLine(arcE.center, b)).toBeCloseTo(3, 12);
    expect(normAngle(arcE.end - arcE.start)).toBeCloseTo(Math.PI / 2, 12);
    // The arc ends are the tangent points, on the lines.
    const ends = [arcStart(arcE), arcEnd(arcE)];
    expect(ends.some((p) => dist(p, vec(3, 0)) < 1e-12)).toBe(true);
    expect(ends.some((p) => dist(p, vec(0, 3)) < 1e-12)).toBe(true);
    expect(r.a).toEqual({ ...a, a: vec(3, 0) });
    expect(r.b).toEqual({ ...b, a: vec(0, 3) });
    // The other quadrant.
    const r2 = fillet(a, b, 3, vec(-5, 0), vec(0, -5), sequentialIds('n'));
    if (!r2.ok) throw new Error('expected a fillet');
    close(r2.arc!.center, vec(-3, -3));
    expect(r2.a).toEqual({ ...a, b: vec(-3, 0) });
    expect(r2.b).toEqual({ ...b, b: vec(0, -3) });
  });

  it('lines that do not reach the corner are extended to the tangent points', () => {
    const a = line(5, 0, 20, 0, 'A');
    const b = line(0, 6, 0, 20, 'B');
    const r = fillet(a, b, 2, vec(10, 0), vec(0, 10), sequentialIds('n'));
    if (!r.ok) throw new Error('expected a fillet');
    expect(r.a).toEqual({ ...a, a: vec(2, 0) });
    expect(r.b).toEqual({ ...b, a: vec(0, 2) });
  });

  it('line and circle: arc tangent to both, line trimmed, circle kept', () => {
    const a = line(-20, 0, 20, 0, 'A');
    const c = circle(0, 10, 5, 'C');
    const r = fillet(a, c, 3, vec(10, 0), vec(0, 15), sequentialIds('n'));
    if (!r.ok) throw new Error('expected a fillet');
    const f = r.arc!;
    close(f.center, vec(Math.sqrt(15), 3));
    expect(distToLine(f.center, a)).toBeCloseTo(3, 12);
    expect(dist(f.center, c.center)).toBeCloseTo(c.radius + 3, 12);
    const ends = [arcStart(f), arcEnd(f)];
    const onLine = ends.find((p) => Math.abs(p.y) < 1e-12)!;
    const onCircle = ends.find((p) => Math.abs(dist(p, c.center) - 5) < 1e-12)!;
    expect(onLine).toBeDefined();
    expect(onCircle).toBeDefined();
    const na = r.a as LineEntity;
    close(na.a, onLine);
    expect(na.b).toEqual(a.b);
    expect(na.id).toBe('A');
    expect(r.b).toBe(c);
  });

  it('line and arc: the arc is trimmed to its tangent point, keeping the picked part', () => {
    const a = line(-15, 5, 15, 5, 'A');
    const b = arc(0, 0, 10, 0, Math.PI, 'B');
    const r = fillet(a, b, 1, vec(2, 5), vec(3, Math.sqrt(91)), sequentialIds('n'));
    if (!r.ok) throw new Error('expected a fillet');
    const f = r.arc!;
    // Inside the big circle (radius 10 − 1) and above the line (y = 5 + 1).
    close(f.center, vec(Math.sqrt(45), 6));
    const ta = vec(Math.sqrt(45), 5);
    const tb = { x: (10 * Math.sqrt(45)) / 9, y: (10 * 6) / 9 };
    expect(r.a).toEqual({ ...a, b: ta });
    const nb = r.b as ArcEntity;
    expect(nb.start).toBeCloseTo(angleOf(tb), 12);
    expect(nb.end).toBe(Math.PI);
    const ends = [arcStart(f), arcEnd(f)];
    expect(ends.some((p) => dist(p, ta) < 1e-12)).toBe(true);
    expect(ends.some((p) => dist(p, tb) < 1e-12)).toBe(true);
  });

  it('two circles: external fillet nearest the picks', () => {
    const r = fillet(circle(0, 0, 5, 'C1'), circle(12, 0, 5, 'C2'), 2, vec(0, 5), vec(12, 5), sequentialIds('n'));
    if (!r.ok) throw new Error('expected a fillet');
    close(r.arc!.center, vec(6, Math.sqrt(13)));
    // One end on each circle, both 2 mm from the fillet centre; the circles stay whole.
    const ends = [arcStart(r.arc!), arcEnd(r.arc!)];
    expect(ends.some((p) => Math.abs(dist(p, vec(0, 0)) - 5) < 1e-12)).toBe(true);
    expect(ends.some((p) => Math.abs(dist(p, vec(12, 0)) - 5) < 1e-12)).toBe(true);
    for (const p of ends) expect(dist(p, r.arc!.center)).toBeCloseTo(2, 12);
    expect(r.a).toEqual(circle(0, 0, 5, 'C1'));
  });

  it('reasons: radius too large, parallel, unsupported, no solution', () => {
    const a = line(0, 0, 5, 0, 'A');
    const b = line(0, 0, 0, 5, 'B');
    expect(fillet(a, b, 10, vec(2, 0), vec(0, 2), sequentialIds('n'))).toEqual({ ok: false, reason: 'radius-too-large' });
    expect(fillet(a, line(0, 3, 5, 3, 'C'), 1, vec(2, 0), vec(2, 3), sequentialIds('n'))).toEqual({ ok: false, reason: 'parallel' });
    const el: Entity = { id: 'E', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(5, 0), ratio: 0.5, start: 0, end: 0 };
    expect(fillet(a, el, 1, vec(2, 0), vec(5, 0), sequentialIds('n'))).toEqual({ ok: false, reason: 'unsupported' });
    // Two circles far apart with a small radius: no circle of radius 1 touches both.
    expect(fillet(circle(0, 0, 1, 'C1'), circle(100, 0, 1, 'C2'), 1, vec(1, 0), vec(99, 0), sequentialIds('n'))).toEqual({ ok: false, reason: 'no-solution' });
  });

  it('radius 0 trims or extends two lines to their corner', () => {
    const a = line(2, 0, 10, 0, 'A');
    const b = line(0, 2, 0, 10, 'B');
    const r = fillet(a, b, 0, vec(5, 0), vec(0, 5), sequentialIds('n'));
    expect(r).toEqual({ ok: true, a: { ...a, a: vec(0, 0) }, b: { ...b, a: vec(0, 0) }, arc: null });
    // Crossing lines: the picked sides are kept.
    const c = line(-10, 0, 10, 0, 'C');
    const d = line(5, -10, 5, 10, 'D');
    const r2 = fillet(c, d, 0, vec(-5, 0), vec(5, 8), sequentialIds('n'));
    expect(r2).toEqual({ ok: true, a: { ...c, b: vec(5, 0) }, b: { ...d, a: vec(5, 0) }, arc: null });
  });
});

describe('chamfer', () => {
  it('different distances along each line, from the intersection', () => {
    const a = line(0, 0, 20, 0, 'A');
    const b = line(0, 0, 0, 20, 'B');
    const r = chamfer(a, b, 3, 5, vec(10, 0), vec(0, 10), sequentialIds('n'));
    expect(r).toEqual({
      ok: true,
      a: { ...a, a: vec(3, 0) },
      b: { ...b, a: vec(0, 5) },
      line: { id: 'n1', layer: '0', type: 'line', a: vec(3, 0), b: vec(0, 5) },
    });
    // Lines that do not meet are measured from the intersection of their extensions.
    const c = line(2, 0, 20, 0, 'A');
    const d = line(0, 20, 0, 4, 'B');
    const r2 = chamfer(c, d, 3, 5, vec(10, 0), vec(0, 10), sequentialIds('n'));
    if (!r2.ok) throw new Error('expected a chamfer');
    expect(r2.a).toEqual({ ...c, a: vec(3, 0) });
    expect(r2.b).toEqual({ ...d, b: vec(0, 5) });
  });
  it('reasons', () => {
    const a = line(0, 0, 20, 0, 'A');
    expect(chamfer(a, line(0, 0, 0, 20, 'B'), 25, 5, vec(10, 0), vec(0, 10), sequentialIds('n'))).toEqual({ ok: false, reason: 'too-large' });
    expect(chamfer(a, line(0, 3, 20, 3, 'B'), 1, 1, vec(10, 0), vec(10, 3), sequentialIds('n'))).toEqual({ ok: false, reason: 'parallel' });
  });
});

describe('trim', () => {
  it('a line by a crossing line: the picked side goes', () => {
    const e = line(0, 0, 10, 0, 'E');
    const cut = line(4, -5, 4, 5, 'X');
    expect(trim(e, [cut], vec(2, 0), sequentialIds('n'))).toEqual([{ ...e, a: vec(4, 0) }]);
    expect(trim(e, [cut], vec(8, 0.3), sequentialIds('n'))).toEqual([{ ...e, b: vec(4, 0) }]);
  });
  it('a line between two cutters leaves two lines', () => {
    const e = line(0, 0, 10, 0, 'E');
    const r = trim(e, [line(3, -1, 3, 1, 'X'), line(7, -1, 7, 1, 'Y')], vec(5, 0), sequentialIds('n'));
    expect(r).toEqual([
      { ...e, b: vec(3, 0) },
      { ...e, id: 'n1', a: vec(7, 0) },
    ]);
  });
  it('nothing to trim → null', () => {
    const e = line(0, 0, 10, 0, 'E');
    expect(trim(e, [line(20, -1, 20, 1, 'X')], vec(5, 0), sequentialIds('n'))).toBeNull();
    expect(trim(e, [], vec(5, 0), sequentialIds('n'))).toBeNull();
    // A cutter touching only an end point does not cut.
    expect(trim(e, [line(10, -1, 10, 1, 'X')], vec(5, 0), sequentialIds('n'))).toBeNull();
  });
  it('a circle by two lines becomes one arc', () => {
    const c = circle(0, 0, 10, 'C');
    const r = trim(c, [line(6, -20, 6, 20, 'X'), line(-20, 6, 20, 6, 'Y')], vec(10, 0), sequentialIds('n'));
    expect(r).toHaveLength(1);
    const a = r![0] as ArcEntity;
    expect(a.type).toBe('arc');
    expect(a.id).toBe('C');
    expect(a.start).toBeCloseTo(Math.atan2(6, 8), 12);
    expect(a.end).toBeCloseTo(Math.atan2(-8, 6), 12);
    // The picked point is no longer on the arc; the opposite point is.
    expect(closestPointOnEntity(vec(10, 0), a).point).not.toEqual(vec(10, 0));
    close(closestPointOnEntity(vec(-10, 0), a).point, vec(-10, 0));
    // A single cut does not separate a piece of a circle.
    expect(trim(c, [line(0, 0, 20, 0, 'Z')], vec(0, 10), sequentialIds('n'))).toBeNull();
  });
  it('an arc by a line', () => {
    const a = arc(0, 0, 10, 0, Math.PI, 'A');
    const r = trim(a, [line(0, 0, 0, 20, 'X')], vec(8, 6), sequentialIds('n'));
    expect(r).toHaveLength(1);
    expect((r![0] as ArcEntity).start).toBeCloseTo(Math.PI / 2, 12);
    expect((r![0] as ArcEntity).end).toBe(Math.PI);
  });
  it('a closed rectangle by a line becomes an open polyline', () => {
    const rect = poly([[0, 0], [20, 0], [20, 10], [0, 10]], true, undefined, 'R');
    const r = trim(rect, [line(15, -5, 15, 15, 'X')], vec(20, 5), sequentialIds('n'));
    expect(r).toEqual([{ id: 'R', layer: '0', type: 'polyline', points: [vec(15, 10), vec(0, 10), vec(0, 0), vec(15, 0)], closed: false }]);
  });
  it('an open polyline split inside a bulge segment: the arc piece gets its own bulge', () => {
    const p = poly([[0, 0], [10, 0], [20, 0]], false, [1, 0, 0], 'P');
    const r = trim(p, [line(5, -10, 5, 10, 'X')], vec(15, 0), sequentialIds('n'));
    expect(r).toHaveLength(1);
    const q = r![0] as PolylineEntity;
    expect(q.points).toHaveLength(2);
    close(q.points[1], vec(5, -5));
    expect(q.bulges![0]).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    const g = bulgeToArc(q.points[0], q.points[1], q.bulges![0])!;
    close(g.center, vec(5, 0));
    // Picking the first piece instead keeps the rest: arc from (5,−5) to (10,0), then the straight part.
    const r2 = trim(p, [line(5, -10, 5, 10, 'X')], vec(1, -3), sequentialIds('n'));
    const q2 = r2![0] as PolylineEntity;
    expect(q2.points).toHaveLength(3);
    close(q2.points[0], vec(5, -5));
    expect(q2.points[2]).toEqual(vec(20, 0));
    expect(q2.bulges![0]).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(q2.bulges![1]).toBe(0);
  });
  it('an open polyline split at a vertex', () => {
    const p = poly([[0, 0], [10, 0], [10, 10]], false, undefined, 'P');
    const r = trim(p, [line(5, 5, 15, -5, 'X')], vec(10, 8), sequentialIds('n'));
    expect(r).toEqual([{ id: 'P', layer: '0', type: 'polyline', points: [vec(0, 0), vec(10, 0)], closed: false }]);
  });
  it('a full ellipse by a line becomes a partial ellipse', () => {
    const el: EllipseEntity = { id: 'E', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: Math.PI * 2 };
    const r = trim(el, [line(6, -10, 6, 10, 'X')], vec(10, 0), sequentialIds('n'));
    expect(r).toHaveLength(1);
    const e = r![0] as EllipseEntity;
    const t = Math.atan2(0.8, 0.6);
    expect(e.start).toBeCloseTo(t, 9);
    expect(e.end).toBeCloseTo(-t, 9);
    close(ellipsePoint(e, e.start), vec(6, 4), 9);
  });
  it('splines are not trimmed', () => {
    const s: SplineEntity = { id: 'S', layer: '0', type: 'spline', ...interpolateSpline([vec(0, 0), vec(10, 10), vec(20, 0)]), closed: false };
    expect(trim(s, [line(10, -20, 10, 20, 'X')], vec(5, 5), sequentialIds('n'))).toBeNull();
  });
});

describe('extend', () => {
  it('a line to an arc', () => {
    const e = line(0, 0, 5, 0, 'E');
    expect(extend(e, [arc(0, 0, 10, -Math.PI / 2, Math.PI / 2, 'B')], vec(4, 0))).toEqual({ ...e, b: vec(10, 0) });
  });
  it('a line to the nearest line beyond the picked end', () => {
    const e = line(0, 0, 5, 0, 'E');
    expect(extend(e, [line(12, -5, 12, 5, 'X'), line(8, -5, 8, 5, 'Y')], vec(4, 0))).toEqual({ ...e, b: vec(8, 0) });
    expect(extend(e, [line(-3, -5, -3, 5, 'X')], vec(0.5, 0))).toEqual({ ...e, a: vec(-3, 0) });
  });
  it('nothing to reach → null', () => {
    const e = line(0, 0, 5, 0, 'E');
    expect(extend(e, [line(8, 1, 8, 5, 'X')], vec(4, 0))).toBeNull();
    expect(extend(e, [line(-3, -5, -3, 5, 'X')], vec(4, 0))).toBeNull();
    expect(extend(circle(0, 0, 1), [line(-3, -5, -3, 5, 'X')], vec(1, 0))).toBeNull();
  });
  it('an arc along its circle', () => {
    const a = arc(0, 0, 10, 0, Math.PI / 4, 'A');
    const r = extend(a, [line(0, 0, 0, 20, 'X')], vec(7, 7)) as ArcEntity;
    expect(r.start).toBe(0);
    expect(r.end).toBeCloseTo(Math.PI / 2, 12);
  });
  it('the end segment of an open polyline', () => {
    const p = poly([[0, 0], [5, 0], [5, 5]], false, undefined, 'P');
    expect(extend(p, [line(-10, 9, 10, 9, 'X')], vec(5, 4))).toEqual({ ...p, points: [vec(0, 0), vec(5, 0), vec(5, 9)] });
    // A bulge end segment follows its circle: quarter arc ccw around (5,5) from (5,0) to (10,5), extended to y = 9.
    const q = poly([[0, 0], [5, 0], [10, 5]], false, [0, Math.tan(Math.PI / 8), 0], 'Q');
    const r = extend(q, [line(0, 9, 20, 9, 'X')], vec(10, 4)) as PolylineEntity;
    const end = r.points[2];
    expect(dist(end, vec(5, 5))).toBeCloseTo(5, 12);
    expect(end.y).toBeCloseTo(9, 12);
    const g = bulgeToArc(r.points[1], r.points[2], r.bulges![1])!;
    close(g.center, vec(5, 5));
  });
});

describe('splitAt', () => {
  it('a line', () => {
    const e = line(0, 0, 10, 0, 'E');
    expect(splitAt(e, vec(4, 1), sequentialIds('n'))).toEqual([
      { ...e, b: vec(4, 0) },
      { ...e, id: 'n1', a: vec(4, 0) },
    ]);
    expect(splitAt(e, vec(0, 0), sequentialIds('n'))).toEqual([e]);
  });
  it('an arc', () => {
    const a = arc(0, 0, 10, 0, Math.PI / 2, 'A');
    const r = splitAt(a, vec(10, 10), sequentialIds('n')) as ArcEntity[];
    expect(r).toHaveLength(2);
    expect(r[0].start).toBe(0);
    expect(r[0].end).toBeCloseTo(Math.PI / 4, 12);
    expect(r[1].start).toBeCloseTo(Math.PI / 4, 12);
    expect(r[1].end).toBe(Math.PI / 2);
    expect(r[1].id).toBe('n1');
  });
  it('a circle becomes one full arc starting at the point', () => {
    const r = splitAt(circle(0, 0, 5, 'C'), vec(0, 7), sequentialIds('n'));
    expect(r).toEqual([{ id: 'C', layer: '0', type: 'arc', center: vec(0, 0), radius: 5, start: Math.PI / 2, end: Math.PI / 2 }]);
  });
  it('polylines: open into two, closed opened at the point', () => {
    const p = poly([[0, 0], [10, 0], [10, 10]], false, undefined, 'P');
    expect(splitAt(p, vec(10, 4), sequentialIds('n'))).toEqual([
      { ...p, points: [vec(0, 0), vec(10, 0), vec(10, 4)] },
      { ...p, id: 'n1', points: [vec(10, 4), vec(10, 10)] },
    ]);
    const sq = poly([[0, 0], [10, 0], [10, 10], [0, 10]], true, undefined, 'S');
    expect(splitAt(sq, vec(5, 0), sequentialIds('n'))).toEqual([{ ...sq, closed: false, points: [vec(5, 0), vec(10, 0), vec(10, 10), vec(0, 10), vec(0, 0), vec(5, 0)] }]);
  });
  it('an open spline into two exact halves', () => {
    const fit = [vec(0, 0), vec(10, 10), vec(20, 0), vec(30, 10)];
    const s: SplineEntity = { id: 'S', layer: '0', type: 'spline', ...interpolateSpline(fit), fitPoints: fit, closed: false };
    const r = splitAt(s, vec(10, 12), sequentialIds('n')) as SplineEntity[];
    expect(r).toHaveLength(2);
    expect(r[0].fitPoints).toBeUndefined();
    close(r[0].controlPoints[r[0].controlPoints.length - 1], r[1].controlPoints[0]);
    for (const piece of r) {
      expect(piece.knots.length).toBe(piece.controlPoints.length + piece.degree + 1);
      const u0 = piece.knots[piece.degree];
      const u1 = piece.knots[piece.controlPoints.length];
      for (const f of [0.1, 0.5, 0.9]) {
        const q = splinePoint(piece, u0 + (u1 - u0) * f);
        expect(dist(closestPointOnEntity(q, s).point, q)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('arrays', () => {
  it('rectangular: rows × cols − 1 copies with new ids', () => {
    const c = circle(1, 2, 0.5, 'C');
    const r = arrayRectangular([c], 2, 3, 10, 20, sequentialIds('n')) as CircleEntity[];
    expect(r).toHaveLength(5);
    expect(r.map((e) => e.center)).toEqual([vec(21, 2), vec(41, 2), vec(1, 12), vec(21, 12), vec(41, 12)]);
    expect(new Set(r.map((e) => e.id)).size).toBe(5);
    expect(r.some((e) => e.id === 'C')).toBe(false);
  });
  it('polar around a full turn, rotating the items', () => {
    const l = line(10, 0, 12, 0, 'L');
    const r = arrayPolar([l], vec(0, 0), 4, Math.PI * 2, true, sequentialIds('n')) as LineEntity[];
    expect(r).toHaveLength(3);
    close(r[0].a, vec(0, 10));
    close(r[0].b, vec(0, 12));
    close(r[1].a, vec(-10, 0));
    close(r[2].b, vec(0, -12));
  });
  it('polar without rotating: copies only move', () => {
    const l = line(10, 0, 12, 0, 'L');
    const r = arrayPolar([l], vec(0, 0), 4, Math.PI * 2, false, sequentialIds('n')) as LineEntity[];
    // The box centre (11, 0) goes to (0, 11); the line stays horizontal.
    close(r[0].a, vec(-1, 11));
    close(r[0].b, vec(1, 11));
  });
  it('polar over a partial angle: first and last item totalAngle apart', () => {
    const c = circle(10, 0, 1, 'C');
    const r = arrayPolar([c], vec(0, 0), 3, Math.PI, true, sequentialIds('n')) as CircleEntity[];
    expect(r).toHaveLength(2);
    close(r[0].center, vec(0, 10));
    close(r[1].center, vec(-10, 0));
  });
});

describe('measures', () => {
  it('lengthOf', () => {
    expect(lengthOf(line(0, 0, 3, 4))).toBe(5);
    expect(lengthOf(circle(0, 0, 2))).toBeCloseTo(4 * Math.PI, 14);
    expect(lengthOf(arc(0, 0, 2, 0, Math.PI / 2))).toBeCloseTo(Math.PI, 14);
    // Half circle of radius 5 plus a 10 mm straight segment.
    expect(lengthOf(poly([[0, 0], [10, 0], [20, 0]], false, [1, 0, 0]))).toBeCloseTo(5 * Math.PI + 10, 12);
    // Closed square perimeter.
    expect(lengthOf(poly([[0, 0], [10, 0], [10, 10], [0, 10]], true))).toBe(40);
    // Ellipse a = 10, b = 5 against Ramanujan's second approximation (relative error ~1e-10 here).
    const el: EllipseEntity = { id: 'e', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: 0 };
    const h = (5 / 15) ** 2;
    const ram = Math.PI * 15 * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(lengthOf(el)).toBeCloseTo(ram, 6);
    // A circle-like ellipse is a circle.
    expect(lengthOf({ ...el, ratio: 1 })).toBeCloseTo(20 * Math.PI, 12);
    // Degree-1 spline: the length of its control polygon.
    const s1: SplineEntity = { id: 's', layer: '0', type: 'spline', degree: 1, controlPoints: [vec(0, 0), vec(3, 4), vec(3, 10)], knots: [0, 0, 0.5, 1, 1], closed: false };
    expect(lengthOf(s1)).toBeCloseTo(11, 12);
    // A cubic with evenly spaced collinear control points is a straight segment.
    const s3: SplineEntity = { id: 's', layer: '0', type: 'spline', degree: 3, controlPoints: [vec(0, 0), vec(1, 0), vec(2, 0), vec(3, 0)], knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false };
    expect(lengthOf(s3)).toBeCloseTo(3, 12);
  });
  it('midpointOf', () => {
    expect(midpointOf(line(0, 0, 4, 2))).toEqual(vec(2, 1));
    close(midpointOf(arc(0, 0, 10, 0, Math.PI / 2))!, vec(10 * Math.SQRT1_2, 10 * Math.SQRT1_2));
    expect(midpointOf(circle(0, 0, 1))).toBeNull();
    const half: EllipseEntity = { id: 'e', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: Math.PI };
    close(midpointOf(half)!, vec(0, 5), 9);
    expect(midpointOf({ ...half, end: 0 })).toBeNull();
    const fit = [vec(0, 0), vec(10, 10), vec(20, 0), vec(30, 10)];
    const s: SplineEntity = { id: 's', layer: '0', type: 'spline', ...interpolateSpline(fit), closed: false };
    // Point-symmetric about (15, 5), so its arc-length midpoint is there.
    close(midpointOf(s)!, vec(15, 5), 9);
  });
  it('endpointsOf and centerOf', () => {
    expect(endpointsOf(line(0, 0, 1, 2))).toEqual([vec(0, 0), vec(1, 2)]);
    const ea = endpointsOf(arc(0, 0, 2, 0, Math.PI / 2));
    close(ea[0], vec(2, 0));
    close(ea[1], vec(0, 2));
    expect(endpointsOf(circle(0, 0, 1))).toEqual([]);
    expect(endpointsOf(poly([[0, 0], [1, 0], [1, 1]], false))).toEqual([vec(0, 0), vec(1, 0), vec(1, 1)]);
    expect(centerOf(circle(3, 4, 1))).toEqual(vec(3, 4));
    expect(centerOf(arc(1, 1, 1, 0, 1))).toEqual(vec(1, 1));
    expect(centerOf(line(0, 0, 1, 1))).toBeNull();
  });
});
