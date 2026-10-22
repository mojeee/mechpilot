// Format 2 (M1): the new entity types validate, round-trip exactly, and format-1 files migrate.

import { describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import { FORMAT_VERSION, type Document, type Entity } from '@shared/doc/types';
import { interpolateSpline } from '@shared/geometry/flatten';

function withEntities(entities: Entity[]): Document {
  const doc = newDocument('Test');
  return { ...doc, entities: Object.fromEntries(entities.map((e) => [e.id, e])), entityOrder: entities.map((e) => e.id) };
}

const sp = interpolateSpline([
  { x: 0, y: 0 },
  { x: 10, y: 7.3 },
  { x: 20, y: -2.1 },
  { x: 35, y: 4 },
]);
const all: Entity[] = [
  { id: 'p1', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], closed: false },
  { id: 'p2', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true, bulges: [0, 0.41421356237309503, 0, -0.2] },
  { id: 'el', type: 'ellipse', layer: '0', center: { x: 5, y: 5 }, major: { x: 10, y: 2 }, ratio: 0.5, start: 0.3, end: 4.1 },
  { id: 'sp', type: 'spline', layer: '0', ...sp, fitPoints: [{ x: 0, y: 0 }, { x: 10, y: 7.3 }, { x: 20, y: -2.1 }, { x: 35, y: 4 }], closed: false },
  { id: 'tx', type: 'text', layer: 'dimensions', position: { x: 1.5, y: 2.5 }, text: 'Ø12 H7', height: 3.5, rotation: Math.PI / 6 },
];

describe('format 2 entities', () => {
  it('round-trips every new entity type exactly', () => {
    const doc = withEntities(all);
    const text = serialize(doc);
    const back = parse(text);
    expect(back.ok, back.ok ? '' : back.error.message).toBe(true);
    if (!back.ok) return;
    expect(back.doc.entities).toEqual(doc.entities);
    expect(serialize(back.doc)).toBe(text);
  });

  it('drops an all-zero bulges array and keeps a real one', () => {
    const z = withEntities([{ id: 'p', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false, bulges: [0] }]);
    const r = parse(serialize(z));
    expect(r.ok && (r.doc.entities.p as { bulges?: number[] }).bulges).toBeUndefined();
  });

  it('refuses broken entities with the field named', () => {
    const bad: [Entity, string][] = [
      [{ id: 'a', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }], closed: false }, 'two points'],
      [{ id: 'b', type: 'ellipse', layer: '0', center: { x: 0, y: 0 }, major: { x: 1, y: 0 }, ratio: 1.5, start: 0, end: 1 }, 'ratio'],
      [{ id: 'c', type: 'spline', layer: '0', degree: 3, controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], knots: [0, 0, 1, 1], closed: false }, 'control points'],
      [{ id: 'd', type: 'spline', layer: '0', degree: 1, controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], knots: [0, 1, 0, 1], closed: false }, 'knots'],
      [{ id: 'e', type: 'text', layer: '0', position: { x: 0, y: 0 }, text: 'x', height: 0, rotation: 0 }, 'height'],
    ];
    for (const [e, word] of bad) {
      const r = parse(serialize(withEntities([e])));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain(word);
    }
  });

  it('migrates a format-1 file and reports the old version', () => {
    const raw = JSON.parse(serialize(withEntities([{ id: 'l', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]))) as { version: number };
    raw.version = 1;
    const r = parse(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(1);
    expect(r.doc.version).toBe(FORMAT_VERSION);
    expect(r.doc.entityOrder).toEqual(['l']);
  });
});
