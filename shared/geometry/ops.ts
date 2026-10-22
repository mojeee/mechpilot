// Modify operations on entities: offset, fillet, chamfer, trim, extend, break, arrays, and the
// measures the snaps and the properties panel need (length, midpoint, end points, centre).
//
// Everything is pure: inputs are never mutated, results are new entities. Entities that survive an
// operation keep their id; entities created by it get `ids()`. Angles are radians, arcs
// counter-clockwise, y up, lengths in mm (product rule 1: nothing is rounded).

import { entityBox, pointInPolygon } from '../doc/document';
import type { ArcEntity, EllipseEntity, Entity, LineEntity, PolylineEntity, SplineEntity } from '../doc/types';
import type { IdGen } from '../ids';
import { arcToBulge, bulgeToArc, ellipsePoint, flattenEntity, polylinePoints, polylineSegments, splinePoint } from './flatten';
import {
  bulgeFraction,
  closestOnPolyline,
  closestPointOnEntity,
  dedupe,
  splineDerivative,
  entityPrims,
  intersections,
  lineLineInfinite,
  lineParam,
  polylineSegmentPrim,
  primsIntersections,
  type Prim,
} from './intersect';
import { applyToPoint, rotation, transformEntity, translation } from './transform';
import { add, angleOf, cross, dist, dot, fromAngle, len, lerp, mid, normAngle, normalize, perp, scale, sub, type Vec2 } from './vec2';

const EPS = 1e-9;
const TWO_PI = Math.PI * 2;

/** Counter-clockwise sweep from start to end; equal angles mean a full turn. */
const sweepOf = (start: number, end: number): number => normAngle(end - start) || TWO_PI;
const onCircle = (c: Vec2, r: number, angle: number): Vec2 => add(c, fromAngle(angle, r));

// =============================================================================================
// Offset

/** A polyline segment: straight when bulge is 0, otherwise the arc of the DXF bulge. */
interface Piece {
  a: Vec2;
  b: Vec2;
  bulge: number;
}

/** Travel direction of a piece at one of its points (a→b; around the bulge arc). */
function tangentAt(p: Piece, at: Vec2): Vec2 {
  const arc = bulgeToArc(p.a, p.b, p.bulge);
  if (!arc) return normalize(sub(p.b, p.a));
  const radial = normalize(sub(at, arc.center));
  return p.bulge > 0 ? perp(radial) : scale(perp(radial), -1);
}

/**
 * The piece offset by `s` to the LEFT of its travel direction (s < 0: to the right). A straight
 * piece moves along its left normal. A bulge arc keeps its centre and included angle: a
 * counter-clockwise arc (bulge > 0) has its centre on the left, so its radius becomes r − s; a
 * clockwise one becomes r + s. Null when the radius would vanish or invert.
 */
function offsetPiece(p: Piece, s: number): Piece | null {
  const arc = bulgeToArc(p.a, p.b, p.bulge);
  if (!arc) {
    const n = perp(normalize(sub(p.b, p.a)));
    return { a: add(p.a, scale(n, s)), b: add(p.b, scale(n, s)), bulge: 0 };
  }
  const r = arc.radius - s * Math.sign(p.bulge);
  if (r <= EPS) return null;
  const k = r / arc.radius;
  return { a: add(arc.center, scale(sub(p.a, arc.center), k)), b: add(arc.center, scale(sub(p.b, arc.center), k)), bulge: p.bulge };
}

/** The piece as an infinite line or a full circle, for joining neighbours. */
function extendedPrim(p: Piece): Prim {
  const prim = polylineSegmentPrim(p.a, p.b, p.bulge);
  return prim.kind === 'seg' ? { ...prim, infinite: true } : { ...prim, full: true };
}

/** Same arc (same centre and direction) with new end points: the bulge follows the new span. */
function withEnds(p: Piece, a: Vec2, b: Vec2): Piece {
  // Ends moved by rounding only: the included angle, hence the bulge, is unchanged.
  if (p.bulge === 0 || (dist(a, p.a) <= EPS && dist(b, p.b) <= EPS)) return { a, b, bulge: p.bulge };
  const arc = bulgeToArc(p.a, p.b, p.bulge);
  if (!arc) return { a, b, bulge: 0 };
  return { a, b, bulge: arcToBulge(a, b, arc.center, p.bulge > 0) };
}

/** True when joining turned the piece around (a straight piece reversed, an arc wrapped). */
function reversed(before: Piece, after: Piece): boolean {
  if (dist(after.a, after.b) <= EPS) return true;
  if (before.bulge === 0) return dot(sub(after.b, after.a), sub(before.b, before.a)) <= 0;
  const t0 = Math.abs(4 * Math.atan(before.bulge));
  const t1 = Math.abs(4 * Math.atan(after.bulge));
  // Trimming shrinks an arc; a span that grew by more than half of the remaining turn wrapped round.
  return t1 > t0 + (TWO_PI - t0) / 2;
}

type JoinStyle = 'round' | 'miter';

interface Alive {
  index: number;
  orig: Piece;
  off: Piece;
}

/**
 * Join consecutive offset pieces at the original vertex V. With t1, t2 the travel directions
 * before and after V and `turn` the signed angle from t1 to t2:
 * - no turn (tangent continuity): the offsets meet already;
 * - the turn bends towards the offset side (s·turn > 0, a concave corner on that side): the
 *   offsets overlap and both are trimmed to their intersection;
 * - the turn bends away (a convex corner): the offsets leave a gap, closed by an arc of radius |s|
 *   around V whose included angle is the turn (bulge tan(turn/4)), or with 'miter' by extending
 *   both to their intersection.
 * Pieces that were not neighbours in the original (a piece between them was dropped) are always
 * joined at their intersection, or by a straight piece when they do not meet.
 */
function joinPieces(alive: Alive[], closed: boolean, s: number, style: JoinStyle, n: number): { pieces: Piece[]; bad: number } {
  const offs = alive.map((x) => ({ ...x.off }));
  const corners: (Piece | null)[] = alive.map(() => null);
  const joins = closed ? alive.length : alive.length - 1;
  for (let k = 0; k < joins; k++) {
    const k2 = (k + 1) % alive.length;
    const P = offs[k];
    const Q = offs[k2];
    const adjacent = (alive[k].index + 1) % n === alive[k2].index;
    const V = alive[k].orig.b;
    const t1 = tangentAt(alive[k].orig, alive[k].orig.b);
    const t2 = tangentAt(alive[k2].orig, alive[k2].orig.a);
    const turn = Math.atan2(cross(t1, t2), dot(t1, t2));
    if (adjacent && Math.abs(turn) <= 1e-9) {
      // The offsets meet already; take the end of a straight piece (exact) over an arc's (via its centre).
      const J = P.bulge !== 0 && Q.bulge === 0 ? Q.a : P.b;
      offs[k] = withEnds(offs[k], offs[k].a, J);
      offs[k2] = withEnds(offs[k2], J, offs[k2].b);
      continue;
    }
    if (adjacent && style === 'round' && s * turn < 0) {
      corners[k] = { a: P.b, b: Q.a, bulge: Math.tan(turn / 4) };
      continue;
    }
    const ref = adjacent ? V : mid(P.b, Q.a);
    const xs = primsIntersections([extendedPrim(P)], [extendedPrim(Q)]);
    if (xs.length === 0) {
      corners[k] = { a: P.b, b: Q.a, bulge: 0 };
      continue;
    }
    let X = xs[0];
    for (const x of xs) if (dist(x, ref) < dist(X, ref)) X = x;
    offs[k] = withEnds(offs[k], offs[k].a, X);
    offs[k2] = withEnds(offs[k2], X, offs[k2].b);
  }
  for (let k = 0; k < alive.length; k++) if (reversed(alive[k].off, offs[k])) return { pieces: [], bad: k };
  const pieces: Piece[] = [];
  for (let k = 0; k < alive.length; k++) {
    pieces.push(offs[k]);
    const c = corners[k];
    if (c && dist(c.a, c.b) > EPS) pieces.push(c);
  }
  return { pieces, bad: -1 };
}

/**
 * Offset a chain of pieces by s (left positive). Pieces that invert (arcs whose radius would
 * vanish) are dropped first; after joining, any piece that the joins turned around is dropped
 * too and the neighbours are joined again, as CAD programs do for short segments. Null when
 * nothing survives.
 */
function offsetChain(orig: Piece[], closed: boolean, s: number, style: JoinStyle): Piece[] | null {
  let alive: Alive[] = [];
  orig.forEach((p, index) => {
    if (dist(p.a, p.b) <= EPS) return;
    const off = offsetPiece(p, s);
    if (off) alive.push({ index, orig: p, off });
  });
  for (let iter = 0; iter <= orig.length; iter++) {
    if (alive.length === 0 || (closed && alive.length < 2)) return null;
    const { pieces, bad } = joinPieces(alive, closed, s, style, orig.length);
    if (bad < 0) return pieces;
    alive = alive.filter((_, k) => k !== bad);
  }
  return null;
}

function piecesToPolyline(base: Entity, pieces: Piece[], closed: boolean, id: string): PolylineEntity {
  const points = pieces.map((p) => p.a);
  if (!closed) points.push(pieces[pieces.length - 1].b);
  const out: PolylineEntity = { id, layer: base.layer, type: 'polyline', points, closed };
  if (pieces.some((p) => p.bulge !== 0)) out.bulges = closed ? pieces.map((p) => p.bulge) : [...pieces.map((p) => p.bulge), 0];
  return out;
}

function pieceSide(p: Piece, towards: Vec2): number {
  const arc = bulgeToArc(p.a, p.b, p.bulge);
  if (!arc) return Math.sign(cross(sub(p.b, p.a), sub(towards, p.a)));
  const d = dist(towards, arc.center) - arc.radius;
  if (d === 0) return 0;
  // A ccw arc has its centre (the inside) on the left.
  const inside = d < 0;
  return (inside ? 1 : -1) * Math.sign(p.bulge);
}

/** Signed area of a closed point loop (positive when counter-clockwise). */
function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += cross(pts[i], pts[(i + 1) % pts.length]);
  return a / 2;
}

function offsetPolylineLike(base: Entity, pts: Vec2[], bulges: number[] | undefined, closed: boolean, distance: number, towards: Vec2, style: JoinStyle, id: string): PolylineEntity | null {
  const pl: PolylineEntity = { id: base.id, layer: base.layer, type: 'polyline', points: pts, closed, bulges };
  const pieces: Piece[] = polylineSegments(pl);
  if (pieces.length === 0) return null;
  let side: number;
  if (closed) {
    const loop = polylinePoints(pl, 0.001);
    const inside = pointInPolygon(towards, loop);
    side = (inside ? 1 : -1) * Math.sign(signedArea(loop));
  } else {
    const c = closestOnPolyline(towards, pl);
    const i = Math.min(Math.floor(c.t), pieces.length - 1);
    side = pieceSide(pieces[i], towards);
  }
  if (side === 0) return null;
  const chain = offsetChain(pieces, closed, side * distance, style);
  return chain ? piecesToPolyline(base, chain, closed, id) : null;
}

/** True when offsetEntity returns a polyline approximation (ellipses and splines). */
export function offsetIsApproximate(e: Entity): boolean {
  return e.type === 'ellipse' || e.type === 'spline';
}

/**
 * The parallel curve at `distance` (> 0) on the side of `towards`.
 * - Line → line; circle → circle (null when the radius would be ≤ 0); arc → arc with the same angles.
 * - Polyline → polyline: each segment is offset (bulge arcs keep centre and angle), convex
 *   corners get an arc around the original vertex (radius = distance), concave corners are
 *   trimmed to the intersection of the neighbours, segments that invert are dropped.
 * - Ellipse and spline → a polyline offset of their flattening at 0.01 mm with sharp joins: an
 *   approximation (offsetIsApproximate), which the caller reports to the user.
 * - Text → null. Also null when `towards` lies on the curve or nothing survives the offset.
 *
 * Limits: a polyline offset is not cleaned of global self-intersections (a narrow neck offset
 * by more than half its width keeps both overlapping loops), and only pieces that turn around
 * at a join are dropped.
 */
export function offsetEntity(e: Entity, distance: number, towards: Vec2, ids: IdGen): Entity | null {
  if (!(distance > 0)) return null;
  switch (e.type) {
    case 'line': {
      const side = Math.sign(cross(sub(e.b, e.a), sub(towards, e.a)));
      if (side === 0 || dist(e.a, e.b) === 0) return null;
      const off = scale(perp(normalize(sub(e.b, e.a))), side * distance);
      return { ...e, id: ids(), a: add(e.a, off), b: add(e.b, off) };
    }
    case 'circle':
    case 'arc': {
      const d = dist(towards, e.center);
      if (d === e.radius) return null;
      const r = d < e.radius ? e.radius - distance : e.radius + distance;
      if (r <= 0) return null;
      return { ...e, id: ids(), radius: r };
    }
    case 'polyline':
      return offsetPolylineLike(e, e.points, e.bulges, e.closed, distance, towards, 'round', ids());
    case 'ellipse':
    case 'spline': {
      const pts = flattenEntity(e, 0.01)[0].slice();
      const closed = e.type === 'ellipse' ? normAngle(e.end - e.start) === 0 : e.closed;
      if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= 1e-6) pts.pop();
      return offsetPolylineLike(e, pts, undefined, closed, distance, towards, 'miter', ids());
    }
    case 'text':
      return null;
    default:
      // Annotations are not offset.
      return null;
  }
}

// =============================================================================================
// Fillet and chamfer

/** The infinite curve an entity lies on, for fillets: a line or a circle. */
type Base = { kind: 'line'; p: Vec2; u: Vec2 } | { kind: 'circle'; c: Vec2; r: number };

function baseOf(e: Entity): Base | null {
  if (e.type === 'line') {
    const l = dist(e.a, e.b);
    return l === 0 ? null : { kind: 'line', p: e.a, u: scale(sub(e.b, e.a), 1 / l) };
  }
  if (e.type === 'circle' || e.type === 'arc') return { kind: 'circle', c: e.center, r: e.radius };
  return null;
}

/** Curves at distance R from a base: the two parallel lines, or the circles of radius r + R and |r − R|. */
function offsetsOf(b: Base, R: number): Prim[] {
  if (b.kind === 'line') {
    const n = scale(perp(b.u), R);
    return [1, -1].map((k) => {
      const p = add(b.p, scale(n, k));
      return { kind: 'seg', a: p, b: add(p, b.u), infinite: true } as Prim;
    });
  }
  const out: Prim[] = [{ kind: 'arc', center: b.c, radius: b.r + R, start: 0, end: TWO_PI, full: true }];
  if (Math.abs(b.r - R) > EPS) out.push({ kind: 'arc', center: b.c, radius: Math.abs(b.r - R), start: 0, end: TWO_PI, full: true });
  return out;
}

/** Where a circle of radius R centred at C touches the base. */
function touchPoint(b: Base, C: Vec2, R: number): Vec2 {
  if (b.kind === 'line') return add(b.p, scale(b.u, dot(sub(C, b.p), b.u)));
  const u = normalize(sub(C, b.c));
  const t1 = add(b.c, scale(u, b.r));
  const t2 = sub(b.c, scale(u, b.r));
  return Math.abs(dist(C, t1) - R) <= Math.abs(dist(C, t2) - R) ? t1 : t2;
}

interface Kept {
  entity: Entity | null;
  valid: boolean;
  /** Distance from the pick to what is kept (0 when the pick is on the kept part). */
  pickDist: number;
}

/**
 * Trim or extend `e` so that it ends at T, keeping the part that leaves T in direction `keep`
 * (the direction opposite to where the fillet goes). Lines: the end point farthest along `keep`
 * is kept; invalid when no end lies that way (the fillet would need the line to turn round: the
 * radius is too large). Arcs: the arc from T in the direction of `keep`; when T is outside the
 * arc the extension must come from the nearer end. Circles stay whole.
 */
function keepFrom(e: Entity, T: Vec2, keep: Vec2, pick: Vec2): Kept {
  if (e.type === 'line') {
    const da = dot(sub(e.a, T), keep);
    const db = dot(sub(e.b, T), keep);
    const best = Math.max(da, db);
    if (best < -EPS) return { entity: null, valid: false, pickDist: Infinity };
    if (best <= EPS) return { entity: null, valid: true, pickDist: dist(pick, T) };
    const line: LineEntity = db >= da ? { ...e, a: T } : { ...e, b: T };
    return { entity: line, valid: true, pickDist: dist(pick, closestPointOnEntity(pick, line).point) };
  }
  if (e.type === 'arc') {
    const th = angleOf(sub(T, e.center));
    const ccw = dot(perp(sub(T, e.center)), keep) > 0;
    const inside = normAngle(th - e.start) <= sweepOf(e.start, e.end) + EPS / e.radius;
    if (!inside) {
      const gapAfterEnd = normAngle(th - e.end);
      const gapBeforeStart = normAngle(e.start - th);
      // Keeping counter-clockwise from T extends the start backwards, and vice versa.
      if (ccw ? gapBeforeStart > gapAfterEnd : gapAfterEnd > gapBeforeStart) return { entity: null, valid: false, pickDist: Infinity };
    }
    const arc: ArcEntity = ccw ? { ...e, start: th } : { ...e, end: th };
    if (normAngle(arc.end - arc.start) * e.radius <= EPS) return { entity: null, valid: true, pickDist: dist(pick, T) };
    return { entity: arc, valid: true, pickDist: dist(pick, closestPointOnEntity(pick, arc).point) };
  }
  // Circles are not trimmed: the pick chooses the fillet nearest to it.
  return { entity: e, valid: true, pickDist: dist(pick, T) };
}

export type FilletResult =
  | { ok: true; a: Entity | null; b: Entity | null; arc: ArcEntity | null }
  | { ok: false; reason: 'no-solution' | 'unsupported' | 'radius-too-large' | 'parallel' };

/** Trim or extend two lines to their intersection, keeping the picked side of each (radius 0). */
function cornerLines(a: LineEntity, b: LineEntity, pickA: Vec2, pickB: Vec2): FilletResult {
  const X = lineLineInfinite(a.a, a.b, b.a, b.b);
  if (!X) return { ok: false, reason: 'parallel' };
  const side = (l: LineEntity, pick: Vec2): LineEntity | null => {
    const proj = add(l.a, scale(sub(l.b, l.a), lineParam(pick, l.a, l.b)));
    let keep = sub(proj, X);
    if (len(keep) <= EPS) keep = dist(l.a, X) >= dist(l.b, X) ? sub(l.a, X) : sub(l.b, X);
    const k = keepFrom(l, X, normalize(keep), pick);
    return k.valid ? (k.entity as LineEntity | null) : l;
  };
  return { ok: true, a: side(a, pickA), b: side(b, pickB), arc: null };
}

/**
 * A fillet arc of `radius` tangent to two entities (lines, arcs, circles).
 *
 * The centre of a circle of radius R tangent to a line lies on one of the two parallels at R; tangent
 * to a circle of radius r, on the concentric circles r + R or |r − R|. Every intersection of those
 * curves is a candidate centre C; the tangent points are the feet of C on each curve, and the fillet
 * is the shorter arc of the circle (C, R) between them. Each line or arc is then trimmed or
 * extended to its tangent point, keeping the part that leads away from the fillet. Candidates
 * that would need a line to turn round, or an arc to be extended the long way, are rejected;
 * among the rest the pick points decide: the candidate whose kept parts are nearest to the picks
 * (then whose tangent points are nearest to them) wins.
 *
 * Radius 0 with two lines trims or extends both to their corner (arc: null). Circles are never
 * trimmed. Results keep the ids; the arc is new, on the layer of `a`. `a`/`b` are null when the
 * entity is used up exactly by the fillet (delete it).
 *
 * Limit: the fillet is always the minor arc of its circle, so the rare fillets of more than 180°
 * (a circle enclosing both curves) are not produced.
 */
export function fillet(a: Entity, b: Entity, radius: number, pickA: Vec2, pickB: Vec2, ids: IdGen): FilletResult {
  const A = baseOf(a);
  const B = baseOf(b);
  if (!A || !B || a.id === b.id) return { ok: false, reason: 'unsupported' };
  if (A.kind === 'line' && B.kind === 'line' && Math.abs(cross(A.u, B.u)) <= 1e-12) return { ok: false, reason: 'parallel' };
  if (!(radius >= 0)) return { ok: false, reason: 'no-solution' };
  if (radius === 0) {
    if (a.type === 'line' && b.type === 'line') return cornerLines(a, b, pickA, pickB);
    return { ok: false, reason: 'unsupported' };
  }
  const centres = primsIntersections(offsetsOf(A, radius), offsetsOf(B, radius));
  if (centres.length === 0) return { ok: false, reason: 'no-solution' };
  let best: { score: number; tie: number; a: Entity | null; b: Entity | null; arc: ArcEntity } | null = null;
  for (const C of centres) {
    const Ta = touchPoint(A, C, radius);
    const Tb = touchPoint(B, C, radius);
    if (dist(Ta, Tb) <= EPS) continue;
    const angA = angleOf(sub(Ta, C));
    const angB = angleOf(sub(Tb, C));
    const ccwFromA = normAngle(angB - angA) <= Math.PI;
    // Direction in which the fillet leaves each tangent point; the entity keeps the opposite way.
    const ra = perp(normalize(sub(Ta, C)));
    const rb = perp(normalize(sub(Tb, C)));
    const leaveA = ccwFromA ? ra : scale(ra, -1);
    const leaveB = ccwFromA ? scale(rb, -1) : rb;
    const ka = keepFrom(a, Ta, scale(leaveA, -1), pickA);
    const kb = keepFrom(b, Tb, scale(leaveB, -1), pickB);
    if (!ka.valid || !kb.valid) continue;
    const arc: ArcEntity = { id: '', layer: a.layer, type: 'arc', center: C, radius, start: ccwFromA ? angA : angB, end: ccwFromA ? angB : angA };
    const score = ka.pickDist + kb.pickDist;
    const tie = dist(Ta, pickA) + dist(Tb, pickB);
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && tie < best.tie)) best = { score, tie, a: ka.entity, b: kb.entity, arc };
  }
  if (!best) return { ok: false, reason: 'radius-too-large' };
  return { ok: true, a: best.a, b: best.b, arc: { ...best.arc, id: ids() } };
}

export type ChamferResult = { ok: true; a: LineEntity; b: LineEntity; line: LineEntity } | { ok: false; reason: 'parallel' | 'too-large' };

/**
 * A chamfer between two lines: from their intersection X, `d1` along a and `d2` along b, each
 * towards the picked part. Both lines are trimmed (or extended) to the chamfer ends, keeping the
 * picked parts; the chamfer line is new, on the layer of a. 'too-large' when a distance is
 * negative or reaches past the far end of the picked part.
 */
export function chamfer(a: LineEntity, b: LineEntity, d1: number, d2: number, pickA: Vec2, pickB: Vec2, ids: IdGen): ChamferResult {
  const X = lineLineInfinite(a.a, a.b, b.a, b.b);
  if (!X) return { ok: false, reason: 'parallel' };
  if (!(d1 >= 0) || !(d2 >= 0)) return { ok: false, reason: 'too-large' };
  const cut = (l: LineEntity, pick: Vec2, d: number): { line: LineEntity; end: Vec2 } | null => {
    const proj = add(l.a, scale(sub(l.b, l.a), lineParam(pick, l.a, l.b)));
    let dir = sub(proj, X);
    if (len(dir) <= EPS) dir = dist(l.a, X) >= dist(l.b, X) ? sub(l.a, X) : sub(l.b, X);
    const u = normalize(dir);
    const da = dot(sub(l.a, X), u);
    const db = dot(sub(l.b, X), u);
    if (Math.max(da, db) - d <= EPS) return null;
    const P = add(X, scale(u, d));
    return { line: db >= da ? { ...l, a: P } : { ...l, b: P }, end: P };
  };
  const na = cut(a, pickA, d1);
  const nb = cut(b, pickB, d2);
  if (!na || !nb) return { ok: false, reason: 'too-large' };
  return { ok: true, a: na.line, b: nb.line, line: { id: ids(), layer: a.layer, type: 'line', a: na.end, b: nb.end } };
}

// =============================================================================================
// Trim, extend, split

/** A cut on a curve: its parameter and the exact intersection point. */
interface Cut {
  s: number;
  p: Vec2;
}

function cutsOf(e: Entity, cutters: Entity[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const c of cutters) if (c.id !== e.id) pts.push(...intersections(e, c));
  return dedupe(pts);
}

/** Neighbouring cuts around parameter sp on an open range: the last below and the first above. */
function around(cuts: Cut[], sp: number): { lo: Cut | null; hi: Cut | null } {
  let lo: Cut | null = null;
  let hi: Cut | null = null;
  for (const c of cuts) {
    if (c.s < sp && (!lo || c.s > lo.s)) lo = c;
    if (c.s >= sp && (!hi || c.s < hi.s)) hi = c;
  }
  return { lo, hi };
}

/** Neighbouring cuts around sp on a closed loop of period T: the nearest behind and ahead. */
function aroundCyclic(cuts: Cut[], sp: number, T: number): { lo: Cut; hi: Cut } {
  const mod = (x: number): number => ((x % T) + T) % T;
  let lo = cuts[0];
  let hi = cuts[0];
  for (const c of cuts) {
    if (mod(sp - c.s) < mod(sp - lo.s)) lo = c;
    if (mod(c.s - sp) < mod(hi.s - sp)) hi = c;
  }
  return { lo, hi };
}

/** Parameter of a point on an ellipse: its angle in the frame of the major and minor axes. */
export function ellipseParam(e: Pick<EllipseEntity, 'center' | 'major' | 'ratio'>, p: Vec2): number {
  const a = len(e.major);
  const u = scale(e.major, 1 / a);
  const q = sub(p, e.center);
  return Math.atan2(dot(q, perp(u)) / (a * e.ratio), dot(q, u) / a);
}

/** Polyline points and bulges from cut `from` to cut `to` (to.s may exceed the segment count on a loop). */
function subPolyline(segs: Piece[], from: Cut, to: Cut): { points: Vec2[]; bulges: number[] } {
  const n = segs.length;
  const points: Vec2[] = [from.p];
  const bulges: number[] = [];
  for (let k = Math.floor(from.s); k < to.s; k++) {
    const seg = segs[((k % n) + n) % n];
    const u0 = Math.max(from.s - k, 0);
    const u1 = Math.min(to.s - k, 1);
    if (u1 - u0 <= 1e-9) continue;
    // A part of a bulge arc: the included angle scales with the fraction, so bulge' = tan(atan(b)·Δu).
    bulges.push(seg.bulge === 0 ? 0 : Math.tan(Math.atan(seg.bulge) * (u1 - u0)));
    points.push(u1 < 1 ? to.p : seg.b);
  }
  return { points, bulges };
}

function polylineFrom(e: PolylineEntity, id: string, part: { points: Vec2[]; bulges: number[] }): PolylineEntity {
  const out: PolylineEntity = { id, layer: e.layer, type: 'polyline', points: part.points, closed: false };
  if (part.bulges.some((b) => b !== 0)) out.bulges = [...part.bulges, 0];
  return out;
}

/** Polyline cut parameters: segment index + fraction (by angle on bulge arcs). */
function polylineCuts(e: PolylineEntity, pts: Vec2[]): Cut[] {
  const segs = polylineSegments(e);
  const out: Cut[] = [];
  for (const p of pts) {
    let best: Cut | null = null;
    let bestD = Infinity;
    segs.forEach((sg, i) => {
      const prim = polylineSegmentPrim(sg.a, sg.b, sg.bulge);
      const u = prim.kind === 'seg' ? Math.max(0, Math.min(1, lineParam(p, sg.a, sg.b))) : bulgeFraction(prim, sg.bulge, angleOf(sub(p, prim.center)));
      const q = prim.kind === 'seg' ? lerp(sg.a, sg.b, u) : p;
      const d = prim.kind === 'seg' ? dist(p, q) : Math.abs(dist(p, prim.center) - prim.radius);
      if (d < bestD) {
        bestD = d;
        best = { s: i + u, p };
      }
    });
    if (best) out.push(best);
  }
  return out;
}

/**
 * Trim: split `e` at its intersections with the cutters (their extents respected, nothing
 * extended) and remove the piece nearest to `pick`.
 * - Line → the remaining one or two lines; arc → arcs; circle → one arc (the removed piece is the
 *   gap; needs two cuts); open polyline → one or two polylines (bulge segments split as arcs);
 *   closed polyline → one open polyline (needs two cuts); ellipse → partial ellipses by parameter.
 * - Splines and text: null (unsupported).
 * Null also when no intersection bounds the picked piece ("nothing to trim here"). The first
 * remaining piece keeps the id of `e`, any second one gets `ids()`.
 */
export function trim(e: Entity, cutters: Entity[], pick: Vec2, ids: IdGen): Entity[] | null {
  if (e.type !== 'line' && e.type !== 'arc' && e.type !== 'circle' && e.type !== 'ellipse' && e.type !== 'polyline') return null;
  const pts = cutsOf(e, cutters);
  if (pts.length === 0) return null;
  const tolEnd = 1e-7;
  switch (e.type) {
    case 'line': {
      const cuts = pts.filter((p) => dist(p, e.a) > tolEnd && dist(p, e.b) > tolEnd).map((p) => ({ s: lineParam(p, e.a, e.b), p }));
      const { lo, hi } = around(cuts, Math.max(0, Math.min(1, lineParam(pick, e.a, e.b))));
      if (!lo && !hi) return null;
      const out: LineEntity[] = [];
      if (lo) out.push({ ...e, b: lo.p });
      if (hi) out.push({ ...e, id: out.length ? ids() : e.id, a: hi.p });
      return out;
    }
    case 'arc': {
      const span = sweepOf(e.start, e.end);
      const ps = onCircle(e.center, e.radius, e.start);
      const pe = onCircle(e.center, e.radius, e.end);
      const full = normAngle(e.end - e.start) === 0;
      const rel = (p: Vec2): number => normAngle(angleOf(sub(p, e.center)) - e.start);
      if (full) return trim({ id: e.id, layer: e.layer, type: 'circle', center: e.center, radius: e.radius }, cutters, pick, ids);
      const cuts = pts.filter((p) => dist(p, ps) > tolEnd && dist(p, pe) > tolEnd).map((p) => ({ s: rel(p), p }));
      const sp = Math.min(span, normAngle((closestPointOnEntity(pick, e).t ?? e.start) - e.start));
      const { lo, hi } = around(cuts, sp);
      if (!lo && !hi) return null;
      const out: ArcEntity[] = [];
      if (lo) out.push({ ...e, end: angleOf(sub(lo.p, e.center)) });
      if (hi) out.push({ ...e, id: out.length ? ids() : e.id, start: angleOf(sub(hi.p, e.center)) });
      return out;
    }
    case 'circle': {
      const cuts = pts.map((p) => ({ s: normAngle(angleOf(sub(p, e.center))), p }));
      if (cuts.length < 2) return null;
      const sp = normAngle(angleOf(sub(pick, e.center)));
      const { lo, hi } = aroundCyclic(cuts, sp, TWO_PI);
      // The removed gap runs from lo to hi; what remains is the arc from hi round to lo.
      return [{ id: e.id, layer: e.layer, type: 'arc', center: e.center, radius: e.radius, start: angleOf(sub(hi.p, e.center)), end: angleOf(sub(lo.p, e.center)) }];
    }
    case 'ellipse': {
      const full = normAngle(e.end - e.start) === 0;
      const par = (p: Vec2): number => ellipseParam(e, p);
      if (full) {
        const cuts = pts.map((p) => ({ s: normAngle(par(p)), p }));
        if (cuts.length < 2) return null;
        const sp = normAngle(closestPointOnEntity(pick, e).t ?? 0);
        const { lo, hi } = aroundCyclic(cuts, sp, TWO_PI);
        return [{ ...e, start: par(hi.p), end: par(lo.p) }];
      }
      const span = sweepOf(e.start, e.end);
      const p0 = ellipsePoint(e, e.start);
      const p1 = ellipsePoint(e, e.end);
      const cuts = pts.filter((p) => dist(p, p0) > 1e-6 && dist(p, p1) > 1e-6).map((p) => ({ s: normAngle(par(p) - e.start), p }));
      const sp = Math.min(span, normAngle((closestPointOnEntity(pick, e).t ?? e.start) - e.start));
      const { lo, hi } = around(cuts, sp);
      if (!lo && !hi) return null;
      const out: EllipseEntity[] = [];
      if (lo) out.push({ ...e, end: e.start + lo.s });
      if (hi) out.push({ ...e, id: out.length ? ids() : e.id, start: e.start + hi.s });
      return out;
    }
    case 'polyline': {
      const segs = polylineSegments(e);
      const n = segs.length;
      if (n === 0) return null;
      const sp = closestOnPolyline(pick, e).t;
      if (!e.closed) {
        const first = e.points[0];
        const last = e.points[e.points.length - 1];
        const cuts = polylineCuts(e, pts.filter((p) => dist(p, first) > tolEnd && dist(p, last) > tolEnd));
        const { lo, hi } = around(cuts, sp);
        if (!lo && !hi) return null;
        const out: PolylineEntity[] = [];
        if (lo) out.push(polylineFrom(e, e.id, subPolyline(segs, { s: 0, p: first }, lo)));
        if (hi) out.push(polylineFrom(e, out.length ? ids() : e.id, subPolyline(segs, hi, { s: n, p: last })));
        return out;
      }
      const cuts = polylineCuts(e, pts).map((c) => (c.s >= n ? { s: c.s - n, p: c.p } : c));
      if (cuts.length < 2) return null;
      const { lo, hi } = aroundCyclic(cuts, sp % n, n);
      const to = lo.s > hi.s ? lo : { s: lo.s + n, p: lo.p };
      return [polylineFrom(e, e.id, subPolyline(segs, hi, to))];
    }
  }
}

/**
 * Extend the end of `e` nearer to `pick` to the first boundary it reaches: lines along their
 * direction, arcs along their circle, open polylines through their end segment (straight or bulge
 * arc). The boundaries keep their extents; `e` is extended without limit. Null when nothing is
 * reached, and for circles, closed polylines, ellipses, splines and text.
 */
export function extend(e: Entity, boundaries: Entity[], pick: Vec2): Entity | null {
  const bPrims = boundaries.filter((b) => b.id !== e.id).flatMap((b) => entityPrims(b));
  if (bPrims.length === 0) return null;
  switch (e.type) {
    case 'line': {
      const atB = dist(pick, e.b) < dist(pick, e.a);
      const end = extendSegEnd({ a: e.a, b: e.b, bulge: 0 }, atB, bPrims);
      if (!end) return null;
      return atB ? { ...e, b: end.p } : { ...e, a: end.p };
    }
    case 'arc': {
      if (normAngle(e.end - e.start) === 0) return null;
      const ps = onCircle(e.center, e.radius, e.start);
      const pe = onCircle(e.center, e.radius, e.end);
      const atEnd = dist(pick, pe) < dist(pick, ps);
      const xs = primsIntersections([{ kind: 'arc', center: e.center, radius: e.radius, start: 0, end: TWO_PI, full: true }], bPrims);
      const gap = TWO_PI - sweepOf(e.start, e.end);
      let best: { delta: number; angle: number } | null = null;
      for (const x of xs) {
        const th = angleOf(sub(x, e.center));
        const delta = atEnd ? normAngle(th - e.end) : normAngle(e.start - th);
        const slack = EPS / e.radius;
        if (delta <= slack || delta >= gap - slack) continue;
        if (!best || delta < best.delta) best = { delta, angle: th };
      }
      if (!best) return null;
      return atEnd ? { ...e, end: best.angle } : { ...e, start: best.angle };
    }
    case 'polyline': {
      if (e.closed || e.points.length < 2) return null;
      const segs = polylineSegments(e);
      const n = e.points.length;
      const atLast = dist(pick, e.points[n - 1]) < dist(pick, e.points[0]);
      const seg = atLast ? segs[segs.length - 1] : segs[0];
      const end = extendSegEnd(seg, atLast, bPrims);
      if (!end) return null;
      const points = e.points.slice();
      const bulges = e.bulges ? e.bulges.slice() : undefined;
      if (atLast) points[n - 1] = end.p;
      else points[0] = end.p;
      if (bulges) bulges[atLast ? n - 2 : 0] = end.bulge;
      const out: PolylineEntity = { ...e, points };
      if (bulges) out.bulges = bulges;
      return out;
    }
    default:
      return null;
  }
}

/**
 * Move one end of a segment (straight or bulge arc) to the first boundary point beyond it. A
 * straight segment follows its line; a bulge arc follows its circle in its own direction of
 * travel and its included angle grows by the extension (bulge = tan(θ/4)).
 */
function extendSegEnd(seg: Piece, atB: boolean, bPrims: Prim[]): { p: Vec2; bulge: number } | null {
  const arc = bulgeToArc(seg.a, seg.b, seg.bulge);
  if (!arc) {
    const xs = primsIntersections([{ kind: 'seg', a: seg.a, b: seg.b, infinite: true }], bPrims);
    const l = dist(seg.a, seg.b);
    if (l === 0) return null;
    const slack = EPS / l;
    let best: { t: number; p: Vec2 } | null = null;
    for (const x of xs) {
      const t = lineParam(x, seg.a, seg.b);
      const beyond = atB ? t - 1 : -t;
      if (beyond <= slack) continue;
      if (!best || beyond < best.t) best = { t: beyond, p: x };
    }
    return best ? { p: best.p, bulge: 0 } : null;
  }
  const dir = Math.sign(seg.bulge);
  const theta = Math.abs(4 * Math.atan(seg.bulge));
  const angA = angleOf(sub(seg.a, arc.center));
  const angB = angleOf(sub(seg.b, arc.center));
  const xs = primsIntersections([{ kind: 'arc', center: arc.center, radius: arc.radius, start: 0, end: TWO_PI, full: true }], bPrims);
  const slack = EPS / arc.radius;
  let best: { delta: number; p: Vec2 } | null = null;
  for (const x of xs) {
    const th = angleOf(sub(x, arc.center));
    const delta = atB ? normAngle(dir * (th - angB)) : normAngle(dir * (angA - th));
    if (delta <= slack || delta >= TWO_PI - theta - slack) continue;
    if (!best || delta < best.delta) best = { delta, p: x };
  }
  return best ? { p: best.p, bulge: dir * Math.tan((theta + best.delta) / 4) } : null;
}

/**
 * Break an entity at the point of it nearest to p: two pieces for lines, arcs, open polylines,
 * partial ellipses and open splines (knot insertion, so the pieces are exactly the original
 * curve). A circle becomes one full arc starting and ending at p (start = end); a full ellipse
 * likewise; a closed polyline becomes one open polyline from p round to p. When p is at an end, or
 * for text and closed splines, the entity is returned unchanged. The first piece keeps the id.
 */
export function splitAt(e: Entity, p: Vec2, ids: IdGen): Entity[] {
  switch (e.type) {
    case 'line': {
      const t = lineParam(p, e.a, e.b);
      const P = add(e.a, scale(sub(e.b, e.a), t));
      if (dist(P, e.a) <= EPS || dist(P, e.b) <= EPS || t < 0 || t > 1) return [e];
      return [
        { ...e, b: P },
        { ...e, id: ids(), a: P },
      ];
    }
    case 'circle': {
      const th = angleOf(sub(p, e.center));
      return [{ id: e.id, layer: e.layer, type: 'arc', center: e.center, radius: e.radius, start: th, end: th }];
    }
    case 'arc': {
      if (normAngle(e.end - e.start) === 0) {
        const th = angleOf(sub(p, e.center));
        return [{ ...e, start: th, end: th }];
      }
      const c = closestPointOnEntity(p, e);
      const th = c.t ?? e.start;
      const rel = normAngle(th - e.start);
      if (rel * e.radius <= EPS || (sweepOf(e.start, e.end) - rel) * e.radius <= EPS) return [e];
      return [
        { ...e, end: th },
        { ...e, id: ids(), start: th },
      ];
    }
    case 'ellipse': {
      const t = closestPointOnEntity(p, e).t ?? e.start;
      if (normAngle(e.end - e.start) === 0) return [{ ...e, start: t, end: t }];
      const rel = normAngle(t - e.start);
      if (rel <= 1e-12 || sweepOf(e.start, e.end) - rel <= 1e-12) return [e];
      return [
        { ...e, end: e.start + rel },
        { ...e, id: ids(), start: e.start + rel },
      ];
    }
    case 'polyline': {
      const segs = polylineSegments(e);
      const n = segs.length;
      if (n === 0) return [e];
      const c = closestOnPolyline(p, e);
      const cut = { s: c.t, p: c.point };
      if (e.closed) {
        const s = c.t % n;
        return [polylineFrom(e, e.id, subPolyline(segs, { s, p: c.point }, { s: s + n, p: c.point }))];
      }
      const first = e.points[0];
      const last = e.points[e.points.length - 1];
      if (dist(c.point, first) <= EPS || dist(c.point, last) <= EPS) return [e];
      return [polylineFrom(e, e.id, subPolyline(segs, { s: 0, p: first }, cut)), polylineFrom(e, ids(), subPolyline(segs, cut, { s: n, p: last }))];
    }
    case 'spline': {
      if (e.closed) return [e];
      const u = closestPointOnEntity(p, e).t;
      const n = e.controlPoints.length - 1;
      const u0 = e.knots[e.degree];
      const u1 = e.knots[n + 1];
      if (u === undefined || u - u0 <= 1e-12 * Math.max(1, Math.abs(u1 - u0)) || u1 - u <= 1e-12 * Math.max(1, Math.abs(u1 - u0))) return [e];
      const [left, right] = splitSpline(e, u);
      // The fit points no longer describe the pieces (re-interpolating would change them): dropped.
      const { fitPoints: _dropped, ...base } = e;
      return [
        { ...base, controlPoints: left.controlPoints, knots: left.knots },
        { ...base, id: ids(), controlPoints: right.controlPoints, knots: right.knots },
      ];
    }
    case 'text':
      return [e];
    default:
      return [e];
  }
}

/** Boehm knot insertion: the same curve with one more knot u (Piegl & Tiller A5.1, r = 1). */
function insertKnot(degree: number, cps: Vec2[], knots: number[], u: number): { controlPoints: Vec2[]; knots: number[] } {
  const p = degree;
  const n = cps.length - 1;
  let k = p;
  while (k < n && knots[k + 1] <= u) k++;
  const out: Vec2[] = [];
  for (let i = 0; i <= n + 1; i++) {
    if (i <= k - p) out.push(cps[i]);
    else if (i > k) out.push(cps[i - 1]);
    else {
      const den = knots[i + p] - knots[i];
      const alpha = den === 0 ? 0 : (u - knots[i]) / den;
      out.push(lerp(cps[i - 1], cps[i], alpha));
    }
  }
  return { controlPoints: out, knots: [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)] };
}

/**
 * Split a clamped B-spline at u: insert u until its multiplicity is the degree, then the control
 * point at index r − 1 (r the first index of u in the knots) is the curve point at u and is shared
 * by the two clamped halves.
 */
function splitSpline(s: SplineEntity, u: number): [{ controlPoints: Vec2[]; knots: number[] }, { controlPoints: Vec2[]; knots: number[] }] {
  const p = s.degree;
  let cur = { controlPoints: s.controlPoints.slice(), knots: s.knots.slice() };
  const mult = s.knots.filter((k) => k === u).length;
  for (let i = mult; i < p; i++) cur = insertKnot(p, cur.controlPoints, cur.knots, u);
  const r = cur.knots.indexOf(u);
  const rep = new Array<number>(p + 1).fill(u);
  const left = { controlPoints: cur.controlPoints.slice(0, r), knots: [...cur.knots.slice(0, r), ...rep] };
  const right = { controlPoints: cur.controlPoints.slice(r - 1), knots: [...rep, ...cur.knots.slice(r + p)] };
  return [left, right];
}

// =============================================================================================
// Arrays

/**
 * Rectangular array: rows × cols copies at steps (dx, dy), the original position (row 0, col 0)
 * excluded. Copies get new ids, in row-major order.
 */
export function arrayRectangular(entities: Entity[], rows: number, cols: number, dy: number, dx: number, ids: IdGen): Entity[] {
  const out: Entity[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      const m = translation(c * dx, r * dy);
      for (const e of entities) out.push({ ...transformEntity(e, m), id: ids() });
    }
  }
  return out;
}

/**
 * Polar array: `count` items in total including the original, so count − 1 copies. A total angle
 * of a full turn (|totalAngle| ≥ 2π) spreads them evenly (step = totalAngle / count, so no copy
 * lands on the original); otherwise the first and last items are totalAngle apart (step =
 * totalAngle / (count − 1)). Negative angles go clockwise. With `rotateItems` each copy is rotated
 * about `center`; without, each copy is only moved so that the centre of the selection's bounding
 * box follows the circle (the group keeps its orientation).
 */
export function arrayPolar(entities: Entity[], center: Vec2, count: number, totalAngle: number, rotateItems: boolean, ids: IdGen): Entity[] {
  if (count < 2 || entities.length === 0) return [];
  const full = Math.abs(totalAngle) >= TWO_PI - 1e-12;
  const step = full ? totalAngle / count : totalAngle / (count - 1);
  let ref: Vec2 = center;
  if (!rotateItems) {
    const boxes = entities.map((e) => entityBox(e));
    const min = { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)) };
    const max = { x: Math.max(...boxes.map((b) => b.max.x)), y: Math.max(...boxes.map((b) => b.max.y)) };
    ref = mid(min, max);
  }
  const out: Entity[] = [];
  for (let i = 1; i < count; i++) {
    const angle = step * i;
    let m = rotation(angle, center);
    if (!rotateItems) {
      const moved = applyToPoint(m, ref);
      m = translation(moved.x - ref.x, moved.y - ref.y);
    }
    for (const e of entities) out.push({ ...transformEntity(e, m), id: ids() });
  }
  return out;
}

// =============================================================================================
// Measures

// Gauss–Legendre, 5 nodes on [−1, 1] (exact for polynomials up to degree 9).
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL_W = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

function gauss(f: (t: number) => number, a: number, b: number): number {
  const h = (b - a) / 2;
  const m = (a + b) / 2;
  let s = 0;
  for (let i = 0; i < 5; i++) s += GL_W[i] * f(m + h * GL_X[i]);
  return s * h;
}

/** A curve given by its speed |x'(t)| on [t0, t1], split into intervals for integration. */
interface Speed {
  f: (t: number) => number;
  breaks: number[];
}

function lengthOfSpeed(sp: Speed): number {
  let s = 0;
  for (let i = 0; i + 1 < sp.breaks.length; i++) s += gauss(sp.f, sp.breaks[i], sp.breaks[i + 1]);
  return s;
}

/** The parameter where the arc length from the start reaches `target` (bisection inside an interval). */
function paramAtLength(sp: Speed, target: number): number {
  let acc = 0;
  for (let i = 0; i + 1 < sp.breaks.length; i++) {
    const a = sp.breaks[i];
    const b = sp.breaks[i + 1];
    const piece = gauss(sp.f, a, b);
    if (acc + piece >= target || i + 2 === sp.breaks.length) {
      let lo = a;
      let hi = b;
      for (let k = 0; k < 100; k++) {
        const m = (lo + hi) / 2;
        if (acc + gauss(sp.f, a, m) < target) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
    acc += piece;
  }
  return sp.breaks[sp.breaks.length - 1];
}

function splitRange(t0: number, t1: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(t0 + ((t1 - t0) * i) / n);
  return out;
}

function ellipseSpeed(e: EllipseEntity): Speed {
  // x'(t) = −major·sin t + minor·cos t, with |major| = a and |minor| = a·ratio perpendicular to it.
  const a = len(e.major);
  const b = a * e.ratio;
  const span = sweepOf(e.start, e.end);
  return { f: (t) => Math.hypot(a * Math.sin(t), b * Math.cos(t)), breaks: splitRange(e.start, e.start + span, Math.max(8, Math.ceil((span / TWO_PI) * 128))) };
}

/** Speed of a B-spline from its derivative spline, integrated span by span (16 pieces each). */
function splineSpeed(s: SplineEntity): Speed {
  const p = s.degree;
  const U = s.knots;
  const n = s.controlPoints.length - 1;
  const d = splineDerivative(s);
  const breaks: number[] = [];
  const spans = Array.from(new Set(U.slice(p, n + 2)));
  for (let i = 0; i + 1 < spans.length; i++) {
    const r = splitRange(spans[i], spans[i + 1], 16);
    if (i > 0) r.shift();
    breaks.push(...r);
  }
  return { f: (u) => len(splinePoint(d, u)), breaks };
}

/** Length of the curve in mm (the perimeter for closed curves; 0 for text). */
export function lengthOf(e: Entity): number {
  switch (e.type) {
    case 'line':
      return dist(e.a, e.b);
    case 'circle':
      return TWO_PI * e.radius;
    case 'arc':
      return e.radius * sweepOf(e.start, e.end);
    case 'polyline': {
      let s = 0;
      for (const sg of polylineSegments(e)) {
        const arc = bulgeToArc(sg.a, sg.b, sg.bulge);
        s += arc ? arc.radius * Math.abs(4 * Math.atan(sg.bulge)) : dist(sg.a, sg.b);
      }
      return s;
    }
    case 'ellipse':
      return lengthOfSpeed(ellipseSpeed(e));
    case 'spline':
      return e.controlPoints.length < 2 || e.degree < 1 ? 0 : lengthOfSpeed(splineSpeed(e));
    case 'text':
      return 0;
    default:
      return 0;
  }
}

/**
 * The point halfway along the curve: lines, arcs, partial ellipses and open splines (by arc
 * length). Null for circles, full ellipses, closed splines, polylines (the snap code handles
 * their segments) and text.
 */
export function midpointOf(e: Entity): Vec2 | null {
  switch (e.type) {
    case 'line':
      return mid(e.a, e.b);
    case 'arc':
      return onCircle(e.center, e.radius, e.start + sweepOf(e.start, e.end) / 2);
    case 'ellipse': {
      if (normAngle(e.end - e.start) === 0) return null;
      const sp = ellipseSpeed(e);
      return ellipsePoint(e, paramAtLength(sp, lengthOfSpeed(sp) / 2));
    }
    case 'spline': {
      if (e.closed || e.controlPoints.length < 2 || e.degree < 1) return null;
      const sp = splineSpeed(e);
      return splinePoint(e, paramAtLength(sp, lengthOfSpeed(sp) / 2));
    }
    default:
      return null;
  }
}

/**
 * End points for the endpoint snap: line ends, arc ends, every polyline vertex (segment ends),
 * partial-ellipse ends, open-spline ends. Circles, full ellipses, closed splines and text: none.
 */
export function endpointsOf(e: Entity): Vec2[] {
  switch (e.type) {
    case 'line':
      return [e.a, e.b];
    case 'arc':
      return normAngle(e.end - e.start) === 0 ? [] : [onCircle(e.center, e.radius, e.start), onCircle(e.center, e.radius, e.end)];
    case 'polyline':
      return e.points.slice();
    case 'ellipse':
      return normAngle(e.end - e.start) === 0 ? [] : [ellipsePoint(e, e.start), ellipsePoint(e, e.end)];
    case 'spline':
      return e.closed || e.controlPoints.length === 0 ? [] : [e.controlPoints[0], e.controlPoints[e.controlPoints.length - 1]];
    default:
      return [];
  }
}

/** Centre of circles, arcs and ellipses; null otherwise. */
export function centerOf(e: Entity): Vec2 | null {
  return e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse' ? e.center : null;
}

