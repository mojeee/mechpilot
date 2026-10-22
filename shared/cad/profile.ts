// Sketch profiles for the 3D kernel, pure (no WebAssembly): the lines, arcs, circles, polylines,
// ellipses and splines of a sketch feature become closed loops, the loops become regions (an outer
// loop and its holes), and every loop is described as pen steps that shared/cad/build.ts replays
// with replicad's `draw()` (lineTo, threePointsArcTo, ellipseTo, bezierCurveTo) or as one of
// replicad's closed shapes (drawCircle, drawEllipse). When the entities do not close, branch or
// cross, the result says so in plain words (product rule 5) and points at the place.
//
// Planes (docs/parts.md): the 2D model space of the drawing is placed on a principal plane at an
// offset along the plane's normal:
//   XY: sketch x → X, sketch y → Y, normal +Z (a sketch seen from above reads as a top view);
//   XZ: sketch x → X, sketch y → Z, normal −Y (seen from the front, ISO 5456-2 view A, it reads as
//       a front view: the viewer stands at −Y and looks along +Y);
//   YZ: sketch x → Y, sketch y → Z, normal +X (seen from the right).
// These are replicad's plane names "XY", "XZ", "YZ" with `makePlane(name, offset)`;
// tests/cad-build.test.ts checks that both agree.

import type { Document, Entity, Id, SketchPlane } from '../doc/types';
import { arcSegments, bulgeToArc, polylineSegments, splinePoints } from '../geometry/flatten';
import { normAngle, type Vec2 } from '../geometry/vec2';
import { t } from '../i18n';

/** End points closer than this (mm) are the same point. */
export const JOIN_TOL = 1e-6;
/** Chord error (mm) when a curve has to be flattened. */
export const FLATTEN_TOL = 0.01;

/* ---------- planes ---------- */

export type Vec3 = [number, number, number];

export interface PlaneFrame {
  plane: SketchPlane;
  offset: number;
  origin: Vec3;
  /** World direction of sketch x. */
  x: Vec3;
  /** World direction of sketch y. */
  y: Vec3;
  normal: Vec3;
}

const AXES: Record<SketchPlane, { x: Vec3; y: Vec3; normal: Vec3 }> = {
  XY: { x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

export function planeFrame(plane: SketchPlane, offset = 0): PlaneFrame {
  const a = AXES[plane];
  return { plane, offset, origin: [a.normal[0] * offset, a.normal[1] * offset, a.normal[2] * offset], x: a.x, y: a.y, normal: a.normal };
}

/** A sketch point in world coordinates (mm). */
export function toWorld(f: PlaneFrame, p: Vec2): Vec3 {
  return [f.origin[0] + f.x[0] * p.x + f.y[0] * p.y, f.origin[1] + f.x[1] * p.x + f.y[1] * p.y, f.origin[2] + f.x[2] * p.x + f.y[2] * p.y];
}

/** A world point in the plane's 2D coordinates (its distance from the plane is dropped). */
export function toPlane(f: PlaneFrame, p: Vec3): Vec2 {
  const d: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  return { x: d[0] * f.x[0] + d[1] * f.x[1] + d[2] * f.x[2], y: d[0] * f.y[0] + d[1] * f.y[1] + d[2] * f.y[2] };
}

/* ---------- segments ---------- */

/** One piece of a loop, from `a` to `b`, in sketch coordinates. */
export type Segment =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  /** Circular arc through `via`; `sweep` is the signed angle from a to b (counter-clockwise > 0). */
  | { kind: 'arc'; a: Vec2; b: Vec2; via: Vec2; center: Vec2; radius: number; sweep: number }
  /** Elliptical arc: point(t) = center + major·cos t + minor·sin t, minor = major turned +90° × ratio; t from t0 by `sweep`. */
  | { kind: 'ellipse'; a: Vec2; b: Vec2; center: Vec2; major: Vec2; ratio: number; t0: number; sweep: number }
  /** Bézier curve of any degree: a, controls…, b (a B-spline split at its knots, exact). */
  | { kind: 'bezier'; a: Vec2; b: Vec2; controls: Vec2[] }
  /** A flattened curve (fallback), a and b included. */
  | { kind: 'points'; a: Vec2; b: Vec2; points: Vec2[] };

export type LoopShape =
  | { kind: 'circle'; center: Vec2; radius: number }
  /** A full ellipse; `rotation` in radians from sketch x to the major axis. */
  | { kind: 'ellipse'; center: Vec2; rx: number; ry: number; rotation: number }
  | { kind: 'path'; segments: Segment[] };

export interface ProfileLoop {
  shape: LoopShape;
  /** The entities that make the loop, in order. */
  entities: Id[];
  /** For a path loop: the entity of every segment. */
  owners: Id[];
  /** The loop flattened within FLATTEN_TOL, without repeating the first point. */
  outline: Vec2[];
  /** Signed area, mm² (counter-clockwise > 0). */
  area: number;
}

export interface ProfileRegion {
  outer: ProfileLoop;
  holes: ProfileLoop[];
}

export interface Profile {
  regions: ProfileRegion[];
  loops: ProfileLoop[];
}

export interface ProfileError {
  /** Plain words, already translated. */
  message: string;
  /** Where on the drawing (sketch coordinates). */
  at?: Vec2;
  entities: Id[];
}

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; error: ProfileError };

/** The sketch fields the profile needs (a `sketch` feature). */
export interface SketchRef {
  name: string;
  entities: Id[];
}

/* ---------- geometry helpers ---------- */

const P = (x: number, y: number): Vec2 => ({ x, y });
const near = (a: Vec2, b: Vec2, tol = JOIN_TOL): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
const TWO_PI = Math.PI * 2;

/** Numbers in messages: up to 6 decimals, no trailing zeros. */
export const fmt = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6;
  return String(Object.is(r, -0) ? 0 : r);
};

function ellipseAt(center: Vec2, major: Vec2, ratio: number, tt: number): Vec2 {
  const c = Math.cos(tt);
  const s = Math.sin(tt);
  // minor = perp(major) · ratio = (−major.y, major.x) · ratio
  return P(center.x + major.x * c - major.y * ratio * s, center.y + major.y * c + major.x * ratio * s);
}

/** Points of a segment from a to b, both included. */
export function segmentPoints(s: Segment, tol = FLATTEN_TOL): Vec2[] {
  switch (s.kind) {
    case 'line':
      return [s.a, s.b];
    case 'arc': {
      const n = arcSegments(s.radius, Math.abs(s.sweep), tol);
      const a0 = Math.atan2(s.a.y - s.center.y, s.a.x - s.center.x);
      const out = [s.a];
      for (let i = 1; i < n; i++) out.push(P(s.center.x + s.radius * Math.cos(a0 + (s.sweep * i) / n), s.center.y + s.radius * Math.sin(a0 + (s.sweep * i) / n)));
      out.push(s.b);
      return out;
    }
    case 'ellipse': {
      const n = arcSegments(Math.hypot(s.major.x, s.major.y), Math.abs(s.sweep), tol);
      const out = [s.a];
      for (let i = 1; i < n; i++) out.push(ellipseAt(s.center, s.major, s.ratio, s.t0 + (s.sweep * i) / n));
      out.push(s.b);
      return out;
    }
    case 'bezier': {
      const ctrl = [s.a, ...s.controls, s.b];
      let polyLen = 0;
      for (let i = 1; i < ctrl.length; i++) polyLen += Math.hypot(ctrl[i].x - ctrl[i - 1].x, ctrl[i].y - ctrl[i - 1].y);
      const n = Math.min(500, Math.max(8, Math.ceil(polyLen / Math.max(tol * 20, 0.05))));
      const out = [s.a];
      for (let i = 1; i < n; i++) out.push(bezierPoint(ctrl, i / n));
      out.push(s.b);
      return out;
    }
    case 'points':
      return s.points;
  }
}

/** De Casteljau. */
export function bezierPoint(ctrl: Vec2[], u: number): Vec2 {
  const pts = ctrl.map((p) => ({ ...p }));
  for (let r = 1; r < pts.length; r++) for (let i = 0; i < pts.length - r; i++) pts[i] = P((1 - u) * pts[i].x + u * pts[i + 1].x, (1 - u) * pts[i].y + u * pts[i + 1].y);
  return pts[0];
}

export function reverseSegment(s: Segment): Segment {
  switch (s.kind) {
    case 'line':
      return { kind: 'line', a: s.b, b: s.a };
    case 'arc':
      return { ...s, a: s.b, b: s.a, sweep: -s.sweep };
    case 'ellipse':
      return { ...s, a: s.b, b: s.a, t0: s.t0 + s.sweep, sweep: -s.sweep };
    case 'bezier':
      return { kind: 'bezier', a: s.b, b: s.a, controls: s.controls.slice().reverse() };
    case 'points':
      return { kind: 'points', a: s.b, b: s.a, points: s.points.slice().reverse() };
  }
}

const withEnds = (s: Segment, a: Vec2, b: Vec2): Segment => (s.kind === 'points' ? { ...s, a, b, points: [a, ...s.points.slice(1, -1), b] } : { ...s, a, b });

/**
 * A clamped non-rational B-spline split into Bézier pieces by knot insertion (Piegl & Tiller,
 * The NURBS Book, algorithm A5.6 DecomposeCurve). Null when the knot vector is not clamped.
 */
export function splineToBeziers(degree: number, cps: Vec2[], knots: number[]): Vec2[][] | null {
  const p = degree;
  const n = cps.length - 1;
  const m = n + p + 1;
  if (p < 1 || n < p || knots.length !== m + 1) return null;
  for (let i = 1; i <= p; i++) if (knots[i] !== knots[0] || knots[m - i] !== knots[m]) return null;
  const U = knots;
  const Q: Vec2[][] = [cps.slice(0, p + 1).map((c) => ({ ...c }))];
  let a = p;
  let b = p + 1;
  let nb = 0;
  const alphas: number[] = [];
  while (b < m) {
    const i = b;
    while (b < m && U[b + 1] === U[b]) b++;
    const mult = b - i + 1;
    if (mult < p) {
      const numer = U[b] - U[a];
      for (let j = p; j > mult; j--) alphas[j - mult - 1] = numer / (U[a + j] - U[a]);
      const r = p - mult;
      for (let j = 1; j <= r; j++) {
        const save = r - j;
        const s = mult + j;
        for (let k = p; k >= s; k--) {
          const alpha = alphas[k - s];
          const q = Q[nb];
          q[k] = P(alpha * q[k].x + (1 - alpha) * q[k - 1].x, alpha * q[k].y + (1 - alpha) * q[k - 1].y);
        }
        if (b < m) {
          Q[nb + 1] ??= new Array<Vec2>(p + 1);
          Q[nb + 1][save] = Q[nb][p];
        }
      }
    }
    nb++;
    if (b < m) {
      Q[nb] ??= new Array<Vec2>(p + 1);
      for (let k = p - mult; k <= p; k++) Q[nb][k] = { ...cps[b - p + k] };
      a = b;
      b++;
    }
  }
  return Q.slice(0, nb);
}

/* ---------- entities → pieces ---------- */

interface Piece {
  entity: Id;
  segments: Segment[];
  /** Labels for messages: "the end of line e7". */
  startLabel: string;
  endLabel: string;
  name: string;
}

type Prepared = { closed: ProfileLoop } | { piece: Piece } | null;

const nameOf = (e: Entity): string => {
  switch (e.type) {
    case 'line':
      return t('line {id}', { id: e.id });
    case 'arc':
      return t('arc {id}', { id: e.id });
    case 'circle':
      return t('circle {id}', { id: e.id });
    case 'polyline':
      return t('polyline {id}', { id: e.id });
    case 'ellipse':
      return t('ellipse {id}', { id: e.id });
    case 'spline':
      return t('spline {id}', { id: e.id });
    default:
      return t('entity {id}', { id: e.id });
  }
};

function endLabels(e: Entity): [string, string] {
  switch (e.type) {
    case 'line':
      return [t('the start of line {id}', { id: e.id }), t('the end of line {id}', { id: e.id })];
    case 'arc':
      return [t('the start of arc {id}', { id: e.id }), t('the end of arc {id}', { id: e.id })];
    case 'polyline':
      return [t('the start of polyline {id}', { id: e.id }), t('the end of polyline {id}', { id: e.id })];
    case 'ellipse':
      return [t('the start of ellipse {id}', { id: e.id }), t('the end of ellipse {id}', { id: e.id })];
    case 'spline':
      return [t('the start of spline {id}', { id: e.id }), t('the end of spline {id}', { id: e.id })];
    default:
      return [nameOf(e), nameOf(e)];
  }
}

function loopOf(shape: LoopShape, entities: Id[], owners: Id[] = shape.kind === 'path' ? shape.segments.map(() => entities[0]) : []): ProfileLoop {
  const outline = loopOutline(shape);
  return { shape, entities, owners, outline, area: signedArea(outline) };
}

function loopOutline(shape: LoopShape): Vec2[] {
  if (shape.kind === 'circle') {
    const n = Math.max(8, arcSegments(shape.radius, TWO_PI, FLATTEN_TOL));
    return Array.from({ length: n }, (_, i) => P(shape.center.x + shape.radius * Math.cos((TWO_PI * i) / n), shape.center.y + shape.radius * Math.sin((TWO_PI * i) / n)));
  }
  if (shape.kind === 'ellipse') {
    const n = Math.max(8, arcSegments(shape.rx, TWO_PI, FLATTEN_TOL));
    const major = P(shape.rx * Math.cos(shape.rotation), shape.rx * Math.sin(shape.rotation));
    return Array.from({ length: n }, (_, i) => ellipseAt(shape.center, major, shape.ry / shape.rx, (TWO_PI * i) / n));
  }
  const out: Vec2[] = [];
  for (const s of shape.segments) {
    const pts = segmentPoints(s);
    for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
  }
  return out;
}

export function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function splineSegments(e: Extract<Entity, { type: 'spline' }>): Segment[] {
  const beziers = splineToBeziers(e.degree, e.controlPoints, e.knots);
  if (beziers && beziers.length > 0) return beziers.map((q) => ({ kind: 'bezier', a: q[0], b: q[q.length - 1], controls: q.slice(1, -1) }));
  const pts = splinePoints(e, FLATTEN_TOL);
  return [{ kind: 'points', a: pts[0], b: pts[pts.length - 1], points: pts }];
}

function polylinePieceSegments(e: Extract<Entity, { type: 'polyline' }>): Segment[] {
  const out: Segment[] = [];
  for (const s of polylineSegments(e)) {
    if (near(s.a, s.b)) continue;
    const arc = bulgeToArc(s.a, s.b, s.bulge);
    if (!arc) {
      out.push({ kind: 'line', a: s.a, b: s.b });
      continue;
    }
    const sweep = 4 * Math.atan(s.bulge);
    const a0 = Math.atan2(s.a.y - arc.center.y, s.a.x - arc.center.x);
    const via = P(arc.center.x + arc.radius * Math.cos(a0 + sweep / 2), arc.center.y + arc.radius * Math.sin(a0 + sweep / 2));
    out.push({ kind: 'arc', a: s.a, b: s.b, via, center: arc.center, radius: arc.radius, sweep });
  }
  return out;
}

function prepare(e: Entity): Prepared {
  const [startLabel, endLabel] = endLabels(e);
  const piece = (segments: Segment[]): Prepared => (segments.length === 0 ? null : { piece: { entity: e.id, segments, startLabel, endLabel, name: nameOf(e) } });
  switch (e.type) {
    case 'line':
      return near(e.a, e.b) ? null : piece([{ kind: 'line', a: e.a, b: e.b }]);
    case 'circle':
      return e.radius > JOIN_TOL ? { closed: loopOf({ kind: 'circle', center: e.center, radius: e.radius }, [e.id]) } : null;
    case 'arc': {
      if (e.radius <= JOIN_TOL) return null;
      const span = normAngle(e.end - e.start);
      if (span === 0) return { closed: loopOf({ kind: 'circle', center: e.center, radius: e.radius }, [e.id]) };
      const at = (ang: number) => P(e.center.x + e.radius * Math.cos(ang), e.center.y + e.radius * Math.sin(ang));
      return piece([{ kind: 'arc', a: at(e.start), b: at(e.end), via: at(e.start + span / 2), center: e.center, radius: e.radius, sweep: span }]);
    }
    case 'polyline': {
      const segs = polylinePieceSegments(e);
      if (e.closed && segs.length > 0) return { closed: loopOf({ kind: 'path', segments: segs }, [e.id]) };
      return piece(segs);
    }
    case 'ellipse': {
      const rx = Math.hypot(e.major.x, e.major.y);
      if (rx <= JOIN_TOL || e.ratio <= 0) return null;
      const span = normAngle(e.end - e.start);
      if (span === 0 || Math.abs(span - TWO_PI) < 1e-12) return { closed: loopOf({ kind: 'ellipse', center: e.center, rx, ry: rx * e.ratio, rotation: Math.atan2(e.major.y, e.major.x) }, [e.id]) };
      const a = ellipseAt(e.center, e.major, e.ratio, e.start);
      const b = ellipseAt(e.center, e.major, e.ratio, e.start + span);
      return piece([{ kind: 'ellipse', a, b, center: e.center, major: e.major, ratio: e.ratio, t0: e.start, sweep: span }]);
    }
    case 'spline': {
      if (e.controlPoints.length < 2) return null;
      const segs = splineSegments(e);
      const first = segs[0].a;
      const last = segs[segs.length - 1].b;
      if (e.closed && !near(first, last)) segs.push({ kind: 'line', a: last, b: first });
      return piece(segs);
    }
    default:
      // Text and annotations are not geometry: a sketch may carry them, the profile ignores them.
      return null;
  }
}

/* ---------- chaining ---------- */

interface Node {
  p: Vec2;
  ends: { piece: number; end: 0 | 1 }[];
}

/** Clusters points within JOIN_TOL with a hash grid. */
class PointIndex {
  readonly nodes: Node[] = [];
  private grid = new Map<string, number[]>();
  private readonly cell = 1e-3;
  private key(ix: number, iy: number): string {
    return `${ix},${iy}`;
  }
  find(p: Vec2): number {
    const ix = Math.floor(p.x / this.cell);
    const iy = Math.floor(p.y / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.grid.get(this.key(ix + dx, iy + dy));
        if (list) for (const n of list) if (near(this.nodes[n].p, p)) return n;
      }
    const id = this.nodes.length;
    this.nodes.push({ p, ends: [] });
    const k = this.key(ix, iy);
    const list = this.grid.get(k);
    if (list) list.push(id);
    else this.grid.set(k, [id]);
    return id;
  }
}

const failure = (message: string, entities: Id[], at?: Vec2): ProfileResult => ({ ok: false, error: { message, entities, at } });

/**
 * The closed loops and regions of a sketch. Every curve end must meet exactly one other curve end
 * (within JOIN_TOL); loops must not cross; a loop inside an odd number of loops is a hole.
 */
export function buildProfile(doc: Pick<Document, 'entities'>, sketch: SketchRef): ProfileResult {
  const loops: ProfileLoop[] = [];
  const pieces: Piece[] = [];
  for (const id of sketch.entities) {
    const e = doc.entities[id];
    if (!e) return failure(t("The sketch '{name}' uses {id}, which is no longer in the drawing.", { name: sketch.name, id }), [id]);
    const prep = prepare(e);
    if (!prep) continue;
    if ('closed' in prep) loops.push(prep.closed);
    else pieces.push(prep.piece);
  }
  if (loops.length === 0 && pieces.length === 0) return failure(t("The sketch '{name}' has no lines, arcs or circles to make a profile.", { name: sketch.name }), []);

  // End points → nodes.
  const index = new PointIndex();
  const nodeOf: [number, number][] = pieces.map((pc, i) => {
    const a = index.find(pc.segments[0].a);
    const b = index.find(pc.segments[pc.segments.length - 1].b);
    index.nodes[a].ends.push({ piece: i, end: 0 });
    index.nodes[b].ends.push({ piece: i, end: 1 });
    return [a, b];
  });
  for (const node of index.nodes) {
    if (node.ends.length === 1) {
      const { piece, end } = node.ends[0];
      const what = end === 0 ? pieces[piece].startLabel : pieces[piece].endLabel;
      return failure(t("The sketch '{name}' is not closed: {what} at ({x}, {y}) meets nothing.", { name: sketch.name, what, x: fmt(node.p.x), y: fmt(node.p.y) }), [pieces[piece].entity], node.p);
    }
    if (node.ends.length > 2) {
      const names = [...new Set(node.ends.map((e) => pieces[e.piece].name))];
      return failure(
        t("The sketch '{name}' branches at ({x}, {y}): {list} meet there; a closed profile has exactly two curves at every corner.", { name: sketch.name, x: fmt(node.p.x), y: fmt(node.p.y), list: names.join(', ') }),
        [...new Set(node.ends.map((e) => pieces[e.piece].entity))],
        node.p,
      );
    }
  }

  // Walk the loops; every node has exactly two ends.
  const used = new Array<boolean>(pieces.length).fill(false);
  for (let start = 0; start < pieces.length; start++) {
    if (used[start]) continue;
    const segments: Segment[] = [];
    const entities: Id[] = [];
    const owners: Id[] = [];
    let piece = start;
    let forward = true;
    const startNode = nodeOf[start][0];
    for (;;) {
      used[piece] = true;
      const pc = pieces[piece];
      const [na, nb] = nodeOf[piece];
      const from: number = forward ? na : nb;
      const to: number = forward ? nb : na;
      const segs = forward ? pc.segments : pc.segments.slice().reverse().map(reverseSegment);
      // Snap the piece ends to the node points so the loop closes exactly.
      const snapped = segs.map((s, i) => withEnds(s, i === 0 ? index.nodes[from].p : s.a, i === segs.length - 1 ? index.nodes[to].p : s.b));
      segments.push(...snapped);
      for (let k = 0; k < snapped.length; k++) owners.push(pc.entity);
      entities.push(pc.entity);
      if (to === startNode) break;
      const next: Node['ends'][number] | undefined = index.nodes[to].ends.find((e) => !(e.piece === piece && e.end === (forward ? 1 : 0)));
      if (!next || used[next.piece]) break;
      piece = next.piece;
      forward = next.end === 0;
    }
    loops.push(loopOf({ kind: 'path', segments }, entities, owners));
  }

  // Loops must not cross or overlap.
  const crossing = findCrossing(loops);
  if (crossing) {
    const [la, lb] = crossing.loops;
    const nameA = entityName(doc, crossing.entities[0], la);
    const nameB = entityName(doc, crossing.entities[1], lb);
    return failure(t("The sketch '{name}' has curves that cross or overlap near ({x}, {y}): {a} and {b}.", { name: sketch.name, x: fmt(crossing.at.x), y: fmt(crossing.at.y), a: nameA, b: nameB }), crossing.entities, crossing.at);
  }

  // Nesting: a loop inside an odd number of loops is a hole of the smallest loop around it.
  const order = loops.map((_, i) => i).sort((i, j) => Math.abs(loops[j].area) - Math.abs(loops[i].area));
  const depth = new Map<number, number>();
  const parent = new Map<number, number>();
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const probe = probePoint(loops[i]);
    let best = -1;
    for (let q = 0; q < k; q++) {
      const j = order[q];
      if (pointInPolygon(probe, loops[j].outline)) best = j; // later = smaller
    }
    depth.set(i, best < 0 ? 0 : (depth.get(best) ?? 0) + 1);
    if (best >= 0) parent.set(i, best);
  }
  const regions = new Map<number, ProfileRegion>();
  for (const i of order) if ((depth.get(i) ?? 0) % 2 === 0) regions.set(i, { outer: loops[i], holes: [] });
  for (const i of order) {
    if ((depth.get(i) ?? 0) % 2 === 1) regions.get(parent.get(i) ?? -1)?.holes.push(loops[i]);
  }
  return { ok: true, profile: { regions: [...regions.values()], loops } };
}

function entityName(doc: Pick<Document, 'entities'>, id: Id, loop: ProfileLoop): string {
  const e = doc.entities[id];
  return e ? nameOf(e) : (loop.entities[0] ?? id);
}

/** A point just off the outline (the middle of its first edge): no other loop touches it. */
function probePoint(loop: ProfileLoop): Vec2 {
  const a = loop.outline[0];
  const b = loop.outline[1 % loop.outline.length];
  return P((a.x + b.x) / 2, (a.y + b.y) / 2);
}

interface Edge2 {
  a: Vec2;
  b: Vec2;
  loop: number;
  index: number;
  count: number;
  entity: Id;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Sweep and prune over the flattened loops: the first proper crossing or collinear overlap. */
function findCrossing(loops: ProfileLoop[]): { at: Vec2; loops: [ProfileLoop, ProfileLoop]; entities: [Id, Id] } | null {
  const edges: Edge2[] = [];
  loops.forEach((loop, li) => {
    const pts = loop.outline;
    // Which entity each outline point comes from, for the message.
    const owners = outlineOwners(loop);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      edges.push({ a, b, loop: li, index: i, count: pts.length, entity: owners[i] ?? loop.entities[0], minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
    }
  });
  edges.sort((p, q) => p.minX - q.minX);
  const active: Edge2[] = [];
  const eps = 1e-9;
  for (const e of edges) {
    for (let k = active.length - 1; k >= 0; k--) if (active[k].maxX < e.minX - eps) active.splice(k, 1);
    for (const o of active) {
      if (o.maxY < e.minY - eps || o.minY > e.maxY + eps) continue;
      if (o.loop === e.loop) {
        const d = Math.abs(o.index - e.index);
        if (d <= 1 || d === e.count - 1) continue;
      }
      const at = segmentsCross(o.a, o.b, e.a, e.b);
      if (at) return { at, loops: [loops[o.loop], loops[e.loop]], entities: [o.entity, e.entity] };
    }
    active.push(e);
  }
  return null;
}

function outlineOwners(loop: ProfileLoop): Id[] {
  if (loop.shape.kind !== 'path') return loop.outline.map(() => loop.entities[0]);
  const out: Id[] = [];
  loop.shape.segments.forEach((s, i) => {
    const n = segmentPoints(s).length - 1;
    for (let k = 0; k < n; k++) out.push(loop.owners[i] ?? loop.entities[0]);
  });
  return out;
}

/** The crossing point of two segments, or null; touching end points and parallel gaps are not crossings, collinear overlaps are. */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): Vec2 | null {
  const r = P(p2.x - p1.x, p2.y - p1.y);
  const s = P(q2.x - q1.x, q2.y - q1.y);
  const denom = r.x * s.y - r.y * s.x;
  const qp = P(q1.x - p1.x, q1.y - p1.y);
  const lr = Math.hypot(r.x, r.y);
  const ls = Math.hypot(s.x, s.y);
  if (lr === 0 || ls === 0) return null;
  const tol = 1e-9;
  if (Math.abs(denom) <= tol * lr * ls) {
    // Parallel: collinear and overlapping by more than a point?
    const dist = Math.abs(qp.x * r.y - qp.y * r.x) / lr;
    if (dist > JOIN_TOL) return null;
    const t0 = (qp.x * r.x + qp.y * r.y) / (lr * lr);
    const t1 = t0 + (s.x * r.x + s.y * r.y) / (lr * lr);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    if (hi - lo > JOIN_TOL / lr) return P(p1.x + r.x * ((lo + hi) / 2), p1.y + r.y * ((lo + hi) / 2));
    return null;
  }
  const tp = (qp.x * s.y - qp.y * s.x) / denom;
  const tq = (qp.x * r.y - qp.y * r.x) / denom;
  const ep = JOIN_TOL / lr;
  const eq = JOIN_TOL / ls;
  if (tp > ep && tp < 1 - ep && tq > eq && tq < 1 - eq) return P(p1.x + r.x * tp, p1.y + r.y * tp);
  return null;
}

/* ---------- other uses of a sketch ---------- */

/** Hole positions: circle centres, line end points and polyline vertices, without duplicates. */
export function holePoints(doc: Pick<Document, 'entities'>, entities: Id[]): Vec2[] {
  const out: Vec2[] = [];
  const add = (p: Vec2) => {
    if (!out.some((q) => near(p, q))) out.push(p);
  };
  for (const id of entities) {
    const e = doc.entities[id];
    if (!e) continue;
    if (e.type === 'circle') add(e.center);
    else if (e.type === 'line') {
      add(e.a);
      add(e.b);
    } else if (e.type === 'polyline') e.points.forEach(add);
  }
  return out;
}

/** True when the profile has points on both sides of the line through a and b (a revolve would self-intersect). */
export function crossesAxis(profile: Profile, a: Vec2, b: Vec2): boolean {
  const d = P(b.x - a.x, b.y - a.y);
  const l = Math.hypot(d.x, d.y);
  if (l === 0) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const loop of profile.loops)
    for (const p of loop.outline) {
      const s = ((p.x - a.x) * d.y - (p.y - a.y) * d.x) / l;
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
  return min < -JOIN_TOL && max > JOIN_TOL;
}

/** Chain open polylines whose ends meet (within `tol`) into loops; chains that do not close are returned open. */
export function chainPolylines(lines: Vec2[][], tol = 1e-5): { loops: Vec2[][]; open: Vec2[][] } {
  const loops: Vec2[][] = [];
  const open: Vec2[][] = [];
  const rest = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const same = (a: Vec2, b: Vec2) => near(a, b, tol);
  while (rest.length > 0) {
    let chain = rest.pop() as Vec2[];
    let grown = true;
    while (!same(chain[0], chain[chain.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < rest.length; i++) {
        const l = rest[i];
        const end = chain[chain.length - 1];
        if (same(l[0], end)) chain = chain.concat(l.slice(1));
        else if (same(l[l.length - 1], end)) chain = chain.concat(l.slice(0, -1).reverse());
        else if (same(l[l.length - 1], chain[0])) chain = l.slice(0, -1).concat(chain);
        else if (same(l[0], chain[0])) chain = l.slice(1).reverse().concat(chain);
        else continue;
        rest.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (chain.length > 2 && same(chain[0], chain[chain.length - 1])) loops.push(chain.slice(0, -1));
    else open.push(chain);
  }
  return { loops, open };
}

/** The pen steps of a path loop, as replicad's sketcher takes them (see shared/cad/build.ts). */
export type PenStep =
  | { op: 'line'; to: Vec2 }
  | { op: 'arc'; to: Vec2; via: Vec2 }
  /** SVG-style elliptical arc: radii, rotation of the x radius in degrees, large-arc and sweep (counter-clockwise) flags. */
  | { op: 'ellipse'; to: Vec2; rx: number; ry: number; rotation: number; long: boolean; ccw: boolean }
  | { op: 'bezier'; to: Vec2; controls: Vec2[] };

export function penSteps(segments: Segment[]): { start: Vec2; steps: PenStep[] } {
  const steps: PenStep[] = [];
  for (const s of segments) {
    switch (s.kind) {
      case 'line':
        steps.push({ op: 'line', to: s.b });
        break;
      case 'arc':
        steps.push({ op: 'arc', to: s.b, via: s.via });
        break;
      case 'ellipse': {
        const rx = Math.hypot(s.major.x, s.major.y);
        steps.push({ op: 'ellipse', to: s.b, rx, ry: rx * s.ratio, rotation: (Math.atan2(s.major.y, s.major.x) * 180) / Math.PI, long: Math.abs(s.sweep) > Math.PI, ccw: s.sweep > 0 });
        break;
      }
      case 'bezier':
        steps.push({ op: 'bezier', to: s.b, controls: s.controls });
        break;
      case 'points':
        for (let i = 1; i < s.points.length; i++) steps.push({ op: 'line', to: s.points[i] });
        break;
    }
  }
  return { start: segments[0].a, steps };
}
