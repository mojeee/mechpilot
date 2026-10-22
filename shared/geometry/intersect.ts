// Intersections, nearest points, perpendicular feet and tangent points between entities.
//
// Every entity is reduced to primitives: straight segments and circular arcs (lines, circles,
// arcs and polyline segments, bulges included, are exact), and for ellipses, splines and text
// the segments of their flattening at about 0.001 mm. Primitive pairs are solved in closed form;
// a crossing between a flattened ellipse or spline and an exact primitive is then refined on the
// true curve by bisection, so it is exact to rounding as well.

import type { Entity, EllipseEntity, PolylineEntity, SplineEntity } from '../doc/types';
import { arcSegments, bulgeToArc, ellipsePoint, flattenEntity, polylineSegments, splinePoint } from './flatten';
import { add, angleOf, cross, dist, dot, fromAngle, len, normAngle, perp, scale, sub, type Vec2 } from './vec2';

/** Default distance under which two intersection points are the same point (mm). */
export const DEFAULT_TOL = 1e-7;
/** Geometric slack for "on the segment / on the arc / tangent" decisions (mm). */
const EPS = 1e-9;
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Primitives

/**
 * A straight piece from a to b; `infinite` makes it the whole line through a and b. A chord of a
 * flattened ellipse or spline carries the curve and the parameters of its ends (`on`), so that
 * crossings found on the chord can be moved onto the true curve.
 */
export interface SegPrim {
  kind: 'seg';
  a: Vec2;
  b: Vec2;
  infinite: boolean;
  on?: { curve: ParamCurve; ta: number; tb: number };
}
/** A counter-clockwise circular arc; `full` makes it the whole circle. */
export interface ArcPrim {
  kind: 'arc';
  center: Vec2;
  radius: number;
  start: number;
  end: number;
  full: boolean;
}
export type Prim = SegPrim | ArcPrim;

const seg = (a: Vec2, b: Vec2, infinite = false): SegPrim => ({ kind: 'seg', a, b, infinite });
const arcPrim = (center: Vec2, radius: number, start: number, end: number, full: boolean): ArcPrim => ({ kind: 'arc', center, radius, start, end, full });

/** The polyline segment i as a primitive (straight, or the arc of its bulge). */
export function polylineSegmentPrim(a: Vec2, b: Vec2, bulge: number): Prim {
  const arc = bulgeToArc(a, b, bulge);
  return arc ? arcPrim(arc.center, arc.radius, arc.start, arc.end, false) : seg(a, b);
}

/**
 * The primitives of an entity. With `extend`, lines become infinite and arcs become full circles
 * (used by extend and by trim-to-boundary); polylines, ellipses, splines and text are not extended.
 */
export function entityPrims(e: Entity, extend = false): Prim[] {
  switch (e.type) {
    case 'line':
      return [seg(e.a, e.b, extend)];
    case 'circle':
      return [arcPrim(e.center, e.radius, 0, TWO_PI, true)];
    case 'arc': {
      const full = extend || normAngle(e.end - e.start) === 0;
      return [arcPrim(e.center, e.radius, e.start, e.end, full)];
    }
    case 'polyline':
      return polylineSegments(e).map((s) => polylineSegmentPrim(s.a, s.b, s.bulge));
    case 'ellipse':
    case 'spline': {
      const c = curveOf(e);
      const n = c.chords;
      const out: Prim[] = [];
      let ta = c.t0;
      let pa = c.at(ta);
      for (let i = 1; i <= n; i++) {
        const tb = c.t0 + ((c.t1 - c.t0) * i) / n;
        const pb = c.at(tb);
        out.push({ kind: 'seg', a: pa, b: pb, infinite: false, on: { curve: c, ta, tb } });
        ta = tb;
        pa = pb;
      }
      return out;
    }
    case 'text': {
      const out: Prim[] = [];
      for (const poly of flattenEntity(e, 0.001)) for (let i = 0; i + 1 < poly.length; i++) out.push(seg(poly[i], poly[i + 1]));
      return out;
    }
    default:
      // Annotations (dimensions, symbols) take part in no intersections.
      return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Parametric curves (ellipses and splines)

/** A curve x(t) on [t0, t1] with its derivative, searched numerically. */
export interface ParamCurve {
  at: (t: number) => Vec2;
  d: (t: number) => Vec2;
  t0: number;
  t1: number;
  /** Samples for searches (nearest point, perpendicular feet). */
  samples: number;
  /** Chords for intersections (chord error about 0.001 mm or less). */
  chords: number;
  /** A full closed curve: x(t0) = x(t1). */
  periodic: boolean;
}

/**
 * The derivative of a non-rational B-spline (Piegl & Tiller eq. 3.4): degree p − 1, control
 * points p·(P[i+1] − P[i]) / (U[i+p+1] − U[i+1]), the knot vector without its first and last knot.
 */
export function splineDerivative(s: Pick<SplineEntity, 'degree' | 'controlPoints' | 'knots'>): Pick<SplineEntity, 'degree' | 'controlPoints' | 'knots'> {
  const p = s.degree;
  const U = s.knots;
  const P = s.controlPoints;
  const Q: Vec2[] = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const den = U[i + p + 1] - U[i + 1];
    Q.push(den === 0 ? { x: 0, y: 0 } : scale(sub(P[i + 1], P[i]), p / den));
  }
  return { degree: p - 1, controlPoints: Q, knots: U.slice(1, U.length - 1) };
}

export function curveOf(e: EllipseEntity | SplineEntity): ParamCurve {
  if (e.type === 'ellipse') {
    let span = normAngle(e.end - e.start);
    const periodic = span === 0;
    if (periodic) span = TWO_PI;
    const minor = scale(perp(e.major), e.ratio);
    // x'(t) = −major·sin t + minor·cos t.
    const d = (t: number): Vec2 => add(scale(e.major, -Math.sin(t)), scale(minor, Math.cos(t)));
    const chords = Math.max(16, arcSegments(len(e.major), span, 0.001));
    return { at: (t) => ellipsePoint(e, t), d, t0: e.start, t1: e.start + span, samples: 720, chords, periodic };
  }
  const n = e.controlPoints.length - 1;
  const der = splineDerivative(e);
  let poly = 0;
  for (let i = 0; i < n; i++) poly += dist(e.controlPoints[i], e.controlPoints[i + 1]);
  const spans = Math.max(1, n - e.degree + 1);
  return {
    at: (u) => splinePoint(e, u),
    d: (u) => (e.degree < 1 ? { x: 0, y: 0 } : splinePoint(der, u)),
    t0: e.knots[e.degree],
    t1: e.knots[n + 1],
    samples: Math.max(200, 100 * spans),
    chords: Math.min(8000, Math.max(64 * spans, Math.ceil(poly / 0.05))),
    periodic: false,
  };
}

/** Signed distance of p from the curve of an exact primitive (left of a line, outside a circle). */
function signedDist(q: Prim, p: Vec2): number {
  if (q.kind === 'seg') return cross(sub(q.b, q.a), sub(p, q.a)) / dist(q.a, q.b);
  return dist(p, q.center) - q.radius;
}

/** Root of f on [lo, hi] by bisection, f(lo) and f(hi) of opposite signs. */
function bisect(f: (t: number) => number, lo: number, hi: number, flo: number): number {
  for (let k = 0; k < 200; k++) {
    const m = (lo + hi) / 2;
    if (m === lo || m === hi) break;
    const fm = f(m);
    if (fm === 0) return m;
    if (flo * fm < 0) hi = m;
    else {
      lo = m;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Move a crossing found on a chord of a flattened curve onto the curve: the root of the signed
 * distance to the other (exact) primitive along the curve, near the chord. Falls back to the
 * chord point when no sign change brackets it (a tangent touch) or the root leaves the other
 * primitive's extent.
 */
function refineOnCurve(s: SegPrim, other: Prim, raw: Vec2): Vec2 {
  if (!s.on) return raw;
  const { curve, ta, tb } = s.on;
  const f = (t: number): number => signedDist(other, curve.at(t));
  const w = tb - ta;
  const brackets: [number, number][] = [
    [ta, tb],
    [Math.max(curve.t0, ta - w), Math.min(curve.t1, tb + w)],
  ];
  for (const [lo, hi] of brackets) {
    const flo = f(lo);
    const fhi = f(hi);
    let t: number | null = null;
    if (flo === 0) t = lo;
    else if (fhi === 0) t = hi;
    else if (flo * fhi < 0) t = bisect(f, lo, hi, flo);
    if (t === null) continue;
    const p = curve.at(t);
    if (dist(p, raw) > 0.01) continue;
    if (other.kind === 'seg' ? other.infinite || inSegment(lineParam(p, other.a, other.b), other.a, other.b) : onArcPrim(p, other)) return p;
    return raw;
  }
  return raw;
}

// ---------------------------------------------------------------------------------------------
// Building blocks

/** Intersection of the infinite lines a1-a2 and b1-b2; null when parallel (or collinear). */
export function lineLineInfinite(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  // Parallel when the sine of the angle between them is negligible.
  if (den === 0 || Math.abs(den) <= 1e-14 * len(r) * len(s)) return null;
  const t = cross(sub(b1, a1), s) / den;
  return add(a1, scale(r, t));
}

/** Parameter of the projection of p on the line a→b (0 at a, 1 at b). */
export function lineParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  return l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
}

const inSegment = (t: number, a: Vec2, b: Vec2): boolean => {
  const slack = EPS / Math.max(dist(a, b), EPS);
  return t >= -slack && t <= 1 + slack;
};

/**
 * Line (through p1, p2) and circle. The foot F of the centre on the line is at distance h from it;
 * the points are F ± u·sqrt(r² − h²), u the line direction. When h equals r within 1e-9 mm the
 * line is tangent and F is the single contact point. With `segmentOnly`, points outside p1-p2 are
 * dropped.
 */
export function lineCircle(p1: Vec2, p2: Vec2, center: Vec2, radius: number, segmentOnly: boolean): Vec2[] {
  const d = sub(p2, p1);
  const l = len(d);
  if (l === 0) return [];
  const u = scale(d, 1 / l);
  const foot = add(p1, scale(u, dot(sub(center, p1), u)));
  const h = dist(center, foot);
  let pts: Vec2[];
  if (Math.abs(h - radius) <= EPS) pts = [foot];
  else if (h > radius) pts = [];
  else {
    const w = Math.sqrt((radius - h) * (radius + h));
    pts = [sub(foot, scale(u, w)), add(foot, scale(u, w))];
  }
  return segmentOnly ? pts.filter((p) => inSegment(lineParam(p, p1, p2), p1, p2)) : pts;
}

/**
 * Two circles. With d the distance between centres, the common chord is at a = (d² + r1² − r2²)/2d
 * from c1 along c1→c2 and the points are at ±sqrt(r1² − a²) across it. Externally or internally
 * tangent circles (d = r1 + r2 or d = |r1 − r2| within 1e-9 mm) touch at one point; concentric
 * circles (including identical ones) give none.
 */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d <= 1e-12) return [];
  const u = scale(sub(c2, c1), 1 / d);
  if (Math.abs(d - (r1 + r2)) <= EPS) return [add(c1, scale(u, r1))];
  if (Math.abs(d - Math.abs(r1 - r2)) <= EPS) return [add(c1, scale(u, r1 >= r2 ? r1 : -r1))];
  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = add(c1, scale(u, a));
  const n = perp(u);
  return [add(m, scale(n, h)), sub(m, scale(n, h))];
}

/** True when point p (on the circle of the arc) lies within the arc's span, with 1e-9 mm slack. */
export function onArcPrim(p: Vec2, a: ArcPrim): boolean {
  if (a.full) return true;
  const span = normAngle(a.end - a.start);
  if (span === 0) return true;
  const rel = normAngle(angleOf(sub(p, a.center)) - a.start);
  const slack = EPS / Math.max(a.radius, EPS);
  return rel <= span + slack || rel >= TWO_PI - slack;
}

function primPrim(p: Prim, q: Prim): Vec2[] {
  const xs = exactPrimPrim(p, q);
  const pc = p.kind === 'seg' && p.on !== undefined;
  const qc = q.kind === 'seg' && q.on !== undefined;
  // Curve against an exact primitive: refine on the curve. Curve against curve stays on the chords.
  if (pc && !qc) return xs.map((x) => refineOnCurve(p as SegPrim, q, x));
  if (qc && !pc) return xs.map((x) => refineOnCurve(q as SegPrim, p, x));
  return xs;
}

function exactPrimPrim(p: Prim, q: Prim): Vec2[] {
  if (p.kind === 'seg' && q.kind === 'seg') {
    const x = lineLineInfinite(p.a, p.b, q.a, q.b);
    if (!x) return [];
    if (!p.infinite && !inSegment(lineParam(x, p.a, p.b), p.a, p.b)) return [];
    if (!q.infinite && !inSegment(lineParam(x, q.a, q.b), q.a, q.b)) return [];
    return [x];
  }
  if (p.kind === 'seg' && q.kind === 'arc') return lineCircle(p.a, p.b, q.center, q.radius, !p.infinite).filter((x) => onArcPrim(x, q));
  if (p.kind === 'arc' && q.kind === 'seg') return exactPrimPrim(q, p);
  const a = p as ArcPrim;
  const b = q as ArcPrim;
  return circleCircle(a.center, a.radius, b.center, b.radius).filter((x) => onArcPrim(x, a) && onArcPrim(x, b));
}

/** Points that are farther than `tol` from every point kept so far. */
export function dedupe(points: Vec2[], tol = DEFAULT_TOL): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.some((q) => dist(p, q) <= tol)) out.push(p);
  return out;
}

/** All intersections between two lists of primitives, deduplicated. */
export function primsIntersections(pa: Prim[], pb: Prim[], tol = DEFAULT_TOL): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pa) for (const q of pb) out.push(...primPrim(p, q));
  return dedupe(out, tol);
}

/**
 * All intersection points between the curves of two entities. Segment extents and arc spans are
 * respected unless `extend` is set, in which case lines are infinite and arcs are full circles
 * (polylines, ellipses, splines and text are never extended). Ellipses, splines and text are
 * intersected through their flattening at about 0.001 mm; crossings of an ellipse or spline with a
 * line, circle, arc or polyline are then refined onto the true curve (exact to rounding), while
 * ellipse/spline against ellipse/spline and anything against text stay within about 0.001 mm.
 * Points closer than `tol` (default 1e-7 mm) are reported once; a tangent contact is one point.
 * Overlapping collinear segments and coincident arcs report no points.
 */
export function intersections(a: Entity, b: Entity, opts: { extend?: boolean; tol?: number } = {}): Vec2[] {
  const ext = opts.extend ?? false;
  return primsIntersections(entityPrims(a, ext), entityPrims(b, ext), opts.tol ?? DEFAULT_TOL);
}

// ---------------------------------------------------------------------------------------------
// Nearest point

function closestOnSeg(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const t = Math.max(0, Math.min(1, lineParam(p, a, b)));
  if (t === 0) return { point: a, t };
  if (t === 1) return { point: b, t };
  return { point: add(a, scale(sub(b, a), t)), t };
}

/** Closest point on a ccw arc (or circle) and its angle. */
function closestOnArc(p: Vec2, a: ArcPrim): { point: Vec2; angle: number } {
  const d = dist(p, a.center);
  const ang = d === 0 ? a.start : angleOf(sub(p, a.center));
  const radial = add(a.center, fromAngle(ang, a.radius));
  if (a.full || onArcPrim(radial, a)) return { point: radial, angle: ang };
  const s = add(a.center, fromAngle(a.start, a.radius));
  const e = add(a.center, fromAngle(a.end, a.radius));
  return dist(p, s) <= dist(p, e) ? { point: s, angle: a.start } : { point: e, angle: a.end };
}

/**
 * Nearest point on a parametric curve: dense sampling for the best sample, then the root of
 * g(t) = (x(t) − p)·x'(t) (the distance is stationary there) by bisection in the neighbouring
 * intervals; the curve ends count when they are nearer.
 */
function closestOnCurve(p: Vec2, c: ParamCurve): { point: Vec2; t: number } {
  const step = (c.t1 - c.t0) / c.samples;
  let bestT = c.t0;
  let bestD = Infinity;
  for (let i = 0; i <= c.samples; i++) {
    const t = c.t0 + i * step;
    const d = dist(p, c.at(t));
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  const g = (t: number): number => dot(sub(c.at(t), p), c.d(t));
  let best = { t: bestT, d: bestD };
  for (const [lo, hi] of [
    [bestT - step, bestT],
    [bestT, bestT + step],
  ]) {
    let l = lo;
    let h = hi;
    if (!c.periodic) {
      l = Math.max(c.t0, l);
      h = Math.min(c.t1, h);
    }
    if (h <= l) continue;
    const gl = g(l);
    const gh = g(h);
    if (gl * gh > 0) continue;
    const t = gl === 0 ? l : gh === 0 ? h : bisect(g, l, h, gl);
    const d = dist(p, c.at(t));
    if (d < best.d) best = { t, d };
  }
  let t = best.t;
  if (c.periodic && (t < c.t0 || t > c.t1)) t = c.t0 + normAngle(t - c.t0);
  return { point: c.at(t), t };
}

/**
 * Closest point of polyline p: `t` is segment index + fraction along the segment (by angle on
 * bulge arcs), so floor(t) is the segment and t = 0 is the first point.
 */
export function closestOnPolyline(p: Vec2, pl: PolylineEntity): { point: Vec2; t: number } {
  const segs = polylineSegments(pl);
  if (segs.length === 0) return { point: pl.points[0] ?? p, t: 0 };
  let best = { point: segs[0].a, t: 0, d: Infinity };
  segs.forEach((s, i) => {
    const prim = polylineSegmentPrim(s.a, s.b, s.bulge);
    let point: Vec2;
    let frac: number;
    if (prim.kind === 'seg') {
      const c = closestOnSeg(p, s.a, s.b);
      point = c.point;
      frac = c.t;
    } else {
      const c = closestOnArc(p, prim);
      point = c.point;
      frac = bulgeFraction(prim, s.bulge, c.angle);
    }
    const d = dist(p, point);
    if (d < best.d) best = { point, t: i + frac, d };
  });
  return { point: best.point, t: best.t };
}

/** Fraction (0 at the segment's first point, 1 at its second) of an angle on a bulge arc. */
export function bulgeFraction(arc: { start: number; end: number }, bulge: number, angle: number): number {
  const span = normAngle(arc.end - arc.start) || TWO_PI;
  const rel = Math.min(span, normAngle(angle - arc.start));
  const f = rel / span;
  // A negative bulge is stored as the ccw arc from b to a, so the fraction runs the other way.
  return bulge > 0 ? f : 1 - f;
}

/**
 * The point of the entity nearest to p. `t` is the line parameter (0..1), the angle on circles and
 * arcs, segment index + fraction on polylines, the parameter on ellipses and splines; text gives
 * the nearest point of its box outline and no `t`.
 */
export function closestPointOnEntity(p: Vec2, e: Entity): { point: Vec2; t?: number } {
  switch (e.type) {
    case 'line':
      return closestOnSeg(p, e.a, e.b);
    case 'circle':
    case 'arc': {
      const prim = entityPrims(e)[0] as ArcPrim;
      const c = closestOnArc(p, prim);
      return { point: c.point, t: c.angle };
    }
    case 'polyline':
      return closestOnPolyline(p, e);
    case 'ellipse':
      return closestOnCurve(p, curveOf(e));
    case 'spline':
      return closestOnCurve(p, curveOf(e));
    case 'text': {
      const box = flattenEntity(e)[0];
      let best = { point: box[0], d: Infinity };
      for (let i = 0; i + 1 < box.length; i++) {
        const c = closestOnSeg(p, box[i], box[i + 1]);
        const d = dist(p, c.point);
        if (d < best.d) best = { point: c.point, d };
      }
      return { point: best.point };
    }
    default:
      // Annotations: their insertion point.
      return { point: e.position };
  }
}

// ---------------------------------------------------------------------------------------------
// Perpendicular feet and tangent points

function perpOnPrim(p: Vec2, prim: Prim): Vec2[] {
  if (prim.kind === 'seg') {
    const t = lineParam(p, prim.a, prim.b);
    if (!prim.infinite && !inSegment(t, prim.a, prim.b)) return [];
    return [add(prim.a, scale(sub(prim.b, prim.a), t))];
  }
  // Every radius meets the circle at a right angle: the two points along the line centre–p.
  if (dist(p, prim.center) === 0) return [];
  const ang = angleOf(sub(p, prim.center));
  return [ang, ang + Math.PI].map((a) => add(prim.center, fromAngle(a, prim.radius))).filter((q) => onArcPrim(q, prim));
}

/**
 * Points where the line from p meets the curve at a right angle. Ellipses and splines: the
 * stationary points of the distance (where (x(t) − p)·x'(t) changes sign), refined by bisection.
 */
export function perpendicularFoot(p: Vec2, e: Entity): Vec2[] {
  switch (e.type) {
    case 'line':
    case 'circle':
    case 'arc':
    case 'polyline':
      return dedupe(entityPrims(e).flatMap((prim) => perpOnPrim(p, prim)));
    case 'ellipse':
      return stationaryPoints(p, curveOf(e));
    case 'spline':
      return stationaryPoints(p, curveOf(e));
    case 'text':
      return [];
    default:
      return [];
  }
}

function stationaryPoints(p: Vec2, c: ParamCurve): Vec2[] {
  const g = (t: number): number => dot(sub(c.at(t), p), c.d(t));
  const step = (c.t1 - c.t0) / c.samples;
  // On a closed curve the sampling is shifted by half a step so that the seam at t0 is an
  // interior point of an interval rather than an unchecked end.
  const shift = c.periodic ? step / 2 : 0;
  const out: Vec2[] = [];
  let prevT = c.t0 + shift;
  let prevG = g(prevT);
  if (prevG === 0) out.push(c.at(prevT));
  for (let i = 1; i <= c.samples; i++) {
    const t = c.t0 + shift + i * step;
    const gt = g(t);
    if (gt === 0) out.push(c.at(t));
    else if (prevG * gt < 0) out.push(c.at(bisect(g, prevT, t, prevG)));
    prevT = t;
    prevG = gt;
  }
  return dedupe(out, 1e-9);
}

function tangentsOnArc(p: Vec2, a: ArcPrim): Vec2[] {
  const d = dist(p, a.center);
  if (Math.abs(d - a.radius) <= EPS) return onArcPrim(p, a) ? [p] : [];
  if (d < a.radius) return [];
  // The tangent point T sees p at a right angle: angle(T − c) = angle(p − c) ± acos(r / d).
  const base = angleOf(sub(p, a.center));
  const alpha = Math.acos(a.radius / d);
  return [base + alpha, base - alpha].map((t) => add(a.center, fromAngle(t, a.radius))).filter((q) => onArcPrim(q, a));
}

/** Tangent points on circles, arcs and polyline bulge arcs from the point p (outside them). */
export function tangentPointsFrom(p: Vec2, e: Entity): Vec2[] {
  if (e.type !== 'circle' && e.type !== 'arc' && e.type !== 'polyline') return [];
  const out: Vec2[] = [];
  for (const prim of entityPrims(e)) if (prim.kind === 'arc') out.push(...tangentsOnArc(p, prim));
  return dedupe(out);
}

