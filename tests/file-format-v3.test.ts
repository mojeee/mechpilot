// Format 3 (M2): annotations, dimension style and sheets validate, round-trip exactly, and
// format-2 files get the defaults.

import { describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import { FORMAT_VERSION, type Document, type Entity, type Sheet } from '@shared/doc/types';

function withEntities(entities: Entity[], sheets: Sheet[] = []): Document {
  const doc = newDocument('Test');
  return { ...doc, entities: Object.fromEntries(entities.map((e) => [e.id, e])), entityOrder: entities.map((e) => e.id), sheets: Object.fromEntries(sheets.map((s) => [s.id, s])), sheetOrder: sheets.map((s) => s.id) };
}

const all: Entity[] = [
  { id: 'd1', layer: 'dimensions', type: 'dimension', kind: 'linear', a: { x: 0, y: 0 }, b: { x: 80.123456789, y: 0 }, position: { x: 0, y: 20 }, rotation: 0, tolerance: { kind: 'deviation', upper: 0.02, lower: -0.01 }, decimals: 3 },
  { id: 'd2', layer: 'dimensions', type: 'dimension', kind: 'angular', a: { x: 10, y: 0 }, b: { x: 0, y: 10 }, position: { x: 7, y: 7 }, rotation: 0, center: { x: 0, y: 0 } },
  { id: 'd3', layer: 'dimensions', type: 'dimension', kind: 'diameter', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, position: { x: 20, y: 20 }, rotation: 0, tolerance: { kind: 'fit', cls: 'H7' }, text: '4× <>' },
  { id: 'n', layer: 'dimensions', type: 'note', position: { x: 0, y: 0 }, text: 'A\nB', height: 3.5, rotation: 0.1, leader: [{ x: -5, y: -5 }] },
  { id: 'b', layer: 'dimensions', type: 'balloon', position: { x: 50, y: 50 }, text: '12', leader: { x: 1, y: 2 } },
  { id: 's', layer: 'dimensions', type: 'surface', position: { x: 0, y: 0 }, rotation: 0, removal: 'prohibited', ra: 1.6, text: 'ground', leader: { x: 3, y: 3 } },
  { id: 'g', layer: 'dimensions', type: 'gdt', position: { x: 0, y: 0 }, rotation: 0, characteristic: 'position', tolerance: 'Ø0.1', datums: ['A', 'B'], leader: { x: 9, y: 9 } },
  { id: 'dt', layer: 'dimensions', type: 'datum', position: { x: 0, y: 0 }, rotation: Math.PI / 2, label: 'A' },
];
const sheet: Sheet = {
  id: 's1',
  name: 'Sheet 1',
  size: 'A3',
  orientation: 'landscape',
  titleBlock: { title: 'Mounting bracket', 'identification-number': 'MB-001' },
  views: [{ id: 'v1', name: 'Front', scale: 0.5, center: { x: 60, y: 40 }, position: { x: 150, y: 150 }, width: 200, height: 140, label: true }],
};

describe('format 3', () => {
  it('round-trips annotations and sheets exactly', () => {
    const doc = withEntities(all, [sheet]);
    const text = serialize(doc);
    const back = parse(text);
    expect(back.ok, back.ok ? '' : back.error.message).toBe(true);
    if (!back.ok) return;
    expect(back.doc.entities).toEqual(doc.entities);
    expect(back.doc.sheets).toEqual(doc.sheets);
    expect(back.doc.dimStyle).toEqual(doc.dimStyle);
    expect(serialize(back.doc)).toBe(text);
    // Stable order: dimStyle before layers, sheets last.
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys.indexOf('dimStyle')).toBeLessThan(keys.indexOf('layerOrder'));
    expect(keys[keys.length - 1]).toBe('sheets');
  });

  it('refuses broken annotations, styles and sheets with the field named', () => {
    const cases: [Partial<Document>, string][] = [
      [withEntities([{ id: 'x', layer: '0', type: 'dimension', kind: 'angular', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, position: { x: 1, y: 0 }, rotation: 0 }]), 'center'],
      [withEntities([{ id: 'x', layer: '0', type: 'dimension', kind: 'linear', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, position: { x: 1, y: 0 }, rotation: 0, tolerance: { kind: 'fit', cls: 'nope!' } }]), 'fit class'],
      [withEntities([{ id: 'x', layer: '0', type: 'gdt', position: { x: 0, y: 0 }, rotation: 0, characteristic: 'flatness', tolerance: '0.1', datums: ['A', 'B', 'C', 'D'] }]), 'three datums'],
      [{ ...newDocument(), dimStyle: { ...newDocument().dimStyle, decimals: 9 } }, 'decimals'],
      [withEntities([], [{ ...sheet, size: 'B1' as 'A1' }]), 'size'],
      [withEntities([], [{ ...sheet, views: [{ ...sheet.views[0], scale: 0 }] }]), 'scale'],
    ];
    for (const [doc, word] of cases) {
      const r = parse(serialize(doc as Document));
      expect(r.ok, word).toBe(false);
      if (!r.ok) expect(r.error.message).toContain(word);
    }
  });

  it('migrates a format-2 file with the default style and no sheets', () => {
    const raw = JSON.parse(serialize(withEntities([{ id: 'l', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]))) as Record<string, unknown>;
    raw.version = 2;
    delete raw.dimStyle;
    delete raw.sheets;
    delete raw.sheetOrder;
    const r = parse(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(2);
    expect(r.doc.version).toBe(FORMAT_VERSION);
    expect(r.doc.dimStyle.textHeight).toBe(3.5);
    expect(r.doc.sheetOrder).toEqual([]);
  });
});
