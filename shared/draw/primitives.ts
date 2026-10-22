// Display primitives: the one vocabulary that the Canvas 2D renderer and the PDF export both draw.
// Dimensions, symbols, frames and title blocks are turned into primitives by shared/draw/*, so
// the screen and the printed sheet show exactly the same geometry (product rule 1 and 2).
// Lengths are mm: model mm for model-space primitives, paper mm for sheet primitives.

import type { Vec2 } from '../geometry/vec2';
import { applyToPoint, type Matrix, uniformScale } from '../geometry/transform';

export type Prim =
  | { kind: 'polyline'; points: Vec2[]; closed: boolean; width: number; dash?: number[]; color?: string }
  | { kind: 'arc'; center: Vec2; radius: number; start: number; end: number; width: number; dash?: number[]; color?: string }
  | { kind: 'circle'; center: Vec2; radius: number; width: number; dash?: number[]; color?: string }
  /** Filled polygon (arrowheads, datum triangles, dots). */
  | { kind: 'polygon'; points: Vec2[]; color?: string }
  /** Single-line text. `height` is the cap height in mm; `align` is about `position` along the baseline. */
  | { kind: 'text'; position: Vec2; text: string; height: number; rotation: number; align: 'left' | 'center' | 'right'; color?: string }
  /** Ellipse arc (for ellipses on sheets); parameters as in EllipseEntity. */
  | { kind: 'ellipse'; center: Vec2; major: Vec2; ratio: number; start: number; end: number; width: number; dash?: number[]; color?: string };

/** Transform every primitive with a similarity matrix (uniform scale, rotation, translation). */
export function transformPrims(prims: Prim[], m: Matrix): Prim[] {
  const k = uniformScale(m);
  const rot = Math.atan2(m.b, m.a);
  const P = (p: Vec2) => applyToPoint(m, p);
  return prims.map((p): Prim => {
    switch (p.kind) {
      case 'polyline':
        return { ...p, points: p.points.map(P), width: p.width * k, dash: p.dash?.map((d) => d * k) };
      case 'arc':
        return { ...p, center: P(p.center), radius: p.radius * k, start: p.start + rot, end: p.end + rot, width: p.width * k, dash: p.dash?.map((d) => d * k) };
      case 'circle':
        return { ...p, center: P(p.center), radius: p.radius * k, width: p.width * k, dash: p.dash?.map((d) => d * k) };
      case 'polygon':
        return { ...p, points: p.points.map(P) };
      case 'text':
        return { ...p, position: P(p.position), height: p.height * k, rotation: p.rotation + rot };
      case 'ellipse':
        return { ...p, center: P(p.center), major: { x: p.major.x * m.a + p.major.y * m.c, y: p.major.x * m.b + p.major.y * m.d }, width: p.width * k, dash: p.dash?.map((d) => d * k) };
    }
  });
}

/** Approximate text width: 0.7 × height per character until real font metrics arrive (PDF export). */
export const TEXT_ADVANCE = 0.7;
export const textWidth = (text: string, height: number): number => Math.max(text.length, 1) * height * TEXT_ADVANCE;
