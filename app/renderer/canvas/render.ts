// Our own 2D renderer on Canvas 2D (CLAUDE.md, Stack). Geometry stays in mm; one affine transform
// maps it to pixels. Line widths are true to scale with a 1 px floor so narrow lines stay visible.

import { entitiesInOrder } from '@shared/doc/document';
import type { Document, Entity, Id } from '@shared/doc/types';
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
  cursor: string;
}

export interface Scene {
  doc: Document;
  view: ViewState;
  size: { w: number; h: number };
  dpr: number;
  selection: ReadonlySet<Id>;
  gridOn: boolean;
  gridStep: number;
  cursor: Vec2 | null;
  /** The entity being drawn (rubber band), if any. */
  preview: Entity | null;
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
    cursor: v('--canvas-fg'),
  };
}

function strokeEntity(ctx: CanvasRenderingContext2D, e: Entity, view: ViewState): void {
  ctx.beginPath();
  switch (e.type) {
    case 'line': {
      const a = worldToScreen(view, e.a);
      const b = worldToScreen(view, e.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      break;
    }
    case 'circle': {
      const c = worldToScreen(view, e.center);
      ctx.arc(c.x, c.y, e.radius * view.scale, 0, Math.PI * 2);
      break;
    }
    case 'arc': {
      // Screen y points down, so a counter-clockwise world arc is clockwise on screen.
      const c = worldToScreen(view, e.center);
      ctx.arc(c.x, c.y, e.radius * view.scale, -e.start, -e.end, true);
      break;
    }
  }
  ctx.stroke();
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
  // Axes through the origin.
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

export function render(ctx: CanvasRenderingContext2D, s: Scene): void {
  const { doc, view, size, dpr, palette } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, size.w, size.h);
  if (s.gridOn) drawGrid(ctx, s);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Entities in drawing order, grouped by nothing yet: M1 adds the spatial index and culling.
  for (const e of entitiesInOrder(doc)) {
    const layer = doc.layers[e.layer];
    if (!layer || !layer.visible) continue;
    ctx.strokeStyle = layer.color === 'auto' ? palette.foreground : layer.color;
    ctx.lineWidth = Math.max(1, layer.lineWidth * view.scale);
    strokeEntity(ctx, e, view);
  }
  // Selection on top, wider and in the selection colour.
  if (s.selection.size) {
    ctx.strokeStyle = palette.selection;
    for (const id of s.selection) {
      const e = doc.entities[id];
      if (!e) continue;
      const layer = doc.layers[e.layer];
      ctx.lineWidth = Math.max(2.5, (layer?.lineWidth ?? 0.5) * view.scale + 2);
      strokeEntity(ctx, e, view);
    }
  }
  if (s.preview) {
    ctx.strokeStyle = palette.preview;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    strokeEntity(ctx, s.preview, view);
    ctx.setLineDash([]);
  }
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
