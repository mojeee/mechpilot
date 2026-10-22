// Object snaps and polar tracking (product rule 5: smart defaults). Candidates come from the
// spatial index around the cursor; the closest snap point within the tolerance wins, with ties
// broken by kind (intersection before end point before midpoint ...).

import type { Document, Entity, Id, PointRef } from '@shared/doc/types';
import { add, dist, fromAngle, mid, sub, type Vec2 } from '@shared/geometry/vec2';
import { bulgeToArc, ellipsePoint, polylineSegments, splinePoint } from '@shared/geometry/flatten';
import { closestPointOnEntity, intersections, perpendicularFoot, tangentPointsFrom } from '@shared/geometry/intersect';
import { angleInArc, normAngle } from '@shared/geometry/vec2';
import type { SpatialIndex } from '@shared/spatial/index';
import type { SnapKind, SnapMarker } from './canvas/render';

export interface SnapSettings {
  end: boolean;
  mid: boolean;
  center: boolean;
  quadrant: boolean;
  intersection: boolean;
  perpendicular: boolean;
  tangent: boolean;
  nearest: boolean;
  polar: boolean;
  /** Polar tracking increment in radians (15° by default). */
  polarStep: number;
}

export const DEFAULT_SNAPS: SnapSettings = {
  end: true,
  mid: true,
  center: true,
  quadrant: true,
  intersection: true,
  perpendicular: true,
  tangent: true,
  nearest: false,
  polar: true,
  polarStep: Math.PI / 12,
};

const PRIORITY: Record<SnapKind, number> = { intersection: 0, end: 1, mid: 2, center: 3, quadrant: 4, perpendicular: 5, tangent: 6, polar: 7, nearest: 8, grid: 9 };

function endPoints(e: Entity): Vec2[] {
  switch (e.type) {
    case 'line':
      return [e.a, e.b];
    case 'arc':
      return [add(e.center, fromAngle(e.start, e.radius)), add(e.center, fromAngle(e.end, e.radius))];
    case 'polyline':
      return e.points;
    case 'ellipse':
      return normAngle(e.end - e.start) === 0 ? [] : [ellipsePoint(e, e.start), ellipsePoint(e, e.end)];
    case 'spline': {
      const p = e.degree;
      return [splinePoint(e, e.knots[p]), splinePoint(e, e.knots[e.controlPoints.length])];
    }
    case 'text':
      return [e.position];
    default:
      return [];
  }
}

function midPoints(e: Entity): Vec2[] {
  switch (e.type) {
    case 'line':
      return [mid(e.a, e.b)];
    case 'arc': {
      let span = normAngle(e.end - e.start);
      if (span === 0) span = Math.PI * 2;
      return [add(e.center, fromAngle(e.start + span / 2, e.radius))];
    }
    case 'polyline':
      return polylineSegments(e).map((s) => {
        const arc = bulgeToArc(s.a, s.b, s.bulge);
        if (!arc) return mid(s.a, s.b);
        let span = normAngle(arc.end - arc.start);
        if (span === 0) span = Math.PI * 2;
        return add(arc.center, fromAngle(arc.start + span / 2, arc.radius));
      });
    default:
      return [];
  }
}

function centers(e: Entity): Vec2[] {
  switch (e.type) {
    case 'circle':
    case 'arc':
    case 'ellipse':
      return [e.center];
    case 'polyline':
      return polylineSegments(e)
        .map((s) => bulgeToArc(s.a, s.b, s.bulge))
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map((a) => a.center);
    default:
      return [];
  }
}

function quadrants(e: Entity): Vec2[] {
  if (e.type === 'circle') return [0, 1, 2, 3].map((k) => add(e.center, fromAngle((k * Math.PI) / 2, e.radius)));
  if (e.type === 'arc') return [0, 1, 2, 3].map((k) => (k * Math.PI) / 2).filter((a) => angleInArc(a, e.start, e.end)).map((a) => add(e.center, fromAngle(a, e.radius)));
  if (e.type === 'ellipse') return [0, 1, 2, 3].map((k) => (k * Math.PI) / 2).filter((t) => normAngle(e.end - e.start) === 0 || angleInArc(t, e.start, e.end)).map((t) => ellipsePoint(e, t));
  return [];
}

export interface SnapQuery {
  doc: Document;
  index: SpatialIndex<Id>;
  cursor: Vec2;
  /** Snap tolerance in mm (pixels / scale). */
  tol: number;
  settings: SnapSettings;
  /** The previous tool point: perpendicular, tangent and polar tracking refer to it. */
  ref: Vec2 | null;
  exclude: ReadonlySet<Id>;
}

export interface SnapResult extends SnapMarker {
  /** For polar tracking: the line to draw from the reference point. */
  tracking?: { from: Vec2; to: Vec2 };
  /** The entity point snapped to (end, centre, vertex), so drawing tools can infer a coincident constraint. */
  ref?: PointRef;
  /** For polar tracking: the locked angle in radians. */
  angle?: number;
}

function refOf(e: Entity, kind: SnapKind, p: Vec2): PointRef | undefined {
  const same = (q: Vec2) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9;
  if (kind === 'end') {
    if (e.type === 'line') return same(e.a) ? { entity: e.id, point: 'a' } : same(e.b) ? { entity: e.id, point: 'b' } : undefined;
    if (e.type === 'arc') return same(add(e.center, fromAngle(e.start, e.radius))) ? { entity: e.id, point: 'start' } : { entity: e.id, point: 'end' };
    if (e.type === 'polyline') {
      const i = e.points.findIndex(same);
      return i >= 0 ? { entity: e.id, point: i } : undefined;
    }
  }
  if (kind === 'center' && (e.type === 'circle' || e.type === 'arc')) return { entity: e.id, point: 'center' };
  return undefined;
}

export function findSnap(q: SnapQuery): SnapResult | null {
  const { doc, cursor, tol, settings } = q;
  const ids = q.index.near(cursor, tol * 2).filter((id) => {
    if (q.exclude.has(id)) return false;
    const e = doc.entities[id];
    const layer = e && doc.layers[e.layer];
    return !!layer && layer.visible && !layer.locked;
  });
  let best: { point: Vec2; kind: SnapKind; d: number; entity?: Entity } | null = null;
  const consider = (point: Vec2, kind: SnapKind, entity?: Entity) => {
    const d = dist(point, cursor);
    if (d > tol) return;
    if (!best || PRIORITY[kind] < PRIORITY[best.kind] || (PRIORITY[kind] === PRIORITY[best.kind] && d < best.d)) best = { point, kind, d, entity };
  };
  const ents = ids.map((id) => doc.entities[id]);
  if (settings.intersection && ents.length > 1) {
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        for (const p of intersections(ents[i], ents[j])) consider(p, 'intersection');
      }
    }
  }
  for (const e of ents) {
    if (settings.end) for (const p of endPoints(e)) consider(p, 'end', e);
    if (settings.mid) for (const p of midPoints(e)) consider(p, 'mid', e);
    if (settings.center) for (const p of centers(e)) consider(p, 'center', e);
    if (settings.quadrant) for (const p of quadrants(e)) consider(p, 'quadrant', e);
    if (q.ref) {
      if (settings.perpendicular) for (const p of perpendicularFoot(q.ref, e)) consider(p, 'perpendicular', e);
      if (settings.tangent) for (const p of tangentPointsFrom(q.ref, e)) consider(p, 'tangent', e);
    }
  }
  if (!best && settings.nearest) {
    for (const e of ents) {
      const c = closestPointOnEntity(cursor, e);
      consider(c.point, 'nearest', e);
    }
  }
  if (best) {
    const b = best as { point: Vec2; kind: SnapKind; d: number; entity?: Entity };
    const ref = b.entity ? refOf(b.entity, b.kind, b.point) : undefined;
    return ref ? { point: b.point, kind: b.kind, ref } : { point: b.point, kind: b.kind };
  }
  // Polar tracking: lock onto the nearest multiple of the step angle from the reference point.
  if (settings.polar && q.ref) {
    const v = sub(cursor, q.ref);
    const len = Math.hypot(v.x, v.y);
    if (len > tol) {
      const ang = Math.atan2(v.y, v.x);
      const snapped = Math.round(ang / settings.polarStep) * settings.polarStep;
      const point = add(q.ref, fromAngle(snapped, len));
      if (dist(point, cursor) <= tol) return { point, kind: 'polar', angle: snapped, tracking: { from: q.ref, to: add(q.ref, fromAngle(snapped, len + 50 * tol)) } };
    }
  }
  return null;
}
