// Constraint glyphs: small marks next to the constrained geometry (as FreeCAD and SolidWorks show
// them), drawn as display primitives in the overlay. Sizes are screen-ish: the caller passes the
// glyph size in model mm for the current zoom.

import type { Constraint, Document, Entity, PointRef } from '../doc/types';
import { add, fromAngle, mid, normalize, perp, scale, sub, type Vec2 } from '../geometry/vec2';
import type { Prim } from './primitives';

/** The coordinates of a point reference, or null when the entity or point is missing. */
export function pointOf(doc: Document, ref: PointRef): Vec2 | null {
  const e = doc.entities[ref.entity];
  if (!e) return null;
  if (typeof ref.point === 'number') return e.type === 'polyline' ? (e.points[ref.point] ?? null) : null;
  switch (e.type) {
    case 'line':
      return ref.point === 'a' ? e.a : ref.point === 'b' ? e.b : null;
    case 'circle':
      return ref.point === 'center' ? e.center : null;
    case 'arc':
      return ref.point === 'center' ? e.center : ref.point === 'start' ? add(e.center, fromAngle(e.start, e.radius)) : ref.point === 'end' ? add(e.center, fromAngle(e.end, e.radius)) : null;
    default:
      return null;
  }
}

/** A representative point of an entity for a glyph: the midpoint of a line, the top of a circle. */
function anchorOf(e: Entity): Vec2 | null {
  switch (e.type) {
    case 'line':
      return mid(e.a, e.b);
    case 'circle':
      return add(e.center, { x: 0, y: e.radius });
    case 'arc':
      return add(e.center, fromAngle((e.start + (e.end > e.start ? e.end : e.end + Math.PI * 2)) / 2, e.radius));
    case 'polyline':
      return e.points[0] ?? null;
    default:
      return null;
  }
}

/** Short labels per kind (glyphs that every font has). */
export const CONSTRAINT_GLYPH: Record<Constraint['kind'], string> = {
  coincident: '●',
  pointOnLine: '◦',
  horizontal: '—',
  vertical: '|',
  parallel: '∥',
  perpendicular: '⊥',
  tangent: '◠',
  equal: '=',
  symmetric: '⋈',
  fixed: '🔒',
  distance: '↔',
  pointLineDistance: '↕',
  angle: '∠',
  radius: 'R',
};

export interface ConstraintGlyph {
  id: string;
  at: Vec2;
  text: string;
}

/** Where each constraint's glyph goes and what it shows. `offset` is a model-mm nudge off the geometry. */
export function constraintGlyphs(doc: Document, offset: number): ConstraintGlyph[] {
  const out: ConstraintGlyph[] = [];
  const bump = (p: Vec2 | null, e?: Entity | null): Vec2 | null => {
    if (!p) return null;
    if (e && e.type === 'line') {
      const n = perp(normalize(sub(e.b, e.a)));
      return add(p, scale(n, offset));
    }
    return add(p, { x: offset, y: offset });
  };
  for (const id of doc.constraintOrder) {
    const c = doc.constraints[id];
    if (!c) continue;
    const text = CONSTRAINT_GLYPH[c.kind];
    switch (c.kind) {
      case 'coincident':
      case 'distance': {
        const p = c.kind === 'coincident' ? pointOf(doc, c.p1) : mid(pointOf(doc, c.p1) ?? { x: 0, y: 0 }, pointOf(doc, c.p2) ?? { x: 0, y: 0 });
        const at = bump(p);
        if (at) out.push({ id, at, text: c.kind === 'distance' ? `${text} ${trim(c.value)}` : text });
        break;
      }
      case 'pointOnLine':
      case 'pointLineDistance': {
        const at = bump(pointOf(doc, c.p));
        if (at) out.push({ id, at, text: c.kind === 'pointLineDistance' ? `${text} ${trim(c.value)}` : text });
        break;
      }
      case 'symmetric': {
        const at = bump(anchorOf(doc.entities[c.line]), doc.entities[c.line]);
        if (at) out.push({ id, at, text });
        break;
      }
      case 'horizontal':
      case 'vertical':
      case 'fixed':
      case 'radius': {
        const e = doc.entities[c.entity];
        const at = bump(e ? anchorOf(e) : null, e);
        if (at) out.push({ id, at, text: c.kind === 'radius' ? `R${trim(c.value)}` : text });
        break;
      }
      case 'parallel':
      case 'perpendicular':
      case 'tangent':
      case 'equal':
      case 'angle': {
        for (const eid of [c.a, c.b]) {
          const e = doc.entities[eid];
          const at = bump(e ? anchorOf(e) : null, e);
          if (at) out.push({ id, at, text: c.kind === 'angle' ? `${text}${trim((c.value * 180) / Math.PI)}°` : text });
        }
        break;
      }
    }
  }
  return out;
}

const trim = (v: number): string => String(Number(v.toPrecision(6)));

/** Glyphs as text primitives of height `h` (model mm). */
export function constraintPrims(doc: Document, h: number): Prim[] {
  return constraintGlyphs(doc, h * 0.6).map((g) => ({ kind: 'text', position: g.at, text: g.text, height: h, rotation: 0, align: 'left' }));
}
