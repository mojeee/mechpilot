// Our own 2D renderer on Canvas 2D (CLAUDE.md, Stack). Geometry stays in mm; one affine transform
// maps it to pixels. Line widths are true to scale with a 1 px floor so narrow lines stay visible.
// Dash patterns come from ISO 128-2 Table 4 through the library (multiples of the line width).
// Entities are drawn in drawing order but batched by style (one stroke per run of equal style),
// and only the entities whose box meets the view are drawn (the spatial index culls them).

import type { Document, Entity, Id, Layer } from '@shared/doc/types';
import { arcPoints, bulgeToArc, ellipsePoints, polylineSegments, splinePoints } from '@shared/geometry/flatten';
import { lineType } from '@shared/library';
import type { Vec2 } from '@shared/geometry/vec2';
import { worldToScreen, type ViewState } from '../state/store';

export interface Palette {
  background: string;
  foreground: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  selection: string;
  preview: string;
  snap: string;
  cursor: string;
  box: string;
}

export type SnapKind = 'end' | 'mid' | 'center' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest' | 'grid' | 'polar' | 'quadrant';
export interface SnapMarker {
  point: Vec2;
  kind: SnapKind;
}

export interface Scene {
  doc: Document;
  view: ViewState;
  size: { w: number; h: number };
  dpr: number;
  /** Entities to draw, in drawing order (already culled). */
  visible: Id[];
  selection: ReadonlySet<Id>;
  /** Selected entities to highlight (the selection, culled to the view when it is large). */
  selected: Id[];
  hover: Id | null;
  gridOn: boolean;
  gridStep: number;
  cursor: Vec2 | null;
  /** Entities being drawn or moved (rubber band). */
  preview: Entity[];
  snap: SnapMarker | null;
  /** Polar tracking line from a point along an angle, when active. */
  tracking: { from: Vec2; to: Vec2 } | null;
  /** Window/crossing selection rectangle in world mm; crossing = right to left. */
  selectBox: { a: Vec2; b: Vec2; crossing: boolean } | null;
  palette: Palette;
}

export function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v('--canvas-bg'),
    foreground: v('--canvas-fg'),
    gridMinor: v('--grid-minor'),
    gridMajor: v('--grid-major'),
    axis: v('--grid-axis'),
    selection: v('--sel'),
    preview: v('--snap'),
    snap: v('--snap'),
    cursor: v('--canvas-fg'),
    box: v('--accent'),
  };
}

/** Add the entity's path to the current canvas path (no stroke). */
export function tracePath(ctx: CanvasRenderingContext2D, e: Entity, view: ViewState): void {
  const S = (p: Vec2) => worldToScreen(view, p);
  switch (e.type) {
    case 'line': {
      const a = S(e.a);
      const b = S(e.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      break;
    }
    case 'circle': {
      const c = S(e.center);
      ctx.moveTo(c.x + e.radius * view.scale, c.y);
      ctx.arc(c.x, c.y, e.radius * view.scale, 0, Math.PI * 2);
      break;
    }
    case 'arc': {
      // Screen y points down, so a counter-clockwise world arc is clockwise on screen.
      const c = S(e.center);
      const r = e.radius * view.scale;
      ctx.moveTo(c.x + r * Math.cos(e.start), c.y - r * Math.sin(e.start));
      ctx.arc(c.x, c.y, r, -e.start, -e.end, true);
      break;
    }
    case 'polyline': {
      const segs = polylineSegments(e);
      if (e.points.length === 0) break;
      const p0 = S(e.points[0]);
      ctx.moveTo(p0.x, p0.y);
      for (const s of segs) {
        const arc = bulgeToArc(s.a, s.b, s.bulge);
        if (!arc) {
          const b = S(s.b);
          ctx.lineTo(b.x, b.y);
        } else {
          const c = S(arc.center);
          const r = arc.radius * view.scale;
          // bulge > 0: ccw from a to b (arc.start at a); bulge < 0: the ccw arc runs b→a, so draw it clockwise a→b.
          if (s.bulge > 0) ctx.arc(c.x, c.y, r, -arc.start, -arc.end, true);
          else ctx.arc(c.x, c.y, r, -arc.end, -arc.start, false);
        }
      }
      if (e.closed) ctx.closePath();
      break;
    }
    case 'ellipse': {
      const pts = ellipsePoints(e, Math.max(0.002, 0.25 / view.scale));
      polyPath(ctx, pts.map(S), false);
      break;
    }
    case 'spline': {
      const pts = splinePoints(e, Math.max(0.002, 0.25 / view.scale));
      polyPath(ctx, pts.map(S), e.closed);
      break;
    }
    case 'text':
      // Text is filled, not stroked: see drawText.
      break;
  }
}

function polyPath(ctx: CanvasRenderingContext2D, pts: Vec2[], closed: boolean): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (closed) ctx.closePath();
}

function drawText(ctx: CanvasRenderingContext2D, e: Entity & { type: 'text' }, view: ViewState, color: string): void {
  const p = worldToScreen(view, e.position);
  const px = e.height * view.scale;
  if (px < 2) {
    // Too small to read: a thin line of the text's length keeps the layout visible.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const w = e.text.length * e.height * 0.7 * view.scale;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + w * Math.cos(e.rotation), p.y - w * Math.sin(e.rotation));
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-e.rotation);
  ctx.fillStyle = color;
  // ISO 3098 lettering is not bundled; a plain sans-serif at the cap height (≈ 0.72 em) stands in.
  ctx.font = `${px / 0.72}px ${getComputedStyle(ctx.canvas).getPropertyValue('--font-ui') || 'sans-serif'}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(e.text, 0, 0);
  ctx.restore();
}

function dashFor(layer: Layer, scale: number): number[] {
  const lt = lineType(layer.lineType);
  if (!lt?.pattern) return [];
  const d = layer.lineWidth * scale;
  // Below ~0.4 px per width unit the pattern would be sub-pixel noise: draw continuous.
  if (d * 3 < 1.2) return [];
  return lt.pattern.map((k) => k * d);
}

function drawGrid(ctx: CanvasRenderingContext2D, s: Scene): void {
  const { view, size, gridStep, palette } = s;
  const minor = gridStep;
  const major = gridStep * 10;
  const left = (0 - view.origin.x) / view.scale;
  const right = (size.w - view.origin.x) / view.scale;
  const top = (view.origin.y - 0) / view.scale;
  const bottom = (view.origin.y - size.h) / view.scale;
  const lines = (step: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      const sx = Math.round(view.origin.x + x * view.scale) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, size.h);
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      const sy = Math.round(view.origin.y - y * view.scale) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(size.w, sy);
    }
    ctx.stroke();
  };
  if (minor * view.scale >= 6) lines(minor, palette.gridMinor);
  lines(major, palette.gridMajor);
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ox = Math.round(view.origin.x) + 0.5;
  const oy = Math.round(view.origin.y) + 0.5;
  if (ox >= 0 && ox <= size.w) {
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, size.h);
  }
  if (oy >= 0 && oy <= size.h) {
    ctx.moveTo(0, oy);
    ctx.lineTo(size.w, oy);
  }
  ctx.stroke();
}

/** Draw a list of entities, batching runs of equal style into one stroke. */
function drawEntities(ctx: CanvasRenderingContext2D, doc: Document, ids: Iterable<Id>, view: ViewState, palette: Palette, override?: { color: string; widthPx: number; dash: number[] }): void {
  let open = false;
  let key = '';
  const flush = () => {
    if (open) ctx.stroke();
    open = false;
  };
  for (const id of ids) {
    const e = doc.entities[id];
    if (!e) continue;
    const layer = doc.layers[e.layer];
    if (!layer || !layer.visible) continue;
    const color = override?.color ?? (layer.color === 'auto' ? palette.foreground : layer.color);
    if (e.type === 'text') {
      flush();
      key = '';
      drawText(ctx, e, view, color);
      continue;
    }
    const widthPx = override?.widthPx ?? Math.max(1, layer.lineWidth * view.scale);
    const dash = override?.dash ?? dashFor(layer, view.scale);
    const k = `${color}|${widthPx}|${dash.join(',')}`;
    if (k !== key) {
      flush();
      key = k;
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.setLineDash(dash);
      ctx.beginPath();
      open = true;
    }
    tracePath(ctx, e, view);
  }
  flush();
  ctx.setLineDash([]);
}

function marker(ctx: CanvasRenderingContext2D, m: SnapMarker, view: ViewState, color: string): void {
  const p = worldToScreen(view, m.point);
  const r = 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (m.kind) {
    case 'end':
      ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
      break;
    case 'mid':
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y + r);
      ctx.lineTo(p.x - r, p.y + r);
      ctx.closePath();
      break;
    case 'center':
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      break;
    case 'quadrant':
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(p.x - r, p.y - r);
      ctx.lineTo(p.x + r, p.y + r);
      ctx.moveTo(p.x + r, p.y - r);
      ctx.lineTo(p.x - r, p.y + r);
      break;
    case 'perpendicular':
      ctx.moveTo(p.x - r, p.y - r);
      ctx.lineTo(p.x - r, p.y + r);
      ctx.lineTo(p.x + r, p.y + r);
      ctx.moveTo(p.x - r, p.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + r);
      break;
    case 'tangent':
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.moveTo(p.x - r, p.y - r);
      ctx.lineTo(p.x + r, p.y - r);
      break;
    case 'nearest':
      ctx.moveTo(p.x - r, p.y - r);
      ctx.lineTo(p.x + r, p.y - r);
      ctx.lineTo(p.x - r, p.y + r);
      ctx.lineTo(p.x + r, p.y + r);
      ctx.closePath();
      break;
    case 'grid':
    case 'polar':
      ctx.moveTo(p.x - r, p.y);
      ctx.lineTo(p.x + r, p.y);
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x, p.y + r);
      break;
  }
  ctx.stroke();
}

/** The static part: background, grid and every visible entity. Cached between frames while the
 *  view moves (Canvas2D blits it with the delta transform and re-renders when the view settles). */
export function renderBase(ctx: CanvasRenderingContext2D, s: Scene): void {
  const { doc, view, size, dpr, palette } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, size.w, size.h);
  if (s.gridOn) drawGrid(ctx, s);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  drawEntities(ctx, doc, s.visible, view, palette);
}

/** Everything that changes every frame: hover, selection, rubber band, snaps, cursor. */
export function renderOverlay(ctx: CanvasRenderingContext2D, s: Scene): void {
  const { doc, view, dpr, palette } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  if (s.hover && !s.selection.has(s.hover)) {
    drawEntities(ctx, doc, [s.hover], view, palette, { color: palette.box, widthPx: 2, dash: [] });
  }
  if (s.selected.length) {
    const sel = s.selected;
    drawEntities(ctx, doc, sel, view, palette, { color: palette.selection, widthPx: 2.5, dash: [] });
    // Grips at the end points of selected lines/polylines, the centre of circles.
    ctx.fillStyle = palette.selection;
    for (const id of sel) {
      const e = doc.entities[id];
      const pts: Vec2[] = e.type === 'line' ? [e.a, e.b] : e.type === 'polyline' ? e.points : e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse' ? [e.center] : e.type === 'text' ? [e.position] : e.type === 'spline' ? (e.fitPoints ?? e.controlPoints) : [];
      if (pts.length > 200) continue;
      for (const p of pts) {
        const q = worldToScreen(view, p);
        ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
      }
    }
  }
  if (s.preview.length) {
    const tmp: Document = { ...doc, entities: { ...doc.entities }, entityOrder: [] };
    const ids: Id[] = [];
    for (const e of s.preview) {
      tmp.entities[e.id] = e;
      ids.push(e.id);
    }
    drawEntities(ctx, tmp, ids, view, palette, { color: palette.preview, widthPx: 1, dash: [6, 4] });
  }
  if (s.tracking) {
    const a = worldToScreen(view, s.tracking.from);
    const b = worldToScreen(view, s.tracking.to);
    ctx.strokeStyle = palette.snap;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (s.selectBox) {
    const a = worldToScreen(view, s.selectBox.a);
    const b = worldToScreen(view, s.selectBox.b);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = s.selectBox.crossing ? palette.selection : palette.box;
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = s.selectBox.crossing ? palette.selection : palette.box;
    ctx.lineWidth = 1;
    ctx.setLineDash(s.selectBox.crossing ? [4, 3] : []);
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }
  if (s.snap) marker(ctx, s.snap, view, palette.snap);
  if (s.cursor) {
    const c = worldToScreen(view, s.cursor);
    ctx.strokeStyle = palette.cursor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    const r = 10;
    ctx.moveTo(c.x - r, c.y + 0.5);
    ctx.lineTo(c.x + r, c.y + 0.5);
    ctx.moveTo(c.x + 0.5, c.y - r);
    ctx.lineTo(c.x + 0.5, c.y + r);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function render(ctx: CanvasRenderingContext2D, s: Scene): void {
  renderBase(ctx, s);
  renderOverlay(ctx, s);
}

/** Points along an arc for the renderer's own use (exported for tests). */
export const arcPolyline = arcPoints;
