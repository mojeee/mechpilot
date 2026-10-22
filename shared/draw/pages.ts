// A sheet as one list of paper-space primitives: the sheet furniture plus every model entity seen
// through its views, scaled and clipped to the viewports. Used by the PDF export (and by anything
// else that wants a sheet as plain geometry, e.g. a DXF of the sheet later).

import { annotationCtx, entitiesInOrder, isAnnotation } from '../doc/document';
import type { Document, Entity, Sheet, SheetView } from '../doc/types';
import { flattenEntity } from '../geometry/flatten';
import { lineType } from '../library';
import { multiply, scaling, translation, type Matrix } from '../geometry/transform';
import type { Vec2 } from '../geometry/vec2';
import { annotationPrims } from './annotations';
import { sheetPaper, sheetPrims, viewRect } from './sheet';
import { transformPrims, type Prim } from './primitives';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Model → paper for a view: paper = view.position + (model − view.center) · scale. */
export function viewMatrix(view: SheetView): Matrix {
  return multiply(translation(view.position.x, view.position.y), multiply(scaling(view.scale), translation(-view.center.x, -view.center.y)));
}

/** Model entities as primitives in model mm, with the layer's width and ISO 128-2 dash pattern. */
export function entityPrims(e: Entity, doc: Document, tol = 0.005): Prim[] {
  const layer = doc.layers[e.layer];
  if (!layer || !layer.visible) return [];
  if (isAnnotation(e)) return annotationPrims(e, annotationCtx(doc));
  const width = layer.lineWidth;
  const lt = lineType(layer.lineType);
  const dash = lt?.pattern ? lt.pattern.map((k) => k * width) : undefined;
  if (e.type === 'text') return [{ kind: 'text', position: e.position, text: e.text, height: e.height, rotation: e.rotation, align: 'left' }];
  if (e.type === 'circle') return [{ kind: 'circle', center: e.center, radius: e.radius, width, dash }];
  if (e.type === 'arc') return [{ kind: 'arc', center: e.center, radius: e.radius, start: e.start, end: e.end, width, dash }];
  if (e.type === 'line') return [{ kind: 'polyline', points: [e.a, e.b], closed: false, width, dash }];
  if (e.type === 'ellipse') return [{ kind: 'ellipse', center: e.center, major: e.major, ratio: e.ratio, start: e.start, end: e.end, width, dash }];
  // Polylines (with arc segments) and splines: flattened within `tol`.
  return flattenEntity(e, tol).map((points) => ({ kind: 'polyline', points, closed: false, width, dash }));
}

/** Liang–Barsky clip of a segment to a rectangle; null when outside. */
function clipSegment(a: Vec2, b: Vec2, r: Rect): [Vec2, Vec2] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

const inside = (p: Vec2, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Clip a polyline to a rectangle: a list of pieces. */
function clipPolyline(points: Vec2[], closed: boolean, r: Rect): Vec2[][] {
  const pts = closed && points.length > 1 ? [...points, points[0]] : points;
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = clipSegment(pts[i], pts[i + 1], r);
    if (!seg) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    if (cur.length === 0) cur.push(seg[0]);
    else {
      const last = cur[cur.length - 1];
      if (Math.abs(last.x - seg[0].x) > 1e-9 || Math.abs(last.y - seg[0].y) > 1e-9) {
        if (cur.length > 1) out.push(cur);
        cur = [seg[0]];
      }
    }
    cur.push(seg[1]);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Clip primitives (paper mm) to a viewport. Curves are flattened first; text is kept when its anchor is inside. */
export function clipPrims(prims: Prim[], r: Rect, tol = 0.005): Prim[] {
  const out: Prim[] = [];
  const flat = (p: Prim): { points: Vec2[]; closed: boolean }[] => {
    switch (p.kind) {
      case 'polyline':
        return [{ points: p.points, closed: p.closed }];
      case 'polygon':
        return [{ points: p.points, closed: true }];
      case 'arc':
        return [{ points: flattenEntity({ id: '', layer: '', type: 'arc', center: p.center, radius: p.radius, start: p.start, end: p.end }, tol)[0], closed: false }];
      case 'circle':
        return [{ points: flattenEntity({ id: '', layer: '', type: 'circle', center: p.center, radius: p.radius }, tol)[0], closed: false }];
      case 'ellipse':
        return [{ points: flattenEntity({ id: '', layer: '', type: 'ellipse', center: p.center, major: p.major, ratio: p.ratio, start: p.start, end: p.end }, tol)[0], closed: false }];
      case 'text':
        return [];
    }
  };
  for (const p of prims) {
    if (p.kind === 'text') {
      if (inside(p.position, r)) out.push(p);
      continue;
    }
    const whole = (p.kind === 'polyline' || p.kind === 'polygon' ? p.points : []).every((q) => inside(q, r));
    if (whole && p.kind !== 'arc' && p.kind !== 'circle' && p.kind !== 'ellipse') {
      out.push(p);
      continue;
    }
    if (p.kind === 'polygon') {
      // Filled shapes straddling the border are kept whole only when any point is inside.
      if (p.points.some((q) => inside(q, r))) out.push(p);
      continue;
    }
    const width = p.width;
    const dash = p.dash;
    for (const piece of flat(p)) for (const pts of clipPolyline(piece.points, piece.closed, r)) out.push({ kind: 'polyline', points: pts, closed: false, width, dash });
  }
  return out;
}

/** The model seen through one view, as paper-space primitives clipped to the viewport. */
export function viewPrims(doc: Document, view: SheetView): Prim[] {
  const m = viewMatrix(view);
  const r = viewRect(view);
  const geometry: Prim[] = [];
  const annotations: Prim[] = [];
  for (const e of entitiesInOrder(doc)) (isAnnotation(e) ? annotations : geometry).push(...entityPrims(e, doc, 0.005 / view.scale));
  // Layer line widths and dash patterns are paper sizes (ISO 128-2 widths are printed as they
  // are, whatever the scale), so they are restored after the transform. Annotation sizes are
  // model sizes derived from paper sizes through the annotation scale, so they scale with the view.
  const scaledGeometry = transformPrims(geometry, m).map((p, i) => {
    const src = geometry[i];
    return 'width' in p && 'width' in src ? { ...p, width: src.width, dash: src.dash } : p;
  });
  return clipPrims([...scaledGeometry, ...transformPrims(annotations, m)], r);
}

export interface SheetPage {
  width: number;
  height: number;
  prims: Prim[];
  title: string;
}

/** A whole sheet as paper primitives: furniture, then each view's content. */
export function sheetPage(doc: Document, sheet: Sheet, lang: 'en' | 'it' = 'en'): SheetPage {
  const paper = sheetPaper(sheet);
  const prims: Prim[] = [...sheetPrims(sheet, lang)];
  for (const v of sheet.views) {
    prims.push(...viewPrims(doc, v));
  }
  return { width: paper.width, height: paper.height, prims, title: sheet.name };
}
