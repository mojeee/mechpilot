// DXF import and export (shared/dxf, docs/dxf.md): exact round trips (product rule 1), unit
// conversion, block expansion and plain-language warnings (product rule 5).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDocument } from '@shared/doc/document';
import { serialize } from '@shared/doc/file';
import type { Document, Entity, Layer } from '@shared/doc/types';
import { ellipsePoint, interpolateSpline } from '@shared/geometry/flatten';
import { sequentialIds } from '@shared/ids';
import { DXF_VERSIONS, ISO_TO_DXF_LINETYPE, aciToRgb, dxfExportNotes, isoLineTypeFor, nearestAci, readDxf, writeDxf, type DxfWarning } from '@shared/dxf';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'dxf', name), 'utf8');
/** The same text with LF or CRLF line endings, whatever git did on checkout. */
const lf = (s: string): string => s.replace(/\r\n/g, '\n');
const crlf = (s: string): string => lf(s).replace(/\n/g, '\r\n');

function read(text: string, name = 'Test') {
  const r = readDxf(text, { name, ids: sequentialIds('e') });
  if (!r.ok) throw new Error(`readDxf failed: ${r.error.message}`);
  return r;
}
const byType = (doc: Document, type: Entity['type']): Entity[] => doc.entityOrder.map((id) => doc.entities[id]).filter((e) => e.type === type);
const warning = (ws: DxfWarning[], code: string, text?: string): DxfWarning | undefined => ws.find((w) => w.code === code && (text === undefined || w.message.includes(text)));

const LAYERS: Layer[] = [
  { id: 'outline-thick', name: 'Outline-Thick', color: '#ff0000', lineType: '01.2', lineWidth: 0.7, visible: true, locked: false },
  { id: 'thin', name: 'thin', color: '#123456', lineType: '01.1', lineWidth: 0.35, visible: false, locked: true },
  { id: 'phantom', name: 'phantom', color: '#abcdef', lineType: '05.1', lineWidth: 0.18, visible: true, locked: true },
  { id: 'cut', name: 'cut', color: 'auto', lineType: '04.2', lineWidth: 0.5, visible: true, locked: false },
];

/** A document with every entity type, on layers with different colours, line types and widths. */
function sampleDoc(): Document {
  const doc = newDocument('Round trip');
  const id = sequentialIds('e');
  const fit = [
    { x: 0, y: 0 },
    { x: 10, y: 15 },
    { x: 25, y: 5 },
    { x: 40, y: 20 },
    { x: 55.5, y: 0.125 },
  ];
  const s = interpolateSpline(fit);
  const entities: Entity[] = [
    { id: id(), type: 'line', layer: '0', a: { x: 0.1 + 0.2, y: 123456.789012345678 }, b: { x: -1e-7, y: 25.4 / 3 } },
    { id: id(), type: 'circle', layer: 'outline-thick', center: { x: 50, y: -20.5 }, radius: Math.PI },
    { id: id(), type: 'arc', layer: 'hidden', center: { x: 10, y: 10 }, radius: 7.25, start: 5.5, end: 0.5 },
    { id: id(), type: 'polyline', layer: 'thin', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 7.5 }], closed: false },
    {
      id: id(),
      type: 'polyline',
      layer: 'phantom',
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }],
      closed: true,
      bulges: [0.5, 0, -0.75, 0],
    },
    { id: id(), type: 'ellipse', layer: 'cut', center: { x: 5, y: 6 }, major: { x: 10, y: 3 }, ratio: 0.4, start: 0.3, end: 4.1 },
    { id: id(), type: 'spline', layer: 'centre', degree: s.degree, controlPoints: s.controlPoints, knots: s.knots, fitPoints: fit, closed: false },
    { id: id(), type: 'text', layer: 'dimensions', position: { x: 12.5, y: -3 }, text: 'Ø20 ±0.1 at 20 °C — ü', height: 3.5, rotation: 0.3 },
  ];
  return {
    ...doc,
    layers: { ...doc.layers, ...Object.fromEntries(LAYERS.map((l) => [l.id, l])) },
    layerOrder: [...doc.layerOrder, ...LAYERS.map((l) => l.id)],
    activeLayer: 'outline-thick',
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    entityOrder: entities.map((e) => e.id),
  };
}

describe('writeDxf', () => {
  it('writes the version, mm units, extents and CRLF line endings', () => {
    for (const v of DXF_VERSIONS) {
      const text = writeDxf(sampleDoc(), { version: v.id });
      expect(text).toContain(`$ACADVER\r\n  1\r\n${v.acadver}\r\n`);
      expect(text).toContain('$INSUNITS\r\n 70\r\n4\r\n');
      expect(text).toContain('$EXTMIN');
      expect(text).toContain('$EXTMAX');
      expect(text.endsWith('  0\r\nEOF\r\n')).toBe(true);
      expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });

  it('writes LWPOLYLINE, ELLIPSE, SPLINE and lineweights on 2000, and none of them on R12', () => {
    const v2000 = writeDxf(sampleDoc(), { version: '2000' });
    for (const s of ['LWPOLYLINE', 'ELLIPSE', 'SPLINE', '370\r\n70\r\n', '420\r\n']) expect(v2000).toContain(s);
    const r12 = writeDxf(sampleDoc(), { version: 'R12' });
    for (const s of ['LWPOLYLINE', '\r\nELLIPSE\r\n', '\r\nSPLINE\r\n', '\r\n370\r\n', '\r\n420\r\n']) expect(r12).not.toContain(s);
    expect(r12).toContain('POLYLINE');
    expect(r12).toContain('SEQEND');
  });

  it('never rounds: lengths are written with String(n)', () => {
    const text = writeDxf(sampleDoc(), { version: '2000' });
    expect(text).toContain(`\r\n${String(0.1 + 0.2)}\r\n`);
    expect(text).toContain(`\r\n${String(123456.789012345678)}\r\n`);
    expect(text).toContain(`\r\n${String(Math.PI)}\r\n`);
  });

  it('maps ISO line types to DXF and back', () => {
    expect(ISO_TO_DXF_LINETYPE['01.2']).toBe('CONTINUOUS');
    expect(ISO_TO_DXF_LINETYPE['01.1-zigzag']).toBe('CONTINUOUS');
    expect(ISO_TO_DXF_LINETYPE['02.1']).toBe('HIDDEN');
    expect(ISO_TO_DXF_LINETYPE['04.2']).toBe('CENTER');
    expect(ISO_TO_DXF_LINETYPE['05.1']).toBe('PHANTOM');
    expect(isoLineTypeFor('Continuous', 0.5, 'x')).toBe('01.2');
    expect(isoLineTypeFor('CONTINUOUS', 0.35, '0')).toBe('01.1');
    expect(isoLineTypeFor('CONTINUOUS', undefined, '0')).toBe('01.2');
    expect(isoLineTypeFor('CONTINUOUS', undefined, 'other')).toBe('01.1');
    expect(isoLineTypeFor('dashed2', undefined, 'x')).toBe('02.1');
    expect(isoLineTypeFor('CENTER2', 0.25, 'x')).toBe('04.1');
    expect(isoLineTypeFor('DASHDOT', undefined, 'x')).toBe('05.1');
    expect(isoLineTypeFor('BORDER', undefined, 'x')).toBeNull();
  });

  it('maps colours to the AutoCAD Color Index', () => {
    expect(aciToRgb(1)).toBe(0xff0000);
    expect(aciToRgb(5)).toBe(0x0000ff);
    expect(aciToRgb(10)).toBe(0xff0000);
    expect(aciToRgb(11)).toBe(0xff7f7f);
    expect(aciToRgb(20)).toBe(0xff3f00);
    expect(nearestAci(0xff0000)).toBe(1);
    expect(nearestAci(0x00ff00)).toBe(3);
    expect(nearestAci(0xffffff)).toBe(255); // 7 is kept for "auto"
  });
});

describe('dxfExportNotes', () => {
  it('is empty for a document with only lines on 2000', () => {
    const doc = newDocument('Lines');
    const lines: Entity[] = [
      { id: 'a', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: 'b', type: 'line', layer: 'hidden', a: { x: 1, y: 1 }, b: { x: 2, y: 0 } },
    ];
    const d = { ...doc, entities: Object.fromEntries(lines.map((e) => [e.id, e])), entityOrder: lines.map((e) => e.id) };
    expect(dxfExportNotes(d, '2000')).toEqual([]);
    expect(dxfExportNotes(d, 'R12')).toEqual([]);
  });

  it('lists the ellipses and splines R12 approximates, and nothing for 2000', () => {
    const notes = dxfExportNotes(sampleDoc(), 'R12');
    expect(notes.map((n) => [n.code, n.count])).toEqual([
      ['ellipse-flattened', 1],
      ['spline-flattened', 1],
    ]);
    expect(notes[0].message).toContain('0.01 mm');
    expect(dxfExportNotes(sampleDoc(), '2000')).toEqual([]);
  });

  it('warns about layer names DXF cannot hold and texts with line breaks', () => {
    const doc = newDocument('x');
    const bad: Layer = { id: 'bad', name: 'a/b', color: 'auto', lineType: '01.1', lineWidth: 0.25, visible: true, locked: false };
    const twin: Layer = { ...bad, id: 'twin', name: 'HIDDEN' };
    const text: Entity = { id: 't', type: 'text', layer: '0', position: { x: 0, y: 0 }, text: 'one\ntwo', height: 2.5, rotation: 0 };
    const d: Document = { ...doc, layers: { ...doc.layers, bad, twin }, layerOrder: [...doc.layerOrder, 'bad', 'twin'], entities: { t: text }, entityOrder: ['t'] };
    const notes = dxfExportNotes(d, '2000');
    expect(warning(notes, 'layer-renamed')?.count).toBe(2);
    expect(warning(notes, 'text-joined')?.count).toBe(1);
    const back = read(writeDxf(d, { version: '2000' }));
    expect(back.doc.layerOrder.map((id) => back.doc.layers[id].name)).toEqual(['0', 'Hidden', 'Centre', 'Dimensions', 'a_b', 'HIDDEN_2']);
    expect((byType(back.doc, 'text')[0] as Entity & { type: 'text' }).text).toBe('one two');
  });
});

describe('round trip, DXF 2000', () => {
  it('keeps every entity and layer: exact except angles in degrees', () => {
    const doc = sampleDoc();
    const r = read(writeDxf(doc, { version: '2000' }), doc.name);
    const back = r.doc;
    expect(r.warnings).toEqual([]);
    expect(back.entityOrder).toEqual(doc.entityOrder);

    // ARC (50/51) and TEXT (50) angles go through degrees: equal to 10 decimals.
    const arc = back.entities.e3;
    const text = back.entities.e8;
    if (arc.type !== 'arc' || text.type !== 'text') throw new Error('types');
    expect(arc.start).toBeCloseTo(5.5, 10);
    expect(arc.end).toBeCloseTo(0.5, 10);
    expect(text.rotation).toBeCloseTo(0.3, 10);
    const fixed: Document = {
      ...back,
      entities: { ...back.entities, e3: { ...arc, start: 5.5, end: 0.5 }, e8: { ...text, rotation: 0.3 } },
    };
    // Everything else, including the layers (names, colours, line types, widths, visible,
    // locked), the active layer and every coordinate, is identical.
    expect(serialize(fixed)).toBe(serialize(doc));
  });

  it('keeps exact numbers: 0.1 + 0.2 and 123456.789012345678', () => {
    for (const version of ['R12', '2000'] as const) {
      const back = read(writeDxf(sampleDoc(), { version })).doc;
      const line = back.entities.e1;
      if (line.type !== 'line') throw new Error('type');
      expect(line.a.x).toBe(0.1 + 0.2);
      expect(line.a.y).toBe(123456.789012345678);
      expect(line.b.x).toBe(-1e-7);
      expect(line.b.y).toBe(25.4 / 3);
    }
  });
});

describe('round trip, DXF R12', () => {
  it('keeps lines, circles, arcs and polylines exactly; ellipses and splines become polylines', () => {
    const doc = sampleDoc();
    const back = read(writeDxf(doc, { version: 'R12' }), doc.name).doc;
    expect(back.entityOrder).toHaveLength(8);
    for (const id of ['e1', 'e2', 'e4', 'e5']) expect(back.entities[id]).toEqual(doc.entities[id]);
    const arc = back.entities.e3;
    if (arc.type !== 'arc') throw new Error('type');
    expect(arc.center).toEqual({ x: 10, y: 10 });
    expect(arc.radius).toBe(7.25);
    expect(arc.start).toBeCloseTo(5.5, 10);
    expect(arc.end).toBeCloseTo(0.5, 10);

    const ellipse = back.entities.e6;
    const spline = back.entities.e7;
    if (ellipse.type !== 'polyline' || spline.type !== 'polyline') throw new Error('flattened curves are polylines');
    const src = doc.entities.e6;
    if (src.type !== 'ellipse') throw new Error('type');
    expect(ellipse.points[0].x).toBeCloseTo(ellipsePoint(src, src.start).x, 9);
    expect(ellipse.points[ellipse.points.length - 1].y).toBeCloseTo(ellipsePoint(src, src.end).y, 9);
    expect(ellipse.closed).toBe(false);
    expect(spline.points[0]).toEqual({ x: 0, y: 0 });
    expect(spline.points[spline.points.length - 1].x).toBeCloseTo(55.5, 9);

    // Layers: names, line types, visibility and locks survive; R12 has no lineweights or true colour.
    const layers = back.layerOrder.map((id) => back.layers[id]);
    expect(layers.map((l) => l.name)).toEqual(doc.layerOrder.map((id) => doc.layers[id].name));
    expect(layers.map((l) => l.lineType)).toEqual(['01.2', '02.1', '04.1', '01.1', '01.1', '01.1', '05.1', '04.1']);
    expect(back.layers.thin.visible).toBe(false);
    expect(back.layers.thin.locked).toBe(true);
    expect(back.layers['0'].color).toBe('auto');
    expect(back.layers['outline-thick'].color).toBe('#ff0000');
    expect(back.activeLayer).toBe('outline-thick');
  });

  it('writes a full ellipse as a closed polyline', () => {
    const doc = newDocument('e');
    const e: Entity = { id: 'x', type: 'ellipse', layer: '0', center: { x: 0, y: 0 }, major: { x: 20, y: 0 }, ratio: 0.5, start: 0, end: Math.PI * 2 };
    const back = read(writeDxf({ ...doc, entities: { x: e }, entityOrder: ['x'] }, { version: 'R12' })).doc;
    const p = back.entities.e1;
    if (p.type !== 'polyline') throw new Error('type');
    expect(p.closed).toBe(true);
    for (const pt of p.points) expect((pt.x / 20) ** 2 + (pt.y / 10) ** 2).toBeCloseTo(1, 9);
  });
});

describe('readDxf fixtures', () => {
  for (const [label, eol] of [
    ['LF', lf],
    ['CRLF', crlf],
  ] as const) {
    it(`(a) a hand-written R12 file in inches with a block insert, a hatch and a dimension (${label})`, () => {
      const r = read(eol(fixture('r12-inches.dxf')));
      const doc = r.doc;
      expect(doc.entityOrder).toHaveLength(4);
      expect(byType(doc, 'polyline')).toHaveLength(1);
      expect(byType(doc, 'line')).toHaveLength(2);
      expect(byType(doc, 'circle')).toHaveLength(1);

      // Lengths × 25.4, exactly.
      const pl = byType(doc, 'polyline')[0];
      if (pl.type !== 'polyline') throw new Error('type');
      expect(pl.closed).toBe(true);
      expect(pl.points).toEqual([
        { x: 0, y: 0 },
        { x: 4 * 25.4, y: 0 },
        { x: 4 * 25.4, y: 2.125 * 25.4 },
        { x: 0, y: 2.125 * 25.4 },
      ]);
      expect(pl.bulges).toEqual([0, 1, 0, 0]);
      expect(pl.layer).toBe('outline');
      const line = byType(doc, 'line')[0];
      if (line.type !== 'line') throw new Error('type');
      expect(line.a).toEqual({ x: -1.5 * 25.4, y: 0.1 * 25.4 });

      // The block BOLT, inserted at (100, 50) in, scale 2, rotated 90°: its circle (10, 0) r 5
      // lands at (100, 70) in, r 10 in; it was on layer 0, so it takes the INSERT's layer.
      const c = byType(doc, 'circle')[0];
      if (c.type !== 'circle') throw new Error('type');
      expect(c.center.x).toBeCloseTo(2540, 9);
      expect(c.center.y).toBeCloseTo(1778, 9);
      expect(c.radius).toBeCloseTo(254, 9);
      expect(c.layer).toBe('hidden');
      const bl = byType(doc, 'line')[1];
      if (bl.type !== 'line') throw new Error('type');
      expect(bl.layer).toBe('outline');
      expect(bl.a.x).toBeCloseTo(2540, 9);
      expect(bl.a.y).toBeCloseTo(1270, 9);
      expect(bl.b.x).toBeCloseTo(2540, 9);
      expect(bl.b.y).toBeCloseTo(1778, 9);

      // Layers from the table.
      expect(doc.layerOrder).toEqual(['0', 'outline', 'hidden']);
      expect(doc.layers['0']).toMatchObject({ color: 'auto', lineType: '01.2', lineWidth: 0.5 });
      expect(doc.layers.outline).toMatchObject({ color: '#ff0000', lineType: '01.1', lineWidth: 0.25 });
      expect(doc.layers.hidden).toMatchObject({ color: '#ffff00', lineType: '02.1', lineWidth: 0.25 });
      expect(doc.activeLayer).toBe('outline');

      // Warnings, grouped with counts.
      expect(r.warnings.map((w) => w.code).sort()).toEqual(['units-converted', 'unsupported-entity', 'unsupported-entity']);
      expect(warning(r.warnings, 'units-converted')?.message).toContain('inches');
      expect(warning(r.warnings, 'unsupported-entity', 'HATCH')?.count).toBe(1);
      expect(warning(r.warnings, 'unsupported-entity', 'DIMENSION')?.message).toBe('1 entities of type DIMENSION are not supported yet and were skipped.');
    });

    it(`(b) a 2000 file with LWPOLYLINE bulges, MTEXT codes, a frozen layer and true colour (${label})`, () => {
      const r = read(eol(fixture('ac1015-features.dxf')));
      const doc = r.doc;
      expect(doc.entityOrder).toHaveLength(4);

      const pl = byType(doc, 'polyline')[0];
      if (pl.type !== 'polyline') throw new Error('type');
      expect(pl.closed).toBe(true);
      expect(pl.points).toEqual([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 25 },
        { x: 0, y: 25 },
      ]);
      expect(pl.bulges).toEqual([0.5, 0, -0.25, 0]);
      expect(pl.layer).toBe('true-colour');

      const text = byType(doc, 'text')[0];
      if (text.type !== 'text') throw new Error('type');
      expect(text.text).toBe('Hello World Ø10 1/2 mm \\path {x}');
      expect(text.position).toEqual({ x: 5, y: 30 });
      expect(text.height).toBe(3.5);
      expect(text.rotation).toBe(Math.PI / 2);

      // A circle with extrusion (0, 0, -1): OCS x is mirrored.
      const c = byType(doc, 'circle')[0];
      if (c.type !== 'circle') throw new Error('type');
      expect(c.center).toEqual({ x: -10, y: 5 });
      expect(c.radius).toBe(2.5);

      const arc = byType(doc, 'arc')[0];
      if (arc.type !== 'arc') throw new Error('type');
      expect(arc.start).toBe((350 * Math.PI) / 180);
      expect(arc.end).toBe((10 * Math.PI) / 180);
      expect(arc.layer).toBe('ghost');

      expect(doc.layerOrder).toEqual(['0', 'frozen-parts', 'true-colour', 'off', 'odd', 'ghost']);
      expect(doc.layers['0']).toMatchObject({ name: '0', color: 'auto', lineType: '01.2', lineWidth: 0.5, visible: true, locked: false });
      expect(doc.layers['frozen-parts']).toMatchObject({ name: 'Frozen parts', color: '#00ff00', lineType: '01.1', lineWidth: 0.35, visible: false, locked: false });
      expect(doc.layers['true-colour']).toMatchObject({ color: '#123456', lineType: '02.2', lineWidth: 0.5, visible: true, locked: true });
      expect(doc.layers.off).toMatchObject({ color: '#ff0000', lineType: '04.1', lineWidth: 0.25, visible: false });
      expect(doc.layers.odd).toMatchObject({ color: '#ff7f00', lineType: '01.1' });
      expect(doc.layers.ghost).toMatchObject({ color: 'auto', lineType: '01.1', lineWidth: 0.25 });

      expect(r.warnings.map((w) => [w.code, w.count])).toEqual([
        ['unknown-linetype', 1],
        ['entity-overrides', 1],
        ['missing-layer', 1],
        ['unsupported-entity', 2],
        ['paper-space', 1],
      ]);
      expect(warning(r.warnings, 'unknown-linetype')?.message).toContain('ZIGZAG_SPECIAL');
      expect(warning(r.warnings, 'missing-layer')?.message).toContain('Ghost');
      expect(warning(r.warnings, 'unsupported-entity')?.message).toContain('POINT');
    });
  }

  it('(c) refuses text that is not DXF, in plain words with a hint', () => {
    for (const text of ['hello world\nthis is not a drawing\n', '', '{"format":"mechpilot"}', '  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n']) {
      const r = readDxf(text);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('not-dxf');
      expect(r.error.message).toBe('This file is not a DXF drawing.');
      expect(r.error.hint).toBeTruthy();
    }
    const bin = readDxf('AutoCAD Binary DXF\r\n\u001a\u0000');
    expect(bin.ok).toBe(false);
    if (!bin.ok) expect(bin.error.code).toBe('binary-dxf');
  });

  it('(d) assumes mm when the file has no units, no HEADER, no TABLES and no EOF', () => {
    const r = read(fixture('no-units.dxf'));
    const doc = r.doc;
    expect(doc.name).toBe('Test');
    const line = byType(doc, 'line')[0];
    if (line.type !== 'line') throw new Error('type');
    expect(line.a).toEqual({ x: 1.5, y: 2.5 });
    expect(line.b).toEqual({ x: 101.5, y: 2.5 });
    expect(line.layer).toBe('part');
    const c = byType(doc, 'circle')[0];
    expect(c.layer).toBe('0');
    // The default layers, plus the one the drawing used.
    expect(doc.layerOrder).toEqual(['0', 'hidden', 'centre', 'dimensions', 'part']);
    expect(warning(r.warnings, 'units-assumed')?.count).toBe(1);
    expect(warning(r.warnings, 'missing-layer')?.message).toContain('Part');
    expect(warning(r.warnings, 'z-dropped')?.count).toBe(1);
  });

  it('(e) expands nested inserts, arrays and mirrored inserts, and stops at 8 levels', () => {
    const r = read(fixture('nested-insert.dxf'));
    const lines = byType(r.doc, 'line').map((e) => (e.type === 'line' ? e : null)).filter((e) => e !== null);
    expect(lines).toHaveLength(16);
    const near = (a: { x: number; y: number }, x: number, y: number) => {
      expect(a.x).toBeCloseTo(x, 9);
      expect(a.y).toBeCloseTo(y, 9);
    };
    // OUTER (base 5,0) at (100,100) ×3 holds INNER at (15,0) rotated 90°: (0,0)-(1,0) → (130,100)-(130,103).
    near(lines[0].a, 130, 100);
    near(lines[0].b, 130, 103);
    expect(lines[0].layer).toBe('parts'); // layer 0 inside blocks takes the INSERT's layer, through both levels
    // A 3 × 2 array, columns 5 apart, rows −2 apart.
    const array = lines.slice(1, 7).map((l) => [l.a.x, l.a.y, l.b.x, l.b.y]);
    expect(array).toEqual([
      [0, 0, 1, 0],
      [5, 0, 6, 0],
      [10, 0, 11, 0],
      [0, -2, 1, -2],
      [5, -2, 6, -2],
      [10, -2, 11, -2],
    ]);
    // Mirrored insert (x scale −1).
    near(lines[7].a, 0, -10);
    near(lines[7].b, -1, -10);
    // A block that inserts itself: 8 levels are expanded, then one warning.
    const loop = lines.slice(8);
    expect(loop.map((l) => l.a.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(loop.every((l) => l.layer === 'loops')).toBe(true);
    expect(warning(r.warnings, 'block-depth')?.count).toBe(1);
    expect(warning(r.warnings, 'missing-block')?.message).toContain('NOWHERE');
    expect(warning(r.warnings, 'units-assumed')).toBeUndefined();
  });
});

describe('readDxf details', () => {
  const wrap = (entities: string, header = '  9\n$INSUNITS\n 70\n4\n') => `  0\nSECTION\n  2\nHEADER\n${header}  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n${entities}  0\nENDSEC\n  0\nEOF\n`;

  it('converts other units with their factor and says so', () => {
    const r = read(wrap('  0\nLINE\n  8\n0\n 10\n1\n 20\n2\n 11\n3\n 21\n4\n', '  9\n$INSUNITS\n 70\n6\n'));
    const line = r.doc.entities.e1;
    if (line.type !== 'line') throw new Error('type');
    expect(line.a).toEqual({ x: 1000, y: 2000 });
    expect(warning(r.warnings, 'units-converted')?.message).toBe('The drawing was in metres; every length was converted to millimetres (× 1000).');
  });

  it('reads TEXT angles in degrees, %% codes and \\U+ escapes', () => {
    const r = read(wrap('  0\nTEXT\n  8\n0\n 10\n1\n 20\n2\n 40\n2.5\n 50\n90\n  1\n%%c12 %%p0.1 30%%d \\U+00FC\n'));
    const tx = r.doc.entities.e1;
    if (tx.type !== 'text') throw new Error('type');
    expect(tx.text).toBe('Ø12 ±0.1 30° ü');
    expect(tx.rotation).toBe(Math.PI / 2);
  });

  it('reads ELLIPSE parameters in radians and a SPLINE given only by fit points', () => {
    const r = read(
      wrap(
        '  0\nELLIPSE\n  8\n0\n 10\n0\n 20\n0\n 11\n10\n 21\n0\n 40\n0.5\n 41\n0\n 42\n3.141592653589793\n' +
          '  0\nSPLINE\n  8\n0\n 70\n8\n 71\n3\n 72\n0\n 73\n0\n 74\n4\n 11\n0\n 21\n0\n 11\n10\n 21\n5\n 11\n20\n 21\n0\n 11\n30\n 21\n5\n',
      ),
    );
    const el = r.doc.entities.e1;
    const sp = r.doc.entities.e2;
    if (el.type !== 'ellipse' || sp.type !== 'spline') throw new Error('types');
    expect(el).toMatchObject({ major: { x: 10, y: 0 }, ratio: 0.5, start: 0, end: Math.PI });
    expect(sp.fitPoints).toHaveLength(4);
    expect(sp.controlPoints).toEqual(interpolateSpline(sp.fitPoints ?? []).controlPoints);
    expect(sp.knots).toHaveLength(sp.controlPoints.length + sp.degree + 1);
  });

  it('skips 3D polylines, warns about non-uniform scale and keeps a mirrored arc counter-clockwise', () => {
    const blocks = '  0\nSECTION\n  2\nBLOCKS\n  0\nBLOCK\n  2\nA\n 10\n0\n 20\n0\n  0\nARC\n  8\n0\n 10\n0\n 20\n0\n 40\n1\n 50\n0\n 51\n90\n  0\nENDBLK\n  0\nENDSEC\n';
    const ents =
      '  0\nPOLYLINE\n  8\n0\n 66\n1\n 70\n8\n  0\nVERTEX\n 10\n0\n 20\n0\n 30\n1\n  0\nVERTEX\n 10\n1\n 20\n1\n 30\n2\n  0\nSEQEND\n' +
      '  0\nINSERT\n  8\n0\n  2\nA\n 10\n0\n 20\n0\n 41\n-1\n 42\n1\n' +
      '  0\nINSERT\n  8\n0\n  2\nA\n 10\n0\n 20\n0\n 41\n2\n 42\n3\n';
    const r = read(`  0\nSECTION\n  2\nHEADER\n  9\n$INSUNITS\n 70\n4\n  0\nENDSEC\n${blocks}  0\nSECTION\n  2\nENTITIES\n${ents}  0\nENDSEC\n  0\nEOF\n`);
    expect(warning(r.warnings, 'polyline-3d')?.count).toBe(1);
    expect(warning(r.warnings, 'nonuniform-scale')?.count).toBe(1);
    const arcs = byType(r.doc, 'arc');
    expect(arcs).toHaveLength(2);
    const m = arcs[0];
    if (m.type !== 'arc') throw new Error('type');
    // The quarter arc 0°→90° mirrored in x runs from 90° to 180°.
    expect(m.start).toBeCloseTo(Math.PI / 2, 12);
    expect(m.end).toBeCloseTo(Math.PI, 12);
    const s = arcs[1];
    if (s.type !== 'arc') throw new Error('type');
    expect(s.radius).toBe(2);
  });
});
