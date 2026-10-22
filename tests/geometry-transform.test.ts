import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  applyToVector,
  identity,
  isMirror,
  isSimilarity,
  mirror,
  multiply,
  rotation,
  scaling,
  transformEntity,
  translation,
  uniformScale,
  type Matrix,
} from '@shared/geometry/transform';
import { bulgeToArc, ellipsePoint, polylinePoints, splinePoint } from '@shared/geometry/flatten';
import { angleInArc, angleOf, dist, fromAngle, add, normAngle, sub, vec, type Vec2 } from '@shared/geometry/vec2';
import type { ArcEntity, EllipseEntity, Entity, PolylineEntity, SplineEntity, TextEntity } from '@shared/doc/types';
import { distToEntity } from '@shared/doc/document';
import { closestPointOnEntity } from '@shared/geometry/intersect';

const close = (p: Vec2, q: Vec2, digits = 12): void => {
  expect(p.x).toBeCloseTo(q.x, digits);
  expect(p.y).toBeCloseTo(q.y, digits);
};

/** Points of an arc at fractions of its ccw span. */
const arcSample = (a: ArcEntity, f: number): Vec2 => {
  const span = normAngle(a.end - a.start) || Math.PI * 2;
  return add(a.center, fromAngle(a.start + span * f, a.radius));
};

describe('matrices', () => {
  it('identity and translation', () => {
    expect(applyToPoint(identity(), vec(3, -4))).toEqual(vec(3, -4));
    expect(applyToPoint(translation(10, -2), vec(1.5, 2.25))).toEqual(vec(11.5, 0.25));
    // Vectors do not translate.
    expect(applyToVector(translation(10, -2), vec(1, 1))).toEqual(vec(1, 1));
  });

  it('rotation around a centre', () => {
    close(applyToPoint(rotation(Math.PI / 2), vec(10, 0)), vec(0, 10));
    close(applyToPoint(rotation(Math.PI, vec(5, 5)), vec(6, 5)), vec(4, 5));
    close(applyToPoint(rotation(Math.PI / 2, vec(1, 1)), vec(1, 1)), vec(1, 1));
  });

  it('uniform scaling around a centre', () => {
    expect(applyToPoint(scaling(2, vec(1, 1)), vec(3, 1))).toEqual(vec(5, 1));
    expect(uniformScale(scaling(2.5))).toBeCloseTo(2.5, 15);
    expect(uniformScale(multiply(rotation(0.7), scaling(3)))).toBeCloseTo(3, 12);
  });

  it('mirror across a line through two points', () => {
    // Across the y axis.
    const my = mirror(vec(0, 0), vec(0, 1));
    close(applyToPoint(my, vec(3, 4)), vec(-3, 4));
    // Across the diagonal y = x + 1: (x, y) → (y − 1, x + 1).
    const md = mirror(vec(0, 1), vec(1, 2));
    close(applyToPoint(md, vec(5, 0)), vec(-1, 6));
    close(applyToPoint(md, vec(2, 3)), vec(2, 3));
    expect(isMirror(md)).toBe(true);
    expect(isMirror(rotation(1))).toBe(false);
    expect(uniformScale(md)).toBeCloseTo(1, 14);
    // A reflection applied twice is the identity.
    const twice = multiply(md, md);
    close(applyToPoint(twice, vec(7, -3)), vec(7, -3));
    expect(() => mirror(vec(1, 1), vec(1, 1))).toThrow();
  });

  it('multiply(m1, m2) applies m2 first, then m1', () => {
    const T = translation(10, 0);
    const R = rotation(Math.PI / 2);
    const p = vec(1, 0);
    // R then T: (1,0) → (0,1) → (10,1).
    close(applyToPoint(multiply(T, R), p), vec(10, 1));
    // T then R: (1,0) → (11,0) → (0,11).
    close(applyToPoint(multiply(R, T), p), vec(0, 11));
    // Same as applying one after the other, for an arbitrary chain.
    const m: Matrix = multiply(multiply(scaling(2, vec(1, 2)), mirror(vec(0, 0), vec(1, 3))), rotation(0.3, vec(-1, 4)));
    const q = vec(3.7, -2.1);
    const step = applyToPoint(scaling(2, vec(1, 2)), applyToPoint(mirror(vec(0, 0), vec(1, 3)), applyToPoint(rotation(0.3, vec(-1, 4)), q)));
    close(applyToPoint(m, q), step);
  });

  it('isSimilarity rejects shears and non-uniform scales', () => {
    expect(isSimilarity(multiply(rotation(0.4), scaling(3)))).toBe(true);
    expect(isSimilarity(mirror(vec(0, 0), vec(2, 1)))).toBe(true);
    expect(isSimilarity({ a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(false);
    expect(isSimilarity({ a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 })).toBe(false);
  });
});

describe('transformEntity', () => {
  const arc: ArcEntity = { id: 'a1', layer: 'L', type: 'arc', center: vec(5, 2), radius: 4, start: 0.2, end: 1.9 };

  it('keeps id and layer, transforms lines exactly under translation', () => {
    const l: Entity = { id: 'l', layer: 'L', type: 'line', a: vec(0.1, 0.2), b: vec(3, 4) };
    const t = transformEntity(l, translation(1, 1));
    expect(t).toEqual({ id: 'l', layer: 'L', type: 'line', a: vec(1.1, 1.2), b: vec(4, 5) });
  });

  it('translation leaves arc angles bit-identical', () => {
    const t = transformEntity(arc, translation(3, -7)) as ArcEntity;
    expect(t.start).toBe(arc.start);
    expect(t.end).toBe(arc.end);
    expect(t.center).toEqual(vec(8, -5));
  });

  it('circles: centre and radius × scale', () => {
    const c: Entity = { id: 'c', layer: 'L', type: 'circle', center: vec(1, 1), radius: 2 };
    const t = transformEntity(c, multiply(rotation(0.5, vec(0, 0)), scaling(3)));
    expect(t.type).toBe('circle');
    if (t.type !== 'circle') return;
    expect(t.radius).toBeCloseTo(6, 12);
    close(t.center, applyToPoint(multiply(rotation(0.5), scaling(3)), vec(1, 1)));
  });

  it('rotation turns arc angles and maps every point', () => {
    const m = rotation(0.8, vec(-2, 1));
    const t = transformEntity(arc, m) as ArcEntity;
    for (const f of [0, 0.3, 0.5, 1]) close(arcSample(t, f), applyToPoint(m, arcSample(arc, f)));
  });

  it('a mirror flips the arc direction: start/end swap and it covers the same points', () => {
    const m = mirror(vec(0, 0), vec(1, 0.4));
    const t = transformEntity(arc, m) as ArcEntity;
    expect(t.radius).toBeCloseTo(arc.radius, 12);
    // Start of the image is the image of the end, and vice versa.
    close(arcSample(t, 0), applyToPoint(m, arcSample(arc, 1)));
    close(arcSample(t, 1), applyToPoint(m, arcSample(arc, 0)));
    // Three sample points of the original are on the image, inside its span.
    for (const f of [0.1, 0.5, 0.9]) {
      const q = applyToPoint(m, arcSample(arc, f));
      expect(distToEntity(q, t)).toBeCloseTo(0, 12);
      expect(angleInArc(angleOf(sub(q, t.center)), t.start, t.end)).toBe(true);
      // The image point of fraction f is at fraction 1 − f of the (reversed) image arc.
      close(arcSample(t, 1 - f), q);
    }
    // A point outside the original span stays outside the image span.
    const out = applyToPoint(m, add(arc.center, fromAngle(arc.start - 0.5, arc.radius)));
    expect(angleInArc(angleOf(sub(out, t.center)), t.start, t.end)).toBe(false);
  });

  it('polyline bulges change sign under a mirror and the arcs cover the same points', () => {
    const pl: PolylineEntity = { id: 'p', layer: 'L', type: 'polyline', points: [vec(0, 0), vec(10, 0), vec(10, 10)], closed: false, bulges: [0.5, -0.3, 0] };
    const m = mirror(vec(0, -5), vec(3, -1));
    const t = transformEntity(pl, m) as PolylineEntity;
    expect(t.bulges).toEqual([-0.5, 0.3, 0]);
    // Every flattened point of the original maps onto the image.
    for (const p of polylinePoints(pl, 0.05)) expect(dist(closestPointOnEntity(applyToPoint(m, p), t).point, applyToPoint(m, p))).toBeLessThan(1e-9);
    // The bulge arc centre maps to the image's bulge arc centre.
    const a0 = bulgeToArc(pl.points[0], pl.points[1], 0.5);
    const a1 = bulgeToArc(t.points[0], t.points[1], t.bulges![0]);
    close(a1!.center, applyToPoint(m, a0!.center), 11);
    // Rotation keeps the bulges.
    expect((transformEntity(pl, rotation(1)) as PolylineEntity).bulges).toEqual([0.5, -0.3, 0]);
  });

  it('ellipse: rotation maps parameter t to t; a mirror maps it to −t and covers the same points', () => {
    const el: EllipseEntity = { id: 'e', layer: 'L', type: 'ellipse', center: vec(2, 3), major: vec(6, 2), ratio: 0.4, start: 0.3, end: 2.5 };
    const r = rotation(1.1, vec(1, 1));
    const tr = transformEntity(el, r) as EllipseEntity;
    for (const t of [0.3, 1, 2.5]) close(ellipsePoint(tr, t), applyToPoint(r, ellipsePoint(el, t)));
    const m = mirror(vec(0, 0), vec(1, 2));
    const tm = transformEntity(el, m) as EllipseEntity;
    expect(tm.ratio).toBe(0.4);
    expect(tm.start).toBeCloseTo(-2.5, 15);
    expect(tm.end).toBeCloseTo(-0.3, 15);
    for (const t of [0.3, 0.9, 1.7, 2.5]) {
      const q = applyToPoint(m, ellipsePoint(el, t));
      close(ellipsePoint(tm, -t), q);
      // And -t is inside the image range [start, end].
      expect(-t).toBeGreaterThanOrEqual(tm.start - 1e-12);
      expect(-t).toBeLessThanOrEqual(tm.end + 1e-12);
    }
  });

  it('splines: control and fit points transformed, knots kept', () => {
    const s: SplineEntity = { id: 's', layer: 'L', type: 'spline', degree: 3, controlPoints: [vec(0, 0), vec(1, 2), vec(3, 2), vec(4, 0)], knots: [0, 0, 0, 0, 1, 1, 1, 1], fitPoints: [vec(0, 0), vec(4, 0)], closed: false };
    const m = multiply(translation(5, 5), mirror(vec(0, 0), vec(0, 1)));
    const t = transformEntity(s, m) as SplineEntity;
    expect(t.knots).toEqual(s.knots);
    expect(t.fitPoints).toEqual([vec(5, 5), vec(1, 5)]);
    close(splinePoint(t, 0.37), applyToPoint(m, splinePoint(s, 0.37)));
  });

  it('text: position, height × scale, rotation turned; mirrored baseline without mirrored glyphs', () => {
    const tx: TextEntity = { id: 't', layer: 'L', type: 'text', position: vec(1, 2), text: 'A', height: 3.5, rotation: 0.2 };
    const r = transformEntity(tx, multiply(rotation(0.5), scaling(2))) as TextEntity;
    expect(r.height).toBeCloseTo(7, 12);
    expect(r.rotation).toBeCloseTo(0.7, 12);
    // Mirror across the x axis: the baseline direction 0.2 reflects to −0.2.
    const m = transformEntity(tx, mirror(vec(0, 0), vec(1, 0))) as TextEntity;
    expect(m.rotation).toBeCloseTo(-0.2, 12);
    close(m.position, vec(1, -2));
    expect(m.height).toBeCloseTo(3.5, 12);
    // The reflected baseline direction is the image of the original one.
    const dir = applyToVector(mirror(vec(0, 0), vec(1, 1)), fromAngle(0.2));
    const md = transformEntity(tx, mirror(vec(0, 0), vec(1, 1))) as TextEntity;
    close(fromAngle(md.rotation), dir);
  });

  it('non-uniform scaling throws for curves and text', () => {
    const m: Matrix = { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };
    expect(() => transformEntity(arc, m)).toThrow();
    expect(() => transformEntity({ id: 'c', layer: 'L', type: 'circle', center: vec(0, 0), radius: 1 }, m)).toThrow();
    // Lines follow any affine map exactly.
    const l = transformEntity({ id: 'l', layer: 'L', type: 'line', a: vec(1, 1), b: vec(2, 3) }, m);
    expect(l).toEqual({ id: 'l', layer: 'L', type: 'line', a: vec(2, 1), b: vec(4, 3) });
  });
});
