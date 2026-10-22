// Curve evaluation and flattening: arcs, polyline bulges, ellipses and B-splines become point
// lists within a tolerance in mm. Used for bounds, hit tests, snaps, DXF R12 fallbacks and
// intersections of curves that have no closed-form solution.

import type { ArcEntity, EllipseEntity, Entity, PolylineEntity, SplineEntity } from '../doc/types';
import { add, dist, fromAngle, normAngle, perp, rotate, scale, sub, vec, type Vec2 } from './vec2';

/** Number of segments so that the chord error of a circular arc of radius r stays below `tol`. */
export function arcSegments(radius: number, span: number, tol = 0.01): number {
  if (radius <= tol) return 1;
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / radius)));
  return Math.max(1, Math.ceil(Math.abs(span) / Math.max(step, 1e-6)));
}

/** Points along a counter-clockwise arc from `start` to `end` (radians), end points included. */
export function arcPoints(center: Vec2, radius: number, start: number, end: number, tol = 0.01): Vec2[] {
  let span = normAngle(end - start);
  if (span === 0) span = Math.PI * 2;
  const n = arcSegments(radius, span, tol);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(add(center, fromAngle(start + (span * i) / n, radius)));
  return out;
}

export interface ArcGeom {
  center: Vec2;
  radius: number;
  start: number;
  end: number;
}

/**
 * The arc described by a DXF bulge between a and b: bulge = tan(θ/4), θ the included angle,
 * positive when the arc bends counter-clockwise (to the left of a→b). Null for a straight segment.
 */
export function bulgeToArc(a: Vec2, b: Vec2, bulge: number): ArcGeom | null {
  if (!bulge || Math.abs(bulge) < 1e-12) return null;
  const chord = dist(a, b);
  if (chord === 0) return null;
  const theta = 4 * Math.atan(bulge); // included angle, signed
  const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
  // Distance from the chord midpoint to the centre, along the left normal of a→b.
  const h = (chord / 2) / Math.tan(theta / 2);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n = perp(scale(sub(b, a), 1 / chord));
  const center = add(m, scale(n, h));
  const angA = Math.atan2(a.y - center.y, a.x - center.x);
  const angB = Math.atan2(b.y - center.y, b.x - center.x);
  // Counter-clockwise arcs go a→b; clockwise ones are stored as the ccw arc b→a.
  return theta > 0 ? { center, radius, start: angA, end: angB } : { center, radius, start: angB, end: angA };
}

/** The bulge for the counter-clockwise arc from a to b with the given centre (inverse of bulgeToArc). */
export function arcToBulge(a: Vec2, b: Vec2, center: Vec2, ccw = true): number {
  const angA = Math.atan2(a.y - center.y, a.x - center.x);
  const angB = Math.atan2(b.y - center.y, b.x - center.x);
  const theta = normAngle(ccw ? angB - angA : angA - angB);
  const bulge = Math.tan(theta / 4);
  return ccw ? bulge : -bulge;
}

/** The segments of a polyline as (a, b, bulge) triples, including the closing one. */
export function polylineSegments(p: PolylineEntity): { a: Vec2; b: Vec2; bulge: number }[] {
  const out: { a: Vec2; b: Vec2; bulge: number }[] = [];
  const n = p.points.length;
  const count = p.closed ? n : n - 1;
  for (let i = 0; i < count; i++) out.push({ a: p.points[i], b: p.points[(i + 1) % n], bulge: p.bulges?.[i] ?? 0 });
  return out;
}

export function polylinePoints(p: PolylineEntity, tol = 0.01): Vec2[] {
  const out: Vec2[] = [];
  const segs = polylineSegments(p);
  if (segs.length === 0) return p.points.slice();
  out.push(segs[0].a);
  for (const s of segs) {
    const arc = bulgeToArc(s.a, s.b, s.bulge);
    if (!arc) {
      out.push(s.b);
      continue;
    }
    const pts = arcPoints(arc.center, arc.radius, arc.start, arc.end, tol);
    if (s.bulge < 0) pts.reverse();
    for (let i = 1; i < pts.length; i++) out.push(pts[i]);
  }
  return out;
}

/** Point on an ellipse at parameter t (radians). */
export function ellipsePoint(e: Pick<EllipseEntity, 'center' | 'major' | 'ratio'>, t: number): Vec2 {
  const minor = scale(perp(e.major), e.ratio);
  return add(e.center, add(scale(e.major, Math.cos(t)), scale(minor, Math.sin(t))));
}

export function ellipsePoints(e: EllipseEntity, tol = 0.01): Vec2[] {
  let span = normAngle(e.end - e.start);
  if (span === 0) span = Math.PI * 2;
  const a = Math.hypot(e.major.x, e.major.y);
  const n = arcSegments(a, span, tol);
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(ellipsePoint(e, e.start + (span * i) / n));
  return out;
}

/** De Boor's algorithm: the point of a non-rational B-spline at parameter u. */
export function splinePoint(s: Pick<SplineEntity, 'degree' | 'controlPoints' | 'knots'>, u: number): Vec2 {
  const p = s.degree;
  const U = s.knots;
  const n = s.controlPoints.length - 1;
  const uMin = U[p];
  const uMax = U[n + 1];
  if (u <= uMin) return s.controlPoints[0];
  if (u >= uMax) return s.controlPoints[n];
  // Knot span k with U[k] <= u < U[k+1].
  let k = p;
  while (k < n && U[k + 1] <= u) k++;
  const d: Vec2[] = [];
  for (let j = 0; j <= p; j++) d.push({ ...s.controlPoints[k - p + j] });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const denom = U[i + p - r + 1] - U[i];
      const alpha = denom === 0 ? 0 : (u - U[i]) / denom;
      d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y };
    }
  }
  return d[p];
}

/** Flatten a B-spline: `perSpan` samples per non-empty knot span (adaptive enough for drawing). */
export function splinePoints(s: SplineEntity, tol = 0.01): Vec2[] {
  const p = s.degree;
  const U = s.knots;
  const n = s.controlPoints.length - 1;
  if (n < 1) return s.controlPoints.slice();
  const uMin = U[p];
  const uMax = U[n + 1];
  // Sample count from the control polygon length: one sample per ~sqrt(8·tol·L/segments) is
  // overkill to derive exactly; use a dense fixed rate per span that is well below 0.01 mm for
  // drawing-sized curves and cheap enough for 100k entities (spans are few).
  const out: Vec2[] = [];
  let polyLen = 0;
  for (let i = 0; i < n; i++) polyLen += dist(s.controlPoints[i], s.controlPoints[i + 1]);
  const total = Math.min(2000, Math.max(8, Math.ceil(polyLen / Math.max(tol * 20, 0.05))));
  for (let i = 0; i <= total; i++) out.push(splinePoint(s, uMin + ((uMax - uMin) * i) / total));
  return out;
}

/** A clamped uniform knot vector for `count` control points of the given degree. */
export function clampedKnots(count: number, degree: number): number[] {
  const m = count + degree + 1;
  const inner = count - degree - 1;
  const knots: number[] = [];
  for (let i = 0; i < m; i++) {
    if (i <= degree) knots.push(0);
    else if (i >= m - degree - 1) knots.push(1);
    else knots.push((i - degree) / (inner + 1));
  }
  return knots;
}

/** Chord-length parameters in [0, 1] for fit points. */
function chordParams(pts: Vec2[]): number[] {
  const t = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1], pts[i]);
    t.push(total);
  }
  return total === 0 ? t.map((_, i) => i / Math.max(1, pts.length - 1)) : t.map((v) => v / total);
}

/** B-spline basis functions N_{i,p}(u) for the span k (Piegl & Tiller, A2.2). */
function basis(k: number, u: number, p: number, U: number[]): number[] {
  const N = new Array<number>(p + 1).fill(0);
  N[0] = 1;
  const left = new Array<number>(p + 1).fill(0);
  const right = new Array<number>(p + 1).fill(0);
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[k + 1 - j];
    right[j] = U[k + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp = denom === 0 ? 0 : N[r] / denom;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

function findSpan(n: number, p: number, u: number, U: number[]): number {
  if (u >= U[n + 1]) return n;
  let k = p;
  while (k < n && U[k + 1] <= u) k++;
  return k;
}

/**
 * Global cubic interpolation through fit points (Piegl & Tiller 9.1): returns the control points
 * and the knot vector of a clamped B-spline that passes through every fit point. For fewer than
 * degree+1 points the degree is lowered.
 */
export function interpolateSpline(fit: Vec2[], degree = 3): { degree: number; controlPoints: Vec2[]; knots: number[] } {
  const n = fit.length - 1;
  if (n < 1) return { degree: 1, controlPoints: fit.slice(), knots: [0, 0, 1, 1] };
  const p = Math.min(degree, n);
  const t = chordParams(fit);
  // Knots by averaging (Piegl & Tiller eq. 9.8).
  const m = n + p + 1;
  const U = new Array<number>(m + 1).fill(0);
  for (let i = m - p; i <= m; i++) U[i] = 1;
  for (let j = 1; j <= n - p; j++) {
    let s = 0;
    for (let i = j; i <= j + p - 1; i++) s += t[i];
    U[j + p] = s / p;
  }
  // Solve the (n+1)x(n+1) system N · P = Q with Gaussian elimination (banded, small).
  const A: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const row = new Array<number>(n + 1).fill(0);
    const k = findSpan(n, p, t[i], U);
    const N = basis(k, t[i], p, U);
    for (let j = 0; j <= p; j++) row[k - p + j] = N[j];
    A.push(row);
  }
  const P = solve(A, fit);
  return { degree: p, controlPoints: P, knots: U };
}

function solve(A: number[][], Q: Vec2[]): Vec2[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, Q[i].x, Q[i].y]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    const pv = M[c][c];
    if (Math.abs(pv) < 1e-14) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / pv;
      if (f === 0) continue;
      for (let k = c; k < n + 2; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => {
    const pv = row[i] === 0 ? 1 : row[i];
    return vec(row[n] / pv, row[n + 1] / pv);
  });
}

/** Transform helper: rotate `p` by `angle` around `center` then translate — used by tools. */
export const rotateAround = (p: Vec2, angle: number, center: Vec2): Vec2 => rotate(p, angle, center);

/** Every entity as a list of polylines (an entity may be open or closed; text gives its box). */
export function flattenEntity(e: Entity, tol = 0.01): Vec2[][] {
  switch (e.type) {
    case 'line':
      return [[e.a, e.b]];
    case 'circle':
      return [arcPoints(e.center, e.radius, 0, Math.PI * 2, tol)];
    case 'arc':
      return [arcPoints(e.center, e.radius, e.start, e.end, tol)];
    case 'polyline': {
      const pts = polylinePoints(e, tol);
      return [pts];
    }
    case 'ellipse':
      return [ellipsePoints(e, tol)];
    case 'spline':
      return [splinePoints(e, tol)];
    case 'text':
      return [textBox(e)];
  }
}

/** Approximate box of a single-line text: width ≈ 0.7·height per character (a monospace estimate). */
export function textBox(e: Entity & { type: 'text' }): Vec2[] {
  const w = Math.max(e.text.length, 1) * e.height * 0.7;
  const h = e.height;
  const corners = [vec(0, 0), vec(w, 0), vec(w, h), vec(0, h), vec(0, 0)];
  return corners.map((c) => add(e.position, rotate(c, e.rotation)));
}

export const arcOf = (a: ArcEntity): ArcGeom => ({ center: a.center, radius: a.radius, start: a.start, end: a.end });
