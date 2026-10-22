// Format 4 (M3): constraints validate against the entities they refer to, round-trip exactly,
// go away with their entities (and come back on undo), and format-3 files migrate.

import { describe, expect, it } from 'vitest';
import { apply } from '@shared/commands';
import { newDocument } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import { FORMAT_VERSION, type Constraint, type Document, type Entity } from '@shared/doc/types';

function doc(entities: Entity[], constraints: Constraint[] = []): Document {
  const d = newDocument('Test');
  return { ...d, entities: Object.fromEntries(entities.map((e) => [e.id, e])), entityOrder: entities.map((e) => e.id), constraints: Object.fromEntries(constraints.map((c) => [c.id, c])), constraintOrder: constraints.map((c) => c.id) };
}
const l1: Entity = { id: 'l1', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } };
const l2: Entity = { id: 'l2', type: 'line', layer: '0', a: { x: 50, y: 0 }, b: { x: 50, y: 30 } };
const c1: Entity = { id: 'c1', type: 'circle', layer: '0', center: { x: 25, y: 15 }, radius: 5 };
const pl: Entity = { id: 'pl', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true };
const all: Constraint[] = [
  { id: 'k1', kind: 'coincident', p1: { entity: 'l1', point: 'b' }, p2: { entity: 'l2', point: 'a' } },
  { id: 'k2', kind: 'horizontal', entity: 'l1' },
  { id: 'k3', kind: 'perpendicular', a: 'l1', b: 'l2' },
  { id: 'k4', kind: 'distance', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'l1', point: 'b' }, value: 50.000000000000014 },
  { id: 'k5', kind: 'radius', entity: 'c1', value: 5 },
  { id: 'k6', kind: 'tangent', a: 'l1', b: 'c1' },
  { id: 'k7', kind: 'fixed', entity: 'pl' },
  { id: 'k8', kind: 'pointOnLine', p: { entity: 'pl', point: 2 }, line: 'l2' },
  { id: 'k9', kind: 'symmetric', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'l1', point: 'b' }, line: 'l2' },
  { id: 'k10', kind: 'angle', a: 'l1', b: 'l2', value: Math.PI / 2 },
];

describe('format 4', () => {
  it('round-trips constraints and driving dimensions exactly', () => {
    const d = doc([l1, l2, c1, pl, { id: 'd', type: 'dimension', kind: 'linear', layer: 'dimensions', a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, position: { x: 25, y: -10 }, rotation: 0, driving: 50 }], all);
    const text = serialize(d);
    const back = parse(text);
    expect(back.ok, back.ok ? '' : back.error.message).toBe(true);
    if (!back.ok) return;
    expect(back.doc.constraints).toEqual(d.constraints);
    expect(back.doc.constraintOrder).toEqual(d.constraintOrder);
    expect((back.doc.entities.d as { driving?: number }).driving).toBe(50);
    expect(serialize(back.doc)).toBe(text);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys.indexOf('constraints')).toBeGreaterThan(keys.indexOf('entities'));
    expect(keys.indexOf('constraints')).toBeLessThan(keys.indexOf('sheetOrder'));
  });

  it('refuses constraints that point at the wrong entity or point', () => {
    const cases: [Constraint, string][] = [
      [{ id: 'x', kind: 'horizontal', entity: 'c1' }, 'must be a line'],
      [{ id: 'x', kind: 'coincident', p1: { entity: 'c1', point: 'a' }, p2: { entity: 'l1', point: 'a' } }, 'has no point'],
      [{ id: 'x', kind: 'pointOnLine', p: { entity: 'pl', point: 7 }, line: 'l1' }, 'vertex 7'],
      [{ id: 'x', kind: 'parallel', a: 'l1', b: 'l1' }, 'same line'],
      [{ id: 'x', kind: 'radius', entity: 'c1', value: -1 }, 'radius'],
      [{ id: 'x', kind: 'distance', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'nope', point: 'a' }, value: 1 }, 'unknown entity'],
    ];
    for (const [c, word] of cases) {
      const r = parse(serialize(doc([l1, l2, c1, pl], [c])));
      expect(r.ok, word).toBe(false);
      if (!r.ok) expect(r.error.message).toContain(word);
    }
  });

  it('deleting an entity removes its constraints, and undo restores both', () => {
    const d = doc([l1, l2, c1, pl], all);
    const r = apply(d, { kind: 'deleteEntities', ids: ['c1'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.constraintOrder).toEqual(all.filter((c) => c.id !== 'k5' && c.id !== 'k6').map((c) => c.id));
    const back = apply(r.doc, r.inverse);
    expect(back.ok && serialize(back.doc)).toBe(serialize(d));
  });

  it('constraint commands add, update and delete with exact inverses', () => {
    const d = doc([l1, l2]);
    const add = apply(d, { kind: 'addConstraints', constraints: [all[0], all[1]] });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(add.doc.constraintOrder).toEqual(['k1', 'k2']);
    const upd = apply(add.doc, { kind: 'updateConstraints', constraints: [{ id: 'k2', kind: 'vertical', entity: 'l1' }] });
    expect(upd.ok && upd.doc.constraints.k2.kind).toBe('vertical');
    const del = apply(add.doc, { kind: 'deleteConstraints', ids: ['k1'] });
    expect(del.ok && del.doc.constraintOrder).toEqual(['k2']);
    expect(apply(d, { kind: 'addConstraints', constraints: [{ id: 'z', kind: 'horizontal', entity: 'nope' }] })).toMatchObject({ ok: false, error: { code: 'unknown-entity' } });
    expect(apply(add.doc, { kind: 'addConstraints', constraints: [all[0]] })).toMatchObject({ ok: false, error: { code: 'duplicate-id' } });
  });

  it('migrates a format-3 file with empty constraints', () => {
    const raw = JSON.parse(serialize(doc([l1]))) as Record<string, unknown>;
    raw.version = 3;
    delete raw.constraints;
    delete raw.constraintOrder;
    const r = parse(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(3);
    expect(r.doc.version).toBe(FORMAT_VERSION);
    expect(r.doc.constraintOrder).toEqual([]);
  });
});
