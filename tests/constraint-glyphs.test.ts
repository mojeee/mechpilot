// Constraint glyphs: every constraint kind gets a mark near its geometry; point references resolve.

import { describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import type { Constraint, Document, Entity } from '@shared/doc/types';
import { CONSTRAINT_GLYPH, constraintGlyphs, constraintPrims, pointOf } from '@shared/draw/constraints';

function doc(entities: Entity[], constraints: Constraint[]): Document {
  const d = newDocument('t');
  return { ...d, entities: Object.fromEntries(entities.map((e) => [e.id, e])), entityOrder: entities.map((e) => e.id), constraints: Object.fromEntries(constraints.map((c) => [c.id, c])), constraintOrder: constraints.map((c) => c.id) };
}
const l1: Entity = { id: 'l1', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } };
const l2: Entity = { id: 'l2', type: 'line', layer: '0', a: { x: 40, y: 0 }, b: { x: 40, y: 30 } };
const c1: Entity = { id: 'c1', type: 'circle', layer: '0', center: { x: 20, y: 15 }, radius: 5 };
const a1: Entity = { id: 'a1', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
const pl: Entity = { id: 'pl', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false };

describe('constraint glyphs', () => {
  it('resolves point references of every entity kind', () => {
    const d = doc([l1, l2, c1, a1, pl], []);
    expect(pointOf(d, { entity: 'l1', point: 'b' })).toEqual({ x: 40, y: 0 });
    expect(pointOf(d, { entity: 'c1', point: 'center' })).toEqual({ x: 20, y: 15 });
    const end = pointOf(d, { entity: 'a1', point: 'end' });
    expect(end?.x).toBeCloseTo(0, 12);
    expect(end?.y).toBeCloseTo(10, 12);
    expect(pointOf(d, { entity: 'pl', point: 1 })).toEqual({ x: 5, y: 5 });
    expect(pointOf(d, { entity: 'c1', point: 'a' })).toBeNull();
    expect(pointOf(d, { entity: 'nope', point: 'a' })).toBeNull();
  });
  it('makes one glyph per constraint (two for pair constraints) with the value for distances, angles and radii', () => {
    const cs: Constraint[] = [
      { id: 'k1', kind: 'coincident', p1: { entity: 'l1', point: 'b' }, p2: { entity: 'l2', point: 'a' } },
      { id: 'k2', kind: 'horizontal', entity: 'l1' },
      { id: 'k3', kind: 'perpendicular', a: 'l1', b: 'l2' },
      { id: 'k4', kind: 'distance', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'l1', point: 'b' }, value: 40 },
      { id: 'k5', kind: 'radius', entity: 'c1', value: 5 },
      { id: 'k6', kind: 'angle', a: 'l1', b: 'l2', value: Math.PI / 2 },
      { id: 'k7', kind: 'symmetric', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'l1', point: 'b' }, line: 'l2' },
      { id: 'k8', kind: 'pointOnLine', p: { entity: 'pl', point: 0 }, line: 'l1' },
      { id: 'k9', kind: 'fixed', entity: 'a1' },
    ];
    const g = constraintGlyphs(doc([l1, l2, c1, a1, pl], cs), 1);
    expect(g.filter((x) => x.id === 'k1').length).toBe(1);
    expect(g.filter((x) => x.id === 'k3').length).toBe(2);
    expect(g.find((x) => x.id === 'k4')?.text).toBe('↔ 40');
    expect(g.find((x) => x.id === 'k5')?.text).toBe('R5');
    expect(g.find((x) => x.id === 'k6')?.text).toBe('∠90°');
    expect(g.find((x) => x.id === 'k2')?.text).toBe(CONSTRAINT_GLYPH.horizontal);
    // Glyphs sit off the geometry by the offset.
    const h = g.find((x) => x.id === 'k2')!;
    expect(Math.abs(h.at.y)).toBeCloseTo(1, 9);
    expect(constraintPrims(doc([l1, l2, c1, a1, pl], cs), 2).every((p) => p.kind === 'text' && p.height === 2)).toBe(true);
  });
});
