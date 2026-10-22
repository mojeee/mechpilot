import { describe, expect, it } from 'vitest';
import { angleInArc, boxOf, cross, dist, distToSegment, eq, normAngle, rotate, vec } from '@shared/geometry/vec2';
import { distToEntity, documentBox, entityBox, newDocument, pick } from '@shared/doc/document';
import type { Document, Entity } from '@shared/doc/types';

describe('vec2', () => {
  it('rotates counter-clockwise around a centre', () => {
    const p = rotate(vec(10, 0), Math.PI / 2, vec(0, 0));
    expect(eq(p, vec(0, 10))).toBe(true);
    const q = rotate(vec(2, 1), Math.PI, vec(1, 1));
    expect(eq(q, vec(0, 1))).toBe(true);
  });
  it('cross is positive for a counter-clockwise turn', () => {
    expect(cross(vec(1, 0), vec(0, 1))).toBe(1);
    expect(cross(vec(0, 1), vec(1, 0))).toBe(-1);
  });
  it('distance to a segment clamps to its ends', () => {
    expect(distToSegment(vec(5, 3), vec(0, 0), vec(10, 0))).toBe(3);
    expect(distToSegment(vec(13, 4), vec(0, 0), vec(10, 0))).toBe(5);
    expect(distToSegment(vec(1, 1), vec(2, 2), vec(2, 2))).toBeCloseTo(Math.SQRT2, 12);
  });
  it('normalizes angles and tests arc membership counter-clockwise', () => {
    expect(normAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(angleInArc(Math.PI / 4, 0, Math.PI / 2)).toBe(true);
    expect(angleInArc(-Math.PI / 4, 0, Math.PI / 2)).toBe(false);
    // An arc that crosses the 0 direction.
    expect(angleInArc(0, -Math.PI / 4, Math.PI / 4)).toBe(true);
  });
  it('boxOf', () => {
    expect(boxOf([])).toBeNull();
    expect(boxOf([vec(1, 5), vec(-2, 3)])).toEqual({ min: { x: -2, y: 3 }, max: { x: 1, y: 5 } });
  });
});

describe('entities', () => {
  const arc: Entity = { id: 'a', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
  it('arc bounds include only the quadrant the arc covers', () => {
    const b = entityBox(arc);
    expect(b.min.x).toBeCloseTo(0, 12);
    expect(b.min.y).toBeCloseTo(0, 12);
    expect(b.max.x).toBeCloseTo(10, 12);
    expect(b.max.y).toBeCloseTo(10, 12);
  });
  it('distance to an arc uses its end points outside the span', () => {
    expect(distToEntity(vec(0, 11), arc)).toBeCloseTo(1, 12);
    expect(distToEntity(vec(0, -10), arc)).toBeCloseTo(dist(vec(0, -10), vec(10, 0)), 12);
  });
  it('pick takes the closest entity on a visible, unlocked layer', () => {
    const base = newDocument();
    const doc: Document = {
      ...base,
      layers: { ...base.layers, hidden: { ...base.layers.hidden, visible: false } },
      entities: {
        l: { id: 'l', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        c: { id: 'c', type: 'circle', layer: '0', center: { x: 50, y: 20 }, radius: 10 },
        h: { id: 'h', type: 'line', layer: 'hidden', a: { x: 0, y: 5 }, b: { x: 100, y: 5 } },
      },
      entityOrder: ['l', 'c', 'h'],
    };
    expect(pick(doc, vec(50, 1), 2)).toBe('l');
    expect(pick(doc, vec(50, 9.5), 2)).toBe('c');
    expect(pick(doc, vec(50, 5), 1)).toBeNull();
    expect(pick(doc, vec(50, 50), 2)).toBeNull();
    const box = documentBox(doc);
    expect(box).toEqual({ min: { x: 0, y: 0 }, max: { x: 100, y: 30 } });
  });
});
