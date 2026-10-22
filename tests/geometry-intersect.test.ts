import { describe, expect, it } from 'vitest';
import {
  circleCircle,
  closestPointOnEntity,
  intersections,
  lineCircle,
  lineLineInfinite,
  perpendicularFoot,
  tangentPointsFrom,
} from '@shared/geometry/intersect';
import { interpolateSpline, splinePoint } from '@shared/geometry/flatten';
import { dist, dot, sub, vec, type Vec2 } from '@shared/geometry/vec2';
import type { ArcEntity, CircleEntity, EllipseEntity, Entity, LineEntity, PolylineEntity, SplineEntity, TextEntity } from '@shared/doc/types';

const close = (p: Vec2, q: Vec2, digits = 12): void => {
  expect(p.x).toBeCloseTo(q.x, digits);
  expect(p.y).toBeCloseTo(q.y, digits);
};
const sortX = (ps: Vec2[]): Vec2[] => ps.slice().sort((a, b) => a.x - b.x || a.y - b.y);
const line = (ax: number, ay: number, bx: number, by: number, id = 'l'): LineEntity => ({ id, layer: '0', type: 'line', a: vec(ax, ay), b: vec(bx, by) });
const circle = (x: number, y: number, r: number, id = 'c'): CircleEntity => ({ id, layer: '0', type: 'circle', center: vec(x, y), radius: r });
const arc = (x: number, y: number, r: number, start: number, end: number, id = 'a'): ArcEntity => ({ id, layer: '0', type: 'arc', center: vec(x, y), radius: r, start, end });

describe('building blocks', () => {
  it('lineLineInfinite', () => {
    close(lineLineInfinite(vec(0, 0), vec(1, 1), vec(0, 4), vec(1, 3))!, vec(2, 2));
    expect(lineLineInfinite(vec(0, 0), vec(1, 0), vec(0, 1), vec(5, 1))).toBeNull();
    expect(lineLineInfinite(vec(0, 0), vec(1, 0), vec(2, 0), vec(5, 0))).toBeNull();
  });
  it('lineCircle: secant, tangent, miss, segment extents', () => {
    expect(sortX(lineCircle(vec(-10, 0), vec(10, 0), vec(0, 0), 5, true))).toEqual([vec(-5, 0), vec(5, 0)]);
    // 3-4-5: the line y = 3 cuts the circle r = 5 at x = ±4.
    const s = sortX(lineCircle(vec(-10, 3), vec(10, 3), vec(0, 0), 5, true));
    close(s[0], vec(-4, 3));
    close(s[1], vec(4, 3));
    expect(lineCircle(vec(-10, 5), vec(10, 5), vec(0, 0), 5, true)).toEqual([vec(0, 5)]);
    expect(lineCircle(vec(-10, 6), vec(10, 6), vec(0, 0), 5, true)).toEqual([]);
    // Segment from the centre outwards hits once; a short segment inside hits none unless extended.
    expect(lineCircle(vec(0, 0), vec(10, 0), vec(0, 0), 5, true)).toEqual([vec(5, 0)]);
    expect(lineCircle(vec(-1, 0), vec(1, 0), vec(0, 0), 5, true)).toEqual([]);
    expect(lineCircle(vec(-1, 0), vec(1, 0), vec(0, 0), 5, false)).toHaveLength(2);
  });
  it('circleCircle: two, tangent, none, concentric', () => {
    // Circles r = 5 at (0,0) and (8,0): chord at x = 4, y = ±3.
    const two = circleCircle(vec(0, 0), 5, vec(8, 0), 5).sort((a, b) => a.y - b.y);
    close(two[0], vec(4, -3));
    close(two[1], vec(4, 3));
    expect(circleCircle(vec(0, 0), 5, vec(10, 0), 5)).toEqual([vec(5, 0)]);
    // Internally tangent, both orders.
    expect(circleCircle(vec(0, 0), 10, vec(5, 0), 5)).toEqual([vec(10, 0)]);
    expect(circleCircle(vec(5, 0), 5, vec(0, 0), 10)).toEqual([vec(10, 0)]);
    expect(circleCircle(vec(0, 0), 5, vec(20, 0), 5)).toEqual([]);
    expect(circleCircle(vec(0, 0), 10, vec(1, 0), 2)).toEqual([]);
    expect(circleCircle(vec(0, 0), 5, vec(0, 0), 3)).toEqual([]);
    expect(circleCircle(vec(0, 0), 5, vec(0, 0), 5)).toEqual([]);
  });
});

describe('intersections', () => {
  it('line–line: crossing, parallel, collinear, touching at an end point', () => {
    close(intersections(line(0, 0, 10, 10), line(0, 10, 10, 0))[0], vec(5, 5));
    expect(intersections(line(0, 0, 10, 0), line(0, 1, 10, 1))).toEqual([]);
    expect(intersections(line(0, 0, 10, 0), line(5, 0, 20, 0))).toEqual([]);
    expect(intersections(line(0, 0, 10, 0), line(10, 0, 10, 10))).toEqual([vec(10, 0)]);
    // Segments that would meet only if extended.
    expect(intersections(line(0, 0, 4, 0), line(5, -1, 5, 1))).toEqual([]);
    expect(intersections(line(0, 0, 4, 0), line(5, -1, 5, 1), { extend: true })).toEqual([vec(5, 0)]);
  });
  it('line–circle: secant, tangent counts once, miss', () => {
    expect(intersections(line(-10, 3, 10, 3), circle(0, 0, 5))).toHaveLength(2);
    expect(intersections(line(-10, 5, 10, 5), circle(0, 0, 5))).toEqual([vec(0, 5)]);
    expect(intersections(line(-10, 7, 10, 7), circle(0, 0, 5))).toEqual([]);
  });
  it('arc spans: points outside the span are excluded unless extended', () => {
    const a = arc(0, 0, 5, 0, Math.PI / 2); // first quadrant
    const pts = intersections(line(-10, 3, 10, 3), a);
    expect(pts).toHaveLength(1);
    close(pts[0], vec(4, 3));
    const ext = sortX(intersections(line(-10, 3, 10, 3), a, { extend: true }));
    expect(ext).toHaveLength(2);
    close(ext[0], vec(-4, 3));
    // An arc that crosses angle 0: from −45° to +45°.
    const b = arc(0, 0, 5, -Math.PI / 4, Math.PI / 4);
    expect(intersections(line(4, -10, 4, 10), b)).toHaveLength(2);
    expect(intersections(line(-4, -10, -4, 10), b)).toHaveLength(0);
    // An end point of the arc on the line counts.
    expect(intersections(line(-10, 0, 10, 0), a)).toEqual([vec(5, 0)]);
  });
  it('circle–circle and arc–arc', () => {
    expect(intersections(circle(0, 0, 5), circle(8, 0, 5, 'd'))).toHaveLength(2);
    expect(intersections(circle(0, 0, 5), circle(10, 0, 5, 'd'))).toEqual([vec(5, 0)]);
    expect(intersections(circle(0, 0, 5), circle(0, 0, 3, 'd'))).toEqual([]);
    // Upper half arc against the circle at (8,0): only (4, 3).
    const up = arc(0, 0, 5, 0, Math.PI);
    const pts = intersections(up, circle(8, 0, 5));
    expect(pts).toHaveLength(1);
    close(pts[0], vec(4, 3));
    expect(intersections(up, arc(8, 0, 5, Math.PI, 1.5 * Math.PI))).toHaveLength(0);
    expect(intersections(up, arc(8, 0, 5, Math.PI, 1.5 * Math.PI), { extend: true })).toHaveLength(2);
  });
  it('polyline with a bulge against a line', () => {
    // Bulge 1 is a half circle (180°); positive = counter-clockwise from (0,0) to (10,0) around (5,0),
    // so the arc passes below the chord, through (5,−5).
    const pl: PolylineEntity = { id: 'p', layer: '0', type: 'polyline', points: [vec(0, 0), vec(10, 0), vec(10, 10)], closed: false, bulges: [1, 0, 0] };
    const pts = sortX(intersections(pl, line(-5, -3, 20, -3)));
    expect(pts).toHaveLength(2);
    close(pts[0], vec(1, -3));
    close(pts[1], vec(9, -3));
    // The straight segment x = 10 crossed by y = 5.
    expect(intersections(pl, line(0, 5, 20, 5))).toEqual([vec(10, 5)]);
    // A line through the shared vertex (10, 0) is reported once.
    const v = intersections(pl, line(5, 5, 15, -5));
    expect(v.filter((p) => dist(p, vec(10, 0)) < 1e-9)).toHaveLength(1);
  });
  it('spline against a line through flattening', () => {
    const fit = [vec(0, 0), vec(10, 10), vec(20, 0), vec(30, 10)];
    const s: SplineEntity = { id: 's', layer: '0', type: 'spline', ...interpolateSpline(fit), fitPoints: fit, closed: false };
    const pts = sortX(intersections(s, line(-5, 5, 35, 5)));
    expect(pts).toHaveLength(3);
    for (const p of pts) {
      expect(p.y).toBeCloseTo(5, 12);
      // Refined onto the true curve, not just the flattening.
      expect(dist(closestPointOnEntity(p, s).point, p)).toBeLessThan(1e-9);
    }
    // The fit points are point-symmetric about (15, 5), so the middle crossing is there.
    expect(pts[1].x).toBeCloseTo(15, 9);
    expect(pts[0].x + pts[2].x).toBeCloseTo(30, 9);
  });
  it('ellipse against a line', () => {
    const el: EllipseEntity = { id: 'e', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: Math.PI * 2 };
    const pts = sortX(intersections(el, line(-20, 0, 20, 0)));
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeCloseTo(-10, 9);
    expect(pts[1].x).toBeCloseTo(10, 9);
    // x = 6 → y = ±5·sqrt(1 − 0.36) = ±4.
    const v = intersections(el, line(6, -10, 6, 10)).sort((a, b) => a.y - b.y);
    expect(v[0].y).toBeCloseTo(-4, 11);
    expect(v[1].y).toBeCloseTo(4, 11);
    // Ellipse against ellipse stays on the flattening (about 0.001 mm).
    const el2: EllipseEntity = { ...el, id: 'e2', major: vec(0, 10) };
    const q = intersections(el, el2);
    expect(q).toHaveLength(4);
    // Both are x²/100 + y²/25 = 1 and x²/25 + y²/100 = 1: |x| = |y| = sqrt(20).
    for (const p of q) {
      expect(Math.abs(p.x)).toBeCloseTo(Math.sqrt(20), 2);
      expect(Math.abs(p.y)).toBeCloseTo(Math.sqrt(20), 2);
    }
  });
  it('deduplicates within the tolerance', () => {
    const pts = intersections(line(0, 0, 10, 0), line(5, -5, 5, 5), { tol: 1e-7 });
    expect(pts).toHaveLength(1);
  });
});

describe('nearest point, perpendicular foot, tangents', () => {
  it('closestPointOnEntity', () => {
    const l = closestPointOnEntity(vec(3, 4), line(0, 0, 10, 0));
    expect(l.point).toEqual(vec(3, 0));
    expect(l.t).toBeCloseTo(0.3, 15);
    expect(closestPointOnEntity(vec(-3, 4), line(0, 0, 10, 0)).point).toEqual(vec(0, 0));
    close(closestPointOnEntity(vec(6, 8), circle(0, 0, 5)).point, vec(3, 4));
    // Outside the arc span → nearer end point.
    const a = arc(0, 0, 5, 0, Math.PI / 2);
    close(closestPointOnEntity(vec(-1, -6), a).point, vec(5, 0), 12);
    const pl: PolylineEntity = { id: 'p', layer: '0', type: 'polyline', points: [vec(0, 0), vec(10, 0), vec(10, 10)], closed: false };
    const c = closestPointOnEntity(vec(12, 4), pl);
    expect(c.point).toEqual(vec(10, 4));
    expect(c.t).toBeCloseTo(1.4, 12);
    const el: EllipseEntity = { id: 'e', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: Math.PI * 2 };
    const ce = closestPointOnEntity(vec(0, 9), el);
    close(ce.point, vec(0, 5), 9);
    const tx: TextEntity = { id: 't', layer: '0', type: 'text', position: vec(0, 0), text: 'AB', height: 10, rotation: 0 };
    close(closestPointOnEntity(vec(3, -2), tx).point, vec(3, 0));
  });
  it('closest point on a spline is on the curve and locally nearest', () => {
    const fit = [vec(0, 0), vec(10, 10), vec(20, 0), vec(30, 10)];
    const s: SplineEntity = { id: 's', layer: '0', type: 'spline', ...interpolateSpline(fit), closed: false };
    const r = closestPointOnEntity(vec(10, 14), s);
    close(splinePoint(s, r.t!), r.point, 12);
    for (const du of [-1e-4, 1e-4]) expect(dist(vec(10, 14), splinePoint(s, r.t! + du))).toBeGreaterThanOrEqual(dist(vec(10, 14), r.point) - 1e-12);
  });
  it('perpendicularFoot', () => {
    expect(perpendicularFoot(vec(3, 4), line(0, 0, 10, 0))).toEqual([vec(3, 0)]);
    expect(perpendicularFoot(vec(13, 4), line(0, 0, 10, 0))).toEqual([]);
    const c = sortX(perpendicularFoot(vec(10, 0), circle(0, 0, 5)));
    close(c[0], vec(-5, 0));
    close(c[1], vec(5, 0));
    expect(perpendicularFoot(vec(10, 0), arc(0, 0, 5, -1, 1))).toHaveLength(1);
    const pl: PolylineEntity = { id: 'p', layer: '0', type: 'polyline', points: [vec(0, 0), vec(10, 0), vec(10, 10)], closed: false };
    expect(sortX(perpendicularFoot(vec(5, 5), pl))).toEqual([vec(5, 0), vec(10, 5)]);
    // Ellipse: from the centre the feet are the four axis ends.
    const el: EllipseEntity = { id: 'e', layer: '0', type: 'ellipse', center: vec(0, 0), major: vec(10, 0), ratio: 0.5, start: 0, end: Math.PI * 2 };
    const f = perpendicularFoot(vec(0, 0), el);
    expect(f).toHaveLength(4);
    for (const q of [vec(10, 0), vec(0, 5), vec(-10, 0), vec(0, -5)]) expect(f.some((p) => dist(p, q) < 1e-9)).toBe(true);
  });
  it('tangentPointsFrom', () => {
    // From (10, 0) to the circle r = 5: angle acos(1/2) = 60°: points (2.5, ±4.33).
    const t = tangentPointsFrom(vec(10, 0), circle(0, 0, 5)).sort((a, b) => a.y - b.y);
    expect(t).toHaveLength(2);
    close(t[0], vec(2.5, -5 * Math.sin(Math.PI / 3)));
    close(t[1], vec(2.5, 5 * Math.sin(Math.PI / 3)));
    for (const p of t) expect(dot(sub(p, vec(0, 0)), sub(p, vec(10, 0)))).toBeCloseTo(0, 10);
    expect(tangentPointsFrom(vec(1, 0), circle(0, 0, 5))).toEqual([]);
    expect(tangentPointsFrom(vec(10, 0), arc(0, 0, 5, 0, Math.PI))).toHaveLength(1);
    const pl: PolylineEntity = { id: 'p', layer: '0', type: 'polyline', points: [vec(0, 0), vec(10, 0)], closed: false, bulges: [-1, 0] };
    // bulge −1 from (0,0) to (10,0): the half circle above, centre (5,0) r 5; from (5, 20) one tangent pair, both on it.
    expect(tangentPointsFrom(vec(5, 20), pl)).toHaveLength(2);
    expect(tangentPointsFrom(vec(5, 20), line(0, 0, 1, 1) as Entity)).toEqual([]);
  });
});
