// Creating documents and reading them: bounds, lookups, hit tests. Nothing here mutates.

import { boxOf, boxUnion, dist, distToSegment, fromAngle, add, angleInArc, angleOf, sub, type Box, type Vec2 } from '../geometry/vec2';
import { arcPoints, ellipsePoints, flattenEntity } from '../geometry/flatten';
import { annotationPrims, DEFAULT_DIM_STYLE, type AnnotationCtx } from '../draw/annotations';
import type { Prim } from '../draw/primitives';
import { textWidth } from '../draw/primitives';
import { ANNOTATION_TYPES, FORMAT_NAME, FORMAT_VERSION, type AnnotationEntity, type Document, type Entity, type Id, type Layer } from './types';

export { DEFAULT_DIM_STYLE };

/** The default layers of a new drawing. Line types and widths from library/line-types/iso-128-2.json. */
export function defaultLayers(): Layer[] {
  return [
    // ISO 128-2 Table 1: 01.2 continuous wide for visible outlines; 0.5 mm from the width series.
    { id: '0', name: '0', color: 'auto', lineType: '01.2', lineWidth: 0.5, visible: true, locked: false },
    // 02.1 dashed narrow for hidden edges; narrow = half the wide width (ISO 128-2, 5).
    { id: 'hidden', name: 'Hidden', color: '#f0a63a', lineType: '02.1', lineWidth: 0.25, visible: true, locked: false },
    // 04.1 long-dashed dotted narrow for centre lines.
    { id: 'centre', name: 'Centre', color: '#4da3ff', lineType: '04.1', lineWidth: 0.25, visible: true, locked: false },
    // 01.1 continuous narrow for dimension, extension and leader lines.
    { id: 'dimensions', name: 'Dimensions', color: '#52c98b', lineType: '01.1', lineWidth: 0.25, visible: true, locked: false },
  ];
}

export function newDocument(name = 'Untitled'): Document {
  const layers = defaultLayers();
  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    unit: 'mm',
    name,
    standard: 'iso',
    projection: 'first',
    layers: Object.fromEntries(layers.map((l) => [l.id, l])),
    layerOrder: layers.map((l) => l.id),
    activeLayer: '0',
    entities: {},
    entityOrder: [],
    dimStyle: { ...DEFAULT_DIM_STYLE },
    sheets: {},
    sheetOrder: [],
    constraints: {},
    constraintOrder: [],
    parts: {},
    partOrder: [],
  };
}

export const entitiesInOrder = (doc: Document): Entity[] => doc.entityOrder.map((id) => doc.entities[id]).filter((e): e is Entity => e !== undefined);
export const layersInOrder = (doc: Document): Layer[] => doc.layerOrder.map((id) => doc.layers[id]).filter((l): l is Layer => l !== undefined);

export const isAnnotation = (e: Entity): e is AnnotationEntity => ANNOTATION_TYPES.has(e.type);

/** The annotation context for a document (dimension style; fits come from the library when loaded). */
export function annotationCtx(doc: Document, fit?: AnnotationCtx['fit']): AnnotationCtx {
  return { style: doc.dimStyle, fit, standard: doc.standard };
}

/** Every primitive of an annotation flattened to point lists (for bounds, picking, DXF). */
export function primPolylines(prims: Prim[], tol = 0.02): Vec2[][] {
  const out: Vec2[][] = [];
  for (const p of prims) {
    switch (p.kind) {
      case 'polyline':
        out.push(p.closed ? [...p.points, p.points[0]] : p.points);
        break;
      case 'polygon':
        out.push([...p.points, p.points[0]]);
        break;
      case 'arc':
        out.push(arcPoints(p.center, p.radius, p.start, p.end, tol));
        break;
      case 'circle':
        out.push(arcPoints(p.center, p.radius, 0, Math.PI * 2, tol));
        break;
      case 'ellipse':
        out.push(ellipsePoints({ id: '', layer: '', type: 'ellipse', center: p.center, major: p.major, ratio: p.ratio, start: p.start, end: p.end }, tol));
        break;
      case 'text': {
        const w = textWidth(p.text, p.height);
        const u = fromAngle(p.rotation);
        const v = { x: -u.y, y: u.x };
        const x0 = p.align === 'left' ? 0 : p.align === 'center' ? -w / 2 : -w;
        const c = [
          { x: x0, y: 0 },
          { x: x0 + w, y: 0 },
          { x: x0 + w, y: p.height },
          { x: x0, y: p.height },
          { x: x0, y: 0 },
        ];
        out.push(c.map((q) => add(p.position, add({ x: u.x * q.x, y: u.y * q.x }, { x: v.x * q.y, y: v.y * q.y }))));
        break;
      }
    }
  }
  return out;
}

export function entityBox(e: Entity, ctx?: AnnotationCtx): Box {
  switch (e.type) {
    case 'line':
      return boxOf([e.a, e.b]) as Box;
    case 'circle':
      return { min: { x: e.center.x - e.radius, y: e.center.y - e.radius }, max: { x: e.center.x + e.radius, y: e.center.y + e.radius } };
    case 'arc': {
      // End points plus every axis extreme that lies on the arc.
      const pts = [add(e.center, fromAngle(e.start, e.radius)), add(e.center, fromAngle(e.end, e.radius))];
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if (angleInArc(a, e.start, e.end)) pts.push(add(e.center, fromAngle(a, e.radius)));
      }
      return boxOf(pts) as Box;
    }
    case 'dimension':
    case 'note':
    case 'balloon':
    case 'surface':
    case 'gdt':
    case 'datum': {
      const pts = primPolylines(annotationPrims(e, ctx ?? { style: DEFAULT_DIM_STYLE }), 0.05).flat();
      return (boxOf(pts) ?? { min: e.position, max: e.position }) as Box;
    }
    default: {
      // Curves without a cheap closed form: the box of the flattened points (0.05 mm is plenty for bounds).
      const pts = flattenEntity(e, 0.05).flat();
      return (boxOf(pts) ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }) as Box;
    }
  }
}

export function documentBox(doc: Document, onlyVisible = true): Box | null {
  let box: Box | null = null;
  const ctx = annotationCtx(doc);
  for (const e of entitiesInOrder(doc)) {
    if (onlyVisible && doc.layers[e.layer]?.visible === false) continue;
    box = boxUnion(box, entityBox(e, ctx));
  }
  return box;
}

/** Distance from a point to a polyline (open) or polygon outline. */
export function distToPolyline(p: Vec2, pts: Vec2[], closed = false): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < best) best = d;
  }
  return best;
}

/** Distance from a point to the entity's curve, in mm (for text: to its box outline, 0 inside). */
export function distToEntity(p: Vec2, e: Entity, ctx?: AnnotationCtx): number {
  switch (e.type) {
    case 'line':
      return distToSegment(p, e.a, e.b);
    case 'circle':
      return Math.abs(dist(p, e.center) - e.radius);
    case 'arc': {
      const a = angleOf(sub(p, e.center));
      if (angleInArc(a, e.start, e.end)) return Math.abs(dist(p, e.center) - e.radius);
      const s = add(e.center, fromAngle(e.start, e.radius));
      const t = add(e.center, fromAngle(e.end, e.radius));
      return Math.min(dist(p, s), dist(p, t));
    }
    case 'text': {
      const box = flattenEntity(e)[0];
      return pointInPolygon(p, box) ? 0 : distToPolyline(p, box, true);
    }
    case 'dimension':
    case 'note':
    case 'balloon':
    case 'surface':
    case 'gdt':
    case 'datum': {
      const prims = annotationPrims(e, ctx ?? { style: DEFAULT_DIM_STYLE });
      let best = Infinity;
      for (const prim of prims) {
        const polys = primPolylines([prim], 0.02);
        for (const poly of polys) {
          const closed = prim.kind === 'text' || prim.kind === 'polygon';
          const d = closed && pointInPolygon(p, poly) ? 0 : distToPolyline(p, poly, false);
          if (d < best) best = d;
        }
      }
      return best;
    }
    default: {
      const polys = flattenEntity(e, 0.02);
      let best = Infinity;
      for (const poly of polys) best = Math.min(best, distToPolyline(p, poly, false));
      return best;
    }
  }
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

/** The topmost entity within `tolerance` mm of `p`, on a visible, unlocked layer. */
export function pick(doc: Document, p: Vec2, tolerance: number, candidates?: Iterable<Id>): Id | null {
  let best: { id: Id; d: number } | null = null;
  const ids = candidates ? [...candidates] : doc.entityOrder;
  const ctx = annotationCtx(doc);
  for (const id of ids) {
    const e = doc.entities[id];
    if (!e) continue;
    const layer = doc.layers[e.layer];
    if (!layer || !layer.visible || layer.locked) continue;
    const d = distToEntity(p, e, ctx);
    if (d <= tolerance && (!best || d <= best.d)) best = { id: e.id, d };
  }
  return best?.id ?? null;
}

export function countByType(doc: Document): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entitiesInOrder(doc)) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}
