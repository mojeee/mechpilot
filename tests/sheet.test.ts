// Sheets: paper sizes and frames to ISO 5457, the ISO 7200 title block, view transforms, clipping
// and the page assembly used by the PDF export.

import { describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import type { Document, Entity, Sheet } from '@shared/doc/types';
import { clipPrims, sheetPage, viewMatrix, viewPrims } from '@shared/draw/pages';
import { drawingSpace, newSheet, scaleLabel, sheetFramePrims, sheetPaper, titleBlockOrigin, titleBlockPrims, zoneLetters } from '@shared/draw/sheet';
import { applyToPoint } from '@shared/geometry/transform';

const a3: Sheet = { id: 's', name: 'Sheet 1', size: 'A3', orientation: 'landscape', titleBlock: { title: 'Bracket', identificationNumber: 'MB-1', sheetNumber: '1', numberOfSheets: '2' }, views: [] };

describe('sheet layout (ISO 5457, ISO 7200, ISO 5455)', () => {
  it('paper sizes follow ISO 216 and the orientation', () => {
    expect(sheetPaper(a3)).toEqual({ width: 420, height: 297 });
    expect(sheetPaper({ size: 'A4', orientation: 'portrait' })).toEqual({ width: 210, height: 297 });
    expect(sheetPaper({ size: 'A0', orientation: 'landscape' })).toEqual({ width: 1189, height: 841 });
  });
  it('the drawing space has a 20 mm binding margin on the left and 10 mm elsewhere (ISO 5457:1999, 4.2)', () => {
    expect(drawingSpace(a3)).toEqual({ x: 20, y: 10, width: 390, height: 277 });
  });
  it('zone letters skip I and O (ISO 5457:1999, 4.4)', () => {
    expect(zoneLetters(10).join('')).toBe('ABCDEFGHJK');
  });
  it('the frame is a 0.7 mm rectangle around the drawing space, with zone labels and centring marks', () => {
    const prims = sheetFramePrims(a3);
    const frame = prims.find((p) => p.kind === 'polyline' && p.closed && p.points.length === 4 && p.width === 0.7);
    expect(frame).toBeDefined();
    const labels = prims.filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : ''));
    // A3: 8 numbered columns and 6 lettered rows, on all four sides.
    expect(labels.filter((l) => /^\d+$/.test(l)).length).toBe(16);
    expect(labels.filter((l) => /^[A-Z]$/.test(l)).length).toBe(12);
    expect(labels).toContain('8');
    expect(labels).toContain('F');
    expect(labels).not.toContain('I');
  });
  it('the title block is 180 mm wide in the bottom-right corner of the drawing space', () => {
    expect(titleBlockOrigin(a3)).toEqual({ x: 20 + 390 - 180, y: 10 });
    const prims = titleBlockPrims(a3, 'en');
    const texts = prims.filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : ''));
    expect(texts).toContain('Bracket');
    expect(texts).toContain('MB-1');
    expect(texts).toContain('1/2');
    expect(texts).toContain('Title');
    const it = titleBlockPrims(a3, 'it').filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : ''));
    expect(it).toContain('Titolo');
  });
  it('scale labels follow ISO 5455', () => {
    expect(scaleLabel(1)).toBe('1:1');
    expect(scaleLabel(0.5)).toBe('1:2');
    expect(scaleLabel(2)).toBe('2:1');
    expect(scaleLabel(0.25)).toBe('1:4');
  });
  it('newSheet makes an A3 landscape sheet with one 1:1 view inside the drawing space', () => {
    const s = newSheet('s', 'v', 'Sheet 1', { x: 60, y: 40 });
    expect(s.size).toBe('A3');
    expect(s.views[0].scale).toBe(1);
    const ds = drawingSpace(s);
    const v = s.views[0];
    expect(v.position.x - v.width / 2).toBeGreaterThanOrEqual(ds.x);
    expect(v.position.x + v.width / 2).toBeLessThanOrEqual(ds.x + ds.width);
    expect(v.position.y + v.height / 2).toBeLessThanOrEqual(ds.y + ds.height);
  });
});

describe('views and pages', () => {
  const view = { id: 'v', name: 'Front', scale: 0.5, center: { x: 100, y: 50 }, position: { x: 200, y: 150 }, width: 100, height: 80, label: true };
  it('the view matrix maps the model centre to the viewport centre at the scale', () => {
    const m = viewMatrix(view);
    expect(applyToPoint(m, { x: 100, y: 50 })).toEqual({ x: 200, y: 150 });
    const p = applyToPoint(m, { x: 120, y: 50 });
    expect(p.x).toBeCloseTo(210, 12);
    expect(p.y).toBeCloseTo(150, 12);
  });
  it('clipping keeps what is inside the viewport and cuts lines at its edge', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    const out = clipPrims([{ kind: 'polyline', points: [{ x: -50, y: 50 }, { x: 50, y: 50 }], closed: false, width: 0.5 }, { kind: 'circle', center: { x: 500, y: 500 }, radius: 10, width: 0.5 }, { kind: 'text', position: { x: 10, y: 10 }, text: 'in', height: 3.5, rotation: 0, align: 'left' }, { kind: 'text', position: { x: 110, y: 10 }, text: 'out', height: 3.5, rotation: 0, align: 'left' }], r);
    expect(out.length).toBe(2);
    const line = out.find((p) => p.kind === 'polyline');
    expect(line && line.kind === 'polyline' && line.points[0].x).toBeCloseTo(0, 12);
    expect(out.some((p) => p.kind === 'text' && p.text === 'in')).toBe(true);
  });
  it('view primitives keep layer widths as paper widths and scale the geometry', () => {
    const doc: Document = newDocument('t');
    const e: Entity = { id: 'l', type: 'line', layer: '0', a: { x: 100, y: 50 }, b: { x: 140, y: 50 } };
    doc.entities = { l: e };
    doc.entityOrder = ['l'];
    const prims = viewPrims(doc, view);
    const line = prims.find((p) => p.kind === 'polyline');
    expect(line && line.kind === 'polyline' && line.width).toBe(0.5);
    expect(line && line.kind === 'polyline' && line.points[1].x - line.points[0].x).toBeCloseTo(20, 12);
  });
  it('a page is the paper size with furniture and the views', () => {
    const doc: Document = newDocument('t');
    doc.entities = { c: { id: 'c', type: 'circle', layer: '0', center: { x: 100, y: 50 }, radius: 10 } };
    doc.entityOrder = ['c'];
    const page = sheetPage(doc, { ...a3, views: [view] });
    expect(page.width).toBe(420);
    expect(page.height).toBe(297);
    expect(page.title).toBe('Sheet 1');
    expect(page.prims.some((p) => p.kind === 'text' && p.text.includes('SCALE 1:2'))).toBe(true);
    // The circle (radius 5 mm on paper) is drawn as a polyline after clipping.
    expect(page.prims.some((p) => p.kind === 'polyline' && p.points.length > 20)).toBe(true);
  });
});
