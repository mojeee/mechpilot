// What the model reads of the drawing (shared/ai/summary.ts) and the read-only tools
// (shared/ai/tools.ts): rounded geometry, dimension values, parts, paging, face references, and
// measurements and library values that carry their sources.

import { describe, expect, it } from 'vitest';
import { compactEntity, describeReferences, faceSelectors, summarizeContext } from '@shared/ai/summary';
import { runReadTool } from '@shared/ai/tools';
import { fitDeviations } from '@shared/fits';
import type { Entity } from '@shared/doc/types';
import { blank, context, sample } from './ai-helpers';

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

describe('context summary', () => {
  it('rounds geometry to 3 decimals and reports dimension values', () => {
    const e: Entity = { id: 'l', type: 'line', layer: '0', a: { x: 0.123456, y: -0.0000001 }, b: { x: 10, y: 0 } };
    expect(compactEntity(e)).toEqual({ id: 'l', type: 'line', layer: '0', a: { x: 0.123, y: 0 }, b: { x: 10, y: 0 }, length: 9.877 });
    const d: Entity = { id: 'd', type: 'dimension', layer: 'dimensions', kind: 'diameter', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, position: { x: 10, y: 10 }, rotation: 0, tolerance: { kind: 'fit', cls: 'H7' } };
    expect(compactEntity(d)).toMatchObject({ kind: 'diameter', value: 10, tolerance: { kind: 'fit', cls: 'H7' } });
  });
  it('lists parts with their feature trees, and build results for the active part', () => {
    const doc = sample('sheet-metal-cover');
    const build = { properties: { volume: 1000, area: 600, centerOfMass: [1, 2, 3] as [number, number, number], bbox: { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] } }, status: { ex1: 'ok' as const }, errors: [], ms: 5 };
    const s = summarizeContext(context(doc, { activePart: 'cover', build }));
    const parts = s.parts as Record<string, unknown>[];
    expect(parts).toHaveLength(1);
    const features = parts[0].features as Record<string, unknown>[];
    expect(features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'fillet', 'shell', 'sketch', 'hole']);
    expect(features[1]).toMatchObject({ id: 'ex1', distance: 25, status: 'ok' });
    expect(parts[0].build).toMatchObject({ volumeMm3: 1000, massKg: { density: expect.any(Number) } });
  });
  it('pages long entity lists', () => {
    const doc = sample('mounting-bracket');
    const s = summarizeContext(context(doc), { maxEntities: 5 });
    expect((s.entities as unknown[]).length).toBe(5);
    expect(s.entitiesShown).toMatch(/offset 5/);
    const next = summarizeContext(context(doc), { maxEntities: 5, offset: 5 });
    expect((next.entities as { id: string }[])[0].id).toBe(doc.entityOrder[5]);
  });
  it('drops selected ids that are not in the drawing', () => {
    const s = summarizeContext(context(blank(), { selection: ['ghost'] }));
    expect(s.selection).toEqual([]);
    expect(s.bounds).toBeNull();
  });
});

describe('face references', () => {
  it('maps an axis-aligned face to an inPlane edge selector and a normal face selector', () => {
    expect(faceSelectors([5, 5, 10], [0, 0, 1])).toEqual({ edges: { kind: 'inPlane', plane: 'XY', offset: 10 }, face: { kind: 'normal', direction: 'Z+' }, facePlane: { kind: 'inPlane', plane: 'XY', offset: 10 } });
    // XZ's normal is −Y (shared/cad/profile.ts), so a face at y = 25 is at offset −25.
    expect(faceSelectors([0, 25, 3], [0, 1, 0])?.edges).toEqual({ kind: 'inPlane', plane: 'XZ', offset: -25 });
    expect(faceSelectors([7, 0, 0], [-1, 0, 0])?.face).toEqual({ kind: 'normal', direction: 'X-' });
    expect(faceSelectors([0, 0, 0], [0.7071, 0.7071, 0])).toBeNull();
  });
  it('describes a face reference with its measured values and selectors', () => {
    const doc = sample('sheet-metal-cover');
    const [r] = describeReferences([{ kind: 'face', partId: 'cover', faceId: 3, center: [50, 30, 25], normal: [0, 0, 1], area: 1234.5678, label: 'Top face' }], doc);
    expect(r).toMatchObject({ kind: 'face', areaMm2: 1234.568, edgesOfThisFace: { kind: 'inPlane', plane: 'XY', offset: 25 } });
  });
});

describe('read-only tools', () => {
  const doc = sample('sheet-metal-cover');
  const ctx = context(doc);

  it('read_model and get_entities', () => {
    const r = runReadTool('read_model', {}, ctx);
    expect(r.isError).toBe(false);
    expect(parse(r.content).entityCount).toBe(doc.entityOrder.length);
    const g = parse(runReadTool('get_entities', { ids: ['h1', 'nope'] }, ctx).content);
    expect((g.entities as Entity[])[0]).toEqual(doc.entities.h1);
    expect(g.missing).toEqual(['nope']);
  });

  it('measures distances, entities and closed areas, marked as measured', () => {
    const d = runReadTool('measure', { a: { x: 0, y: 0 }, b: { entity: 'h1', point: 'center' } }, ctx);
    const v = parse(d.content);
    const c = (doc.entities.h1 as { center: { x: number; y: number } }).center;
    expect(v.distance).toBeCloseTo(Math.hypot(c.x, c.y), 3);
    expect(v.source).toMatchObject({ kind: 'measured' });
    expect(d.claim?.source.kind).toBe('measured');
    const area = parse(runReadTool('measure', { entities: ['o1', 'o2', 'o3', 'o4'] }, ctx).content);
    expect(area.closed).toBe(true);
    expect(area.totalAreaMm2).toBeGreaterThan(0);
    expect(runReadTool('measure', { entity: 'nope' }, ctx).isError).toBe(true);
  });

  it('looks up the library with sources', () => {
    const c = runReadTool('library', { topic: 'clearance', query: 'M6' }, ctx);
    expect(parse(c.content)).toMatchObject({ file: 'library/holes/iso-273.json', fine: 6.4, medium: 6.6, coarse: 7 });
    expect(c.claim?.source).toEqual({ kind: 'library', file: 'library/holes/iso-273.json', entry: 'M6 clearance hole' });
    expect(runReadTool('library', { topic: 'clearance', query: 'M7.5' }, ctx).isError).toBe(true);
    expect(parse(runReadTool('library', { topic: 'tapDrill', query: 'M8' }, ctx).content)).toMatchObject({ drill: 6.8, pitch: 1.25 });
    const fit = parse(runReadTool('library', { topic: 'fit', query: 'H7/g6', size: 20 }, ctx).content);
    const h7 = fitDeviations('H7', 20)!;
    const g6 = fitDeviations('g6', 20)!;
    expect((fit.classes as { upperDeviationMm: number }[])[0].upperDeviationMm).toBeCloseTo(h7.upper, 9);
    expect(fit.fit).toMatchObject({ type: 'clearance' });
    expect((fit.fit as { maxClearanceMm: number }).maxClearanceMm).toBeCloseTo(h7.upper - g6.lower, 9);
    expect(runReadTool('library', { topic: 'fit', query: 'H7', size: 99999 }, ctx).isError).toBe(true);
    expect(parse(runReadTool('library', { topic: 'sheet', query: 'A3' }, ctx).content).sizes).toEqual([expect.objectContaining({ id: 'A3', width: 420, height: 297 })]);
    expect((parse(runReadTool('library', { topic: 'material', query: 'S235' }, ctx).content).materials as unknown[]).length).toBeGreaterThan(0);
  });

  it('checks closed profiles and the sketches of a part', () => {
    const open = parse(runReadTool('check', { entities: ['o1', 'o2', 'o3'] }, ctx).content);
    expect((open.profile as { closed: boolean }).closed).toBe(false);
    const part = parse(runReadTool('check', { part: 'cover' }, ctx).content);
    expect((part.sketches as { closed: boolean }[])[0].closed).toBe(true);
    expect(runReadTool('nope', {}, ctx).isError).toBe(true);
  });
});
