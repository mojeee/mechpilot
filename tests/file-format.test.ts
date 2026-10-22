// The file format: exact round trips (product rule 1), stable ordering (rule 3), plain errors.

import { describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import { parse, serialize, validate } from '@shared/doc/file';
import { FORMAT_VERSION, type Document, type Entity } from '@shared/doc/types';

function withEntities(entities: Entity[]): Document {
  const doc = newDocument('Test');
  return { ...doc, entities: Object.fromEntries(entities.map((e) => [e.id, e])), entityOrder: entities.map((e) => e.id) };
}

describe('serialize', () => {
  it('writes the top-level keys in a fixed order and entities in drawing order', () => {
    const doc = withEntities([
      { id: 'b', type: 'circle', layer: '0', center: { x: 1, y: 2 }, radius: 3 },
      { id: 'a', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
    ]);
    const text = serialize(doc);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys).toEqual(['format', 'version', 'unit', 'name', 'standard', 'projection', 'layerOrder', 'activeLayer', 'layers', 'entityOrder', 'entities']);
    expect(text.indexOf('"b": {')).toBeLessThan(text.indexOf('"a": {'));
    // id, type and layer first, then alphabetical.
    expect(Object.keys((JSON.parse(text) as { entities: Record<string, object> }).entities.b)).toEqual(['id', 'type', 'layer', 'center', 'radius']);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('is deterministic: the same document always gives the same text', () => {
    const doc = withEntities([{ id: 'a', type: 'line', layer: '0', a: { x: 0.1, y: 0.2 }, b: { x: 1e-9, y: 123456.789012345 } }]);
    const again: Document = JSON.parse(JSON.stringify(doc)) as Document;
    expect(serialize(again)).toBe(serialize(doc));
  });

  it('round-trips every double exactly', () => {
    const values = [0.1 + 0.2, 1e-12, 123456.789012345678, -0.0001, 2 ** 53 - 1, Math.PI, 25.4 / 3];
    const doc = withEntities(values.map((v, i) => ({ id: `e${i}`, type: 'line', layer: '0', a: { x: v, y: -v }, b: { x: v * 3, y: v / 7 } })));
    const back = parse(serialize(doc));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    for (let i = 0; i < values.length; i++) {
      const e = back.doc.entities[`e${i}`];
      expect(e.type).toBe('line');
      if (e.type !== 'line') return;
      expect(e.a.x).toBe(values[i]);
      expect(e.a.y).toBe(-values[i]);
      expect(e.b.x).toBe(values[i] * 3);
      expect(e.b.y).toBe(values[i] / 7);
    }
    expect(serialize(back.doc)).toBe(serialize(doc));
  });
});

describe('parse', () => {
  it('says when the text is not JSON', () => {
    const r = parse('{ not json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('not-json');
    expect(r.error.hint).toBeTruthy();
  });

  it('says when the file is not a MechPilot file', () => {
    const r = parse(JSON.stringify({ hello: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('not-mechpilot');
  });

  it('refuses a newer format with a hint to update', () => {
    const r = parse(JSON.stringify({ format: 'mechpilot', version: FORMAT_VERSION + 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('newer-version');
    expect(r.error.hint).toContain('Update');
  });

  it('refuses a document in a unit other than mm', () => {
    const doc = newDocument('x') as unknown as Record<string, unknown>;
    const r = parse(JSON.stringify({ ...doc, unit: 'in' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('invalid');
    expect(r.error.message).toContain('unit');
  });

  it('names the broken field', () => {
    const doc = withEntities([{ id: 'a', type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: -1 }]);
    const r = parse(serialize(doc));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('entity a');
    const unknownLayer = withEntities([{ id: 'a', type: 'line', layer: 'nope', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]);
    const r2 = parse(serialize(unknownLayer));
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.message).toContain('nope');
  });

  it('keeps the description and falls back to the first layer when activeLayer is unknown', () => {
    const raw = { ...(newDocument('x') as unknown as Record<string, unknown>), description: 'hi', activeLayer: 'missing' };
    const d = validate(raw);
    expect(typeof d).not.toBe('string');
    if (typeof d === 'string') return;
    expect(d.description).toBe('hi');
    expect(d.activeLayer).toBe('0');
  });
});
