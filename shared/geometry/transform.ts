// 2D affine transforms for the edit commands (move, copy, rotate, scale, mirror, arrays).
//
// A matrix maps a point (x, y) to
//   x' = a·x + c·y + e
//   y' = b·x + d·y + f
// i.e. the column-major 3×3 matrix [[a c e] [b d f] [0 0 1]] used by Canvas 2D and SVG.
//
// Entities only support similarity transforms (rotation, translation, uniform scale, reflection):
// circles, arcs, ellipses, bulges and text have no exact representation under a shear or a
// non-uniform scale, and the app never asks for one. transformEntity throws on such a matrix for
// the entity types that cannot follow it exactly.

import type { Entity } from '../doc/types';
import { normalize, sub, type Vec2 } from './vec2';

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const identity = (): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const translation = (dx: number, dy: number): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

/**
 * Composition: the matrix that applies `m2` FIRST and then `m1`, i.e. applyToPoint(multiply(m1, m2), p)
 * equals applyToPoint(m1, applyToPoint(m2, p)) (the usual product m1·m2 of column vectors).
 */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** A linear part `lin` (a, b, c, d) that keeps `center` fixed: p' = lin·(p − center) + center. */
function aroundCenter(a: number, b: number, c: number, d: number, center?: Vec2): Matrix {
  if (!center) return { a, b, c, d, e: 0, f: 0 };
  return { a, b, c, d, e: center.x - (a * center.x + c * center.y), f: center.y - (b * center.x + d * center.y) };
}

/** Counter-clockwise rotation by `angle` radians around `center` (the origin by default). */
export function rotation(angle: number, center?: Vec2): Matrix {
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return aroundCenter(cs, sn, -sn, cs, center);
}

/** Uniform scaling by `k` around `center` (the origin by default). */
export function scaling(k: number, center?: Vec2): Matrix {
  return aroundCenter(k, 0, 0, k, center);
}

/**
 * Reflection across the line through `p` and `q`. With u the unit direction of the line, the
 * linear part is 2·u·uᵀ − I = [[ux²−uy², 2uxuy], [2uxuy, uy²−ux²]] (a reflection: det = −1), and
 * the translation keeps `p` fixed.
 */
export function mirror(p: Vec2, q: Vec2): Matrix {
  const u = normalize(sub(q, p));
  if (u.x === 0 && u.y === 0) throw new Error('mirror: the two points of the mirror line coincide');
  const xx = u.x * u.x - u.y * u.y;
  const xy = 2 * u.x * u.y;
  return aroundCenter(xx, xy, xy, -xx, p);
}

export const applyToPoint = (m: Matrix, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

/** The linear part only (directions and offsets do not translate). */
export const applyToVector = (m: Matrix, v: Vec2): Vec2 => ({ x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y });

export const determinant = (m: Matrix): number => m.a * m.d - m.b * m.c;

/** True when the matrix reverses orientation (a reflection, possibly combined with others). */
export const isMirror = (m: Matrix): boolean => determinant(m) < 0;

/** The length scale factor of a similarity: sqrt|det|. */
export const uniformScale = (m: Matrix): number => Math.sqrt(Math.abs(determinant(m)));

/**
 * True when the matrix is a similarity (rotation · uniform scale, optionally a reflection, plus a
 * translation): the linear part is s·[[cos, −sin], [sin, cos]] (a = d, b = −c) or
 * s·[[cos, sin], [sin, −cos]] (a = −d, b = c). `tol` is relative to the scale.
 */
export function isSimilarity(m: Matrix, tol = 1e-9): boolean {
  const s = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d), 1e-300);
  if (isMirror(m)) return Math.abs(m.a + m.d) <= tol * s && Math.abs(m.b - m.c) <= tol * s;
  return Math.abs(m.a - m.d) <= tol * s && Math.abs(m.b + m.c) <= tol * s;
}

/**
 * How a direction angle α maps under a similarity. The first column (a, b) is the image of the x
 * axis, at angle φ = atan2(b, a). Without reflection every direction turns by φ: α' = φ + α. A
 * reflection (scaled) across a line at angle ψ maps α to 2ψ − α, and its first column is at angle
 * 2ψ, so α' = φ − α.
 */
export function mapAngle(m: Matrix, angle: number): number {
  const phi = Math.atan2(m.b, m.a);
  return isMirror(m) ? phi - angle : phi + angle;
}

/** Angles as they are when the matrix does not turn anything (translations, scalings): exact. */
function turns(m: Matrix): boolean {
  return m.b !== 0 || m.a < 0 || isMirror(m);
}

function requireSimilarity(m: Matrix, what: string): void {
  if (!isSimilarity(m)) throw new Error(`transformEntity: ${what} needs a similarity transform (no shear or non-uniform scale)`);
}

/**
 * The entity under the matrix, keeping its id and layer.
 *
 * - Lines, polylines, spline control and fit points: every point is transformed (exact for any
 *   affine matrix; polylines with bulges need a similarity).
 * - Circles and arcs: centre transformed, radius × scale. Arc angles map with mapAngle; under a
 *   reflection the arc is traversed clockwise, so start and end swap to keep it counter-clockwise
 *   over the same points.
 * - Polyline bulges: a reflection turns a left bend into a right bend, so every bulge changes sign.
 * - Ellipses: centre and major vector transformed, ratio unchanged. The minor vector is perp(major)
 *   · ratio; a rotation keeps that relation, a reflection reverses it (M·perp(v) = −perp(M·v)), so
 *   the image of parameter t is parameter −t: the range [start, end] becomes [−end, −start].
 * - Text: position transformed, height × scale, rotation mapped with mapAngle. Under a reflection
 *   the baseline direction is reflected but the glyphs are NOT mirrored (text stays readable, as
 *   CAD programs do with MIRRTEXT = 0): rotation' = reflect(rotation). The text keeps its
 *   insertion point, so it sits on the other side of the reflected baseline compared with a true
 *   mirror image; placing it inside the mirrored box would need the rendered text width, which
 *   the document does not store.
 */
export function transformEntity(e: Entity, m: Matrix): Entity {
  const P = (p: Vec2): Vec2 => applyToPoint(m, p);
  const mir = isMirror(m);
  const ang = (a: number): number => (turns(m) ? mapAngle(m, a) : a);
  switch (e.type) {
    case 'line':
      return { ...e, a: P(e.a), b: P(e.b) };
    case 'circle':
      requireSimilarity(m, 'a circle');
      return { ...e, center: P(e.center), radius: e.radius * uniformScale(m) };
    case 'arc': {
      requireSimilarity(m, 'an arc');
      const start = ang(e.start);
      const end = ang(e.end);
      return { ...e, center: P(e.center), radius: e.radius * uniformScale(m), start: mir ? end : start, end: mir ? start : end };
    }
    case 'polyline': {
      const out = { ...e, points: e.points.map(P) };
      if (e.bulges) {
        if (e.bulges.some((b) => b !== 0)) requireSimilarity(m, 'a polyline with arc segments');
        out.bulges = mir ? e.bulges.map((b) => (b === 0 ? 0 : -b)) : e.bulges.slice();
      }
      return out;
    }
    case 'ellipse': {
      requireSimilarity(m, 'an ellipse');
      const major = applyToVector(m, e.major);
      return mir ? { ...e, center: P(e.center), major, start: -e.end, end: -e.start } : { ...e, center: P(e.center), major };
    }
    case 'spline': {
      const out = { ...e, controlPoints: e.controlPoints.map(P), knots: e.knots.slice() };
      if (e.fitPoints) out.fitPoints = e.fitPoints.map(P);
      return out;
    }
    case 'text':
      requireSimilarity(m, 'a text');
      return { ...e, position: P(e.position), height: e.height * uniformScale(m), rotation: ang(e.rotation) };
    // Annotations (M2): their reference points move with the geometry; lettering sizes come from
    // the document's dimension style, so only the note's own height scales.
    case 'dimension': {
      requireSimilarity(m, 'a dimension');
      const out = { ...e, a: P(e.a), b: P(e.b), position: P(e.position), rotation: ang(e.rotation) };
      if (e.center) out.center = P(e.center);
      // Under a mirror an angular dimension's legs swap so the arc still runs counter-clockwise.
      if (mir && e.kind === 'angular') return { ...out, a: out.b, b: out.a };
      return out;
    }
    case 'note': {
      requireSimilarity(m, 'a note');
      const out = { ...e, position: P(e.position), height: e.height * uniformScale(m), rotation: ang(e.rotation) };
      if (e.leader) out.leader = e.leader.map(P);
      return out;
    }
    case 'balloon':
      return { ...e, position: P(e.position), leader: P(e.leader) };
    case 'surface': {
      requireSimilarity(m, 'a surface symbol');
      const out = { ...e, position: P(e.position), rotation: ang(e.rotation) };
      if (e.leader) out.leader = P(e.leader);
      return out;
    }
    case 'gdt': {
      requireSimilarity(m, 'a tolerance frame');
      const out = { ...e, position: P(e.position), rotation: ang(e.rotation) };
      if (e.leader) out.leader = P(e.leader);
      return out;
    }
    case 'datum':
      requireSimilarity(m, 'a datum');
      return { ...e, position: P(e.position), rotation: ang(e.rotation) };
  }
}
