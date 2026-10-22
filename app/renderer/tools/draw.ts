// Drawing tools: line, polyline, rectangle, circle, arc (three points), ellipse, spline, text.

import type { Constraint, Entity, Id, PointRef, PolylineEntity } from '@shared/doc/types';
import type { Command } from '@shared/commands';
import { angleOf, cross, dist, dot, perp, scale, sub, type Vec2, normalize } from '@shared/geometry/vec2';
import { interpolateSpline } from '@shared/geometry/flatten';
import { parseLength } from '@shared/units';
import type { Tool, ToolCtx } from './types';

interface Points {
  points: Vec2[];
}

interface LineState extends Points {
  /** Entity point the last point snapped to (for an inferred coincident constraint). */
  lastRef: PointRef | null;
  /** The line just drawn, so the next segment can be made coincident with its end. */
  lastLine: Id | null;
}

export const lineTool: Tool<LineState> = {
  id: 'line',
  init: () => ({ points: [], lastRef: null, lastLine: null }),
  prompt: (s, ctx) => (s.points.length === 0 ? ctx.t('Line: first point') : ctx.t('Line: next point (Enter or Esc to finish, U undoes the last segment)')),
  point(s, p, ctx) {
    const snapRef = ctx.lastSnap?.ref ?? null;
    if (s.points.length === 0) return { ...s, points: [p], lastRef: snapRef, lastLine: null };
    const a = s.points[s.points.length - 1];
    if (dist(a, p) === 0) {
      ctx.say({ kind: 'warn', text: ctx.t('The two points are the same; pick another point.') });
      return s;
    }
    const e: Entity = { id: ctx.ids(), type: 'line', layer: ctx.layer, a, b: p };
    // Inferred constraints (product rule 5): an end snapped onto another entity's point becomes
    // coincident; a polar-tracked 0° or 90° segment becomes horizontal or vertical; consecutive
    // segments share their corner.
    const constraints: Constraint[] = [];
    const startRef: PointRef | null = s.lastLine ? { entity: s.lastLine, point: 'b' } : s.lastRef;
    if (startRef && startRef.entity !== e.id) constraints.push({ id: ctx.ids(), kind: 'coincident', p1: { entity: e.id, point: 'a' }, p2: startRef });
    if (snapRef && snapRef.entity !== e.id) constraints.push({ id: ctx.ids(), kind: 'coincident', p1: { entity: e.id, point: 'b' }, p2: snapRef });
    const ang = ctx.lastSnap?.kind === 'polar' ? ctx.lastSnap.angle : undefined;
    if (ang !== undefined) {
      const q = Math.abs(((ang / (Math.PI / 2)) % 2 + 2) % 2);
      if (Math.abs(q) < 1e-9 || Math.abs(q - 2) < 1e-9) constraints.push({ id: ctx.ids(), kind: 'horizontal', entity: e.id });
      else if (Math.abs(q - 1) < 1e-9) constraints.push({ id: ctx.ids(), kind: 'vertical', entity: e.id });
    }
    const cmd: Command = constraints.length ? { kind: 'batch', label: ctx.t('Add line'), commands: [{ kind: 'addEntities', entities: [e] }, { kind: 'addConstraints', constraints }] } : { kind: 'addEntities', entities: [e] };
    return ctx.run(cmd) ? { points: [...s.points, p], lastRef: snapRef, lastLine: e.id } : s;
  },
  text(s, text, ctx) {
    if (text.toUpperCase() === 'U' && s.points.length > 1) {
      // Undo the last segment: the store's undo removes the entity; drop the point.
      ctx.say({ kind: 'info', text: ctx.t('Last segment removed.') });
      ctx.run({ kind: 'deleteEntities', ids: lastLineId(ctx, s) });
      return { ...s, points: s.points.slice(0, -1), lastLine: null, lastRef: null };
    }
    if (text.toUpperCase() === 'C' && s.points.length > 2) {
      const e: Entity = { id: ctx.ids(), type: 'line', layer: ctx.layer, a: s.points[s.points.length - 1], b: s.points[0] };
      ctx.run({ kind: 'addEntities', entities: [e] });
      return null;
    }
    ctx.say({ kind: 'warn', text: ctx.t('Type a point as x,y or @dx,dy, or U to undo the last segment, C to close.') });
    return s;
  },
  enter: () => null,
  preview: (s, cursor, ctx) => (cursor && s.points.length ? [{ id: '_p', type: 'line', layer: ctx.layer, a: s.points[s.points.length - 1], b: cursor }] : []),
  reference: (s) => s.points[s.points.length - 1] ?? null,
};

function lastLineId(ctx: ToolCtx, s: Points): string[] {
  const a = s.points[s.points.length - 2];
  const b = s.points[s.points.length - 1];
  for (let i = ctx.doc.entityOrder.length - 1; i >= 0; i--) {
    const e = ctx.doc.entities[ctx.doc.entityOrder[i]];
    if (e.type === 'line' && e.a.x === a.x && e.a.y === a.y && e.b.x === b.x && e.b.y === b.y) return [e.id];
  }
  return [];
}

export const polylineTool: Tool<Points> = {
  id: 'polyline',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => (s.points.length === 0 ? ctx.t('Polyline: first point') : ctx.t('Polyline: next point (Enter to finish, C to close, U undoes the last point)')),
  point(s, p, ctx) {
    const last = s.points[s.points.length - 1];
    if (last && dist(last, p) === 0) {
      ctx.say({ kind: 'warn', text: ctx.t('The two points are the same; pick another point.') });
      return s;
    }
    return { points: [...s.points, p] };
  },
  text(s, text, ctx) {
    const u = text.toUpperCase();
    if (u === 'U') return { points: s.points.slice(0, -1) };
    if (u === 'C') return finishPolyline(s, true, ctx);
    ctx.say({ kind: 'warn', text: ctx.t('Type a point as x,y or @dx,dy, or U to undo the last point, C to close.') });
    return s;
  },
  enter: (s, ctx) => finishPolyline(s, false, ctx),
  preview(s, cursor, ctx) {
    if (s.points.length === 0) return [];
    const pts = cursor ? [...s.points, cursor] : s.points;
    return pts.length >= 2 ? [{ id: '_p', type: 'polyline', layer: ctx.layer, points: pts, closed: false }] : [];
  },
  reference: (s) => s.points[s.points.length - 1] ?? null,
};

function finishPolyline(s: Points, closed: boolean, ctx: ToolCtx): null {
  if (s.points.length < 2) {
    if (s.points.length === 1) ctx.say({ kind: 'info', text: ctx.t('A polyline needs at least two points; nothing was drawn.') });
    return null;
  }
  const e: PolylineEntity = { id: ctx.ids(), type: 'polyline', layer: ctx.layer, points: s.points, closed: closed && s.points.length > 2 };
  ctx.run({ kind: 'addEntities', entities: [e] });
  return null;
}

export const rectTool: Tool<Points> = {
  id: 'rect',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => (s.points.length === 0 ? ctx.t('Rectangle: first corner') : ctx.t('Rectangle: opposite corner (or type width,height)')),
  point(s, p, ctx) {
    if (s.points.length === 0) return { points: [p] };
    const a = s.points[0];
    if (a.x === p.x || a.y === p.y) {
      ctx.say({ kind: 'warn', text: ctx.t('A rectangle needs a width and a height greater than zero.') });
      return s;
    }
    const e: PolylineEntity = { id: ctx.ids(), type: 'polyline', layer: ctx.layer, points: rectPoints(a, p), closed: true };
    ctx.run({ kind: 'addEntities', entities: [e] });
    return null;
  },
  preview: (s, cursor, ctx) => (cursor && s.points.length === 1 && cursor.x !== s.points[0].x && cursor.y !== s.points[0].y ? [{ id: '_p', type: 'polyline', layer: ctx.layer, points: rectPoints(s.points[0], cursor), closed: true }] : []),
  reference: (s) => s.points[0] ?? null,
};

function rectPoints(a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export const circleTool: Tool<Points> = {
  id: 'circle',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => (s.points.length === 0 ? ctx.t('Circle: centre') : ctx.t('Circle: radius or a point on the circle (D for a diameter)')),
  point(s, p, ctx) {
    if (s.points.length === 0) return { points: [p] };
    const r = dist(s.points[0], p);
    return makeCircle(s.points[0], r, ctx);
  },
  text(s, text, ctx) {
    if (s.points.length === 0) return s;
    const m = /^d\s*(.+)$/i.exec(text.trim());
    const v = parseLength(m ? m[1] : text);
    if (v === null) {
      ctx.say({ kind: 'warn', text: ctx.t('Type a radius in mm, D followed by a diameter, or pick a point.') });
      return s;
    }
    return makeCircle(s.points[0], m ? v / 2 : v, ctx);
  },
  preview: (s, cursor, ctx) => (cursor && s.points.length === 1 && dist(s.points[0], cursor) > 0 ? [{ id: '_p', type: 'circle', layer: ctx.layer, center: s.points[0], radius: dist(s.points[0], cursor) }] : []),
  reference: (s) => s.points[0] ?? null,
};

function makeCircle(center: Vec2, r: number, ctx: ToolCtx): Points | null {
  if (!(r > 0)) {
    ctx.say({ kind: 'warn', text: ctx.t('A circle needs a radius greater than zero.') });
    return { points: [center] };
  }
  ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'circle', layer: ctx.layer, center, radius: r }] });
  return null;
}

/** Circle through three points, or null when they are collinear. */
export function circleThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { center, radius: dist(center, a) };
}

/** Arc from a through b to c as a counter-clockwise (center, radius, start, end). */
export function arcThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number; start: number; end: number } | null {
  const circ = circleThrough(a, b, c);
  if (!circ) return null;
  const ccw = cross(sub(b, a), sub(c, a)) > 0;
  const angA = angleOf(sub(a, circ.center));
  const angC = angleOf(sub(c, circ.center));
  return ccw ? { ...circ, start: angA, end: angC } : { ...circ, start: angC, end: angA };
}

export const arcTool: Tool<Points> = {
  id: 'arc',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => [ctx.t('Arc: start point'), ctx.t('Arc: a point on the arc'), ctx.t('Arc: end point')][s.points.length],
  point(s, p, ctx) {
    const pts = [...s.points, p];
    if (pts.length < 3) return { points: pts };
    const arc = arcThrough(pts[0], pts[1], pts[2]);
    if (!arc) {
      ctx.say({ kind: 'warn', text: ctx.t('The three points are on one line; no arc goes through them. Pick the end point again.') });
      return s;
    }
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'arc', layer: ctx.layer, ...arc }] });
    return null;
  },
  preview(s, cursor, ctx) {
    if (!cursor) return [];
    if (s.points.length === 1) return [{ id: '_p', type: 'line', layer: ctx.layer, a: s.points[0], b: cursor }];
    if (s.points.length === 2) {
      const arc = arcThrough(s.points[0], s.points[1], cursor);
      return arc ? [{ id: '_p', type: 'arc', layer: ctx.layer, ...arc }] : [];
    }
    return [];
  },
  reference: (s) => s.points[s.points.length - 1] ?? null,
};

export const ellipseTool: Tool<Points> = {
  id: 'ellipse',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => [ctx.t('Ellipse: centre'), ctx.t('Ellipse: end of the first axis'), ctx.t('Ellipse: half-length of the second axis (a point or a number)')][s.points.length],
  point(s, p, ctx) {
    if (s.points.length < 2) {
      if (s.points.length === 1 && dist(s.points[0], p) === 0) return s;
      return { points: [...s.points, p] };
    }
    return makeEllipse(s, perpDistance(s.points[0], s.points[1], p), ctx);
  },
  text(s, text, ctx) {
    if (s.points.length !== 2) return s;
    const v = parseLength(text);
    if (v === null) {
      ctx.say({ kind: 'warn', text: ctx.t('Type the half-length of the second axis in mm, or pick a point.') });
      return s;
    }
    return makeEllipse(s, v, ctx);
  },
  preview(s, cursor, ctx) {
    if (!cursor) return [];
    if (s.points.length === 1) return [{ id: '_p', type: 'line', layer: ctx.layer, a: s.points[0], b: cursor }];
    if (s.points.length === 2) {
      const e = ellipseFrom(s.points[0], s.points[1], perpDistance(s.points[0], s.points[1], cursor));
      return e ? [{ id: '_p', layer: ctx.layer, ...e }] : [];
    }
    return [];
  },
  reference: (s) => s.points[0] ?? null,
};

const perpDistance = (c: Vec2, axisEnd: Vec2, p: Vec2): number => Math.abs(dot(sub(p, c), normalize(perp(sub(axisEnd, c)))));

function ellipseFrom(center: Vec2, axisEnd: Vec2, half2: number): { type: 'ellipse'; center: Vec2; major: Vec2; ratio: number; start: number; end: number } | null {
  const a = dist(center, axisEnd);
  if (!(a > 0) || !(half2 > 0)) return null;
  // The longer axis is the major one (DXF convention: ratio <= 1).
  if (half2 <= a) return { type: 'ellipse', center, major: sub(axisEnd, center), ratio: half2 / a, start: 0, end: Math.PI * 2 };
  const major = scale(normalize(perp(sub(axisEnd, center))), half2);
  return { type: 'ellipse', center, major, ratio: a / half2, start: 0, end: Math.PI * 2 };
}

function makeEllipse(s: Points, half2: number, ctx: ToolCtx): Points | null {
  const e = ellipseFrom(s.points[0], s.points[1], half2);
  if (!e) {
    ctx.say({ kind: 'warn', text: ctx.t('An ellipse needs two axes longer than zero.') });
    return s;
  }
  ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), layer: ctx.layer, ...e }] });
  return null;
}

export const splineTool: Tool<Points> = {
  id: 'spline',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => (s.points.length === 0 ? ctx.t('Spline: first fit point') : ctx.t('Spline: next fit point (Enter to finish, C to close, U undoes the last point)')),
  point(s, p, ctx) {
    const last = s.points[s.points.length - 1];
    if (last && dist(last, p) === 0) {
      ctx.say({ kind: 'warn', text: ctx.t('The two points are the same; pick another point.') });
      return s;
    }
    return { points: [...s.points, p] };
  },
  text(s, text, ctx) {
    const u = text.toUpperCase();
    if (u === 'U') return { points: s.points.slice(0, -1) };
    if (u === 'C') return finishSpline(s, true, ctx);
    ctx.say({ kind: 'warn', text: ctx.t('Type a point as x,y or @dx,dy, or U to undo the last point, C to close.') });
    return s;
  },
  enter: (s, ctx) => finishSpline(s, false, ctx),
  preview(s, cursor, ctx) {
    const pts = cursor ? [...s.points, cursor] : s.points;
    if (pts.length < 2) return [];
    const sp = interpolateSpline(pts);
    return [{ id: '_p', type: 'spline', layer: ctx.layer, ...sp, fitPoints: pts, closed: false }];
  },
  reference: (s) => s.points[s.points.length - 1] ?? null,
};

function finishSpline(s: Points, closed: boolean, ctx: ToolCtx): null {
  if (s.points.length < 2) {
    if (s.points.length === 1) ctx.say({ kind: 'info', text: ctx.t('A spline needs at least two points; nothing was drawn.') });
    return null;
  }
  const fit = closed && s.points.length > 2 ? [...s.points, s.points[0]] : s.points;
  const sp = interpolateSpline(fit);
  ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'spline', layer: ctx.layer, ...sp, fitPoints: s.points, closed: closed && s.points.length > 2 }] });
  return null;
}

interface TextState {
  position: Vec2 | null;
  height: number;
}
export const textTool: Tool<TextState> = {
  id: 'text',
  init: () => ({ position: null, height: 3.5 }),
  // ISO 3098-1 lettering sizes include 2.5, 3.5, 5, 7, 10 mm; 3.5 mm is the usual default for notes.
  prompt: (s, ctx) => (s.position ? ctx.t('Text: type the text and press Enter (height {h} mm; type H= to change it)', { h: s.height }) : ctx.t('Text: insertion point (baseline left)')),
  point: (s, p) => ({ ...s, position: p }),
  text(s, text, ctx) {
    const h = /^h\s*=\s*(.+)$/i.exec(text.trim());
    if (h) {
      const v = parseLength(h[1]);
      if (v === null || v <= 0) {
        ctx.say({ kind: 'warn', text: ctx.t('Type the height in mm, for example H=5') });
        return s;
      }
      return { ...s, height: v };
    }
    if (!s.position) {
      ctx.say({ kind: 'warn', text: ctx.t('Pick the insertion point first.') });
      return s;
    }
    if (!text.trim()) return s;
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'text', layer: ctx.layer, position: s.position, text, height: s.height, rotation: 0 }] });
    return null;
  },
  preview: (s, cursor, ctx) => {
    const p = s.position ?? cursor;
    return p ? [{ id: '_p', type: 'text', layer: ctx.layer, position: p, text: 'Abc', height: s.height, rotation: 0 }] : [];
  },
};

export const DRAW_TOOLS = [lineTool, polylineTool, rectTool, circleTool, arcTool, ellipseTool, splineTool, textTool] as Tool<unknown>[];
