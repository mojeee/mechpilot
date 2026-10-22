// The sketch model (shared/sketch/model.ts): Document → planegcs primitives and back, without the
// WebAssembly engine. The engine itself is tested in sketch-solver.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import type { Constraint, DimensionEntity, Document, Entity } from '@shared/doc/types';
import { setLanguage, t } from '@shared/i18n';
import { analyse, applySolution, buildSystem, explain, freeDof, type SketchDiagnosis, type SketchPrimitive, type SolverEntity } from '@shared/sketch/model';

const L = (id: string, ax: number, ay: number, bx: number, by: number): Entity => ({ id, type: 'line', layer: '0', a: { x: ax, y: ay }, b: { x: bx, y: by } });

function docOf(entities: Entity[], constraints: Constraint[] = []): Document {
  const d = newDocument();
  return {
    ...d,
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    entityOrder: entities.map((e) => e.id),
    constraints: Object.fromEntries(constraints.map((c) => [c.id, c])),
    constraintOrder: constraints.map((c) => c.id),
  };
}

/** A rough rectangle: four lines, corners coincident, two horizontal, two vertical, 100 × 60. */
function rectangle(): Document {
  return docOf(
    [L('l1', 0, 0, 90, 1), L('l2', 90, 1, 91, 50), L('l3', 91, 50, 1, 52), L('l4', 1, 52, 0, 0)],
    [
      { id: 'k1', kind: 'coincident', p1: { entity: 'l1', point: 'b' }, p2: { entity: 'l2', point: 'a' } },
      { id: 'k2', kind: 'coincident', p1: { entity: 'l2', point: 'b' }, p2: { entity: 'l3', point: 'a' } },
      { id: 'k3', kind: 'coincident', p1: { entity: 'l3', point: 'b' }, p2: { entity: 'l4', point: 'a' } },
      { id: 'k4', kind: 'coincident', p1: { entity: 'l4', point: 'b' }, p2: { entity: 'l1', point: 'a' } },
      { id: 'h1', kind: 'horizontal', entity: 'l1' },
      { id: 'h2', kind: 'horizontal', entity: 'l3' },
      { id: 'v1', kind: 'vertical', entity: 'l2' },
      { id: 'v2', kind: 'vertical', entity: 'l4' },
      { id: 'd1', kind: 'distance', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'l1', point: 'b' }, value: 100 },
      { id: 'd2', kind: 'distance', p1: { entity: 'l2', point: 'a' }, p2: { entity: 'l2', point: 'b' }, value: 60 },
    ],
  );
}

const dim = (id: string, kind: DimensionEntity['kind'], a: { x: number; y: number }, b: { x: number; y: number }, driving: number, extra: Partial<DimensionEntity> = {}): DimensionEntity => ({
  id,
  type: 'dimension',
  layer: 'dimensions',
  kind,
  a,
  b,
  position: { x: 0, y: -10 },
  rotation: 0,
  driving,
  ...extra,
});

const diag = (over: Partial<SketchDiagnosis>): SketchDiagnosis => ({
  status: 'solved',
  dof: 0,
  conflicting: [],
  redundant: [],
  partiallyRedundant: [],
  skippedDimensions: [],
  skippedConstraints: [],
  fixedOnly: [],
  message: '',
  ...over,
});

afterEach(() => setLanguage('en'));

describe('buildSystem', () => {
  it('turns a rectangle into points, lines and constraints with MechPilot ids', () => {
    const sys = buildSystem(rectangle());
    // 4 lines × (2 points + 1 line) + 10 constraints.
    expect(sys.primitives).toHaveLength(22);
    expect(sys.primitives.slice(0, 3)).toEqual([
      { id: 'l1.a', type: 'point', x: 0, y: 0, fixed: false },
      { id: 'l1.b', type: 'point', x: 90, y: 1, fixed: false },
      { id: 'l1', type: 'line', p1_id: 'l1.a', p2_id: 'l1.b' },
    ]);
    const ids = sys.primitives.map((p) => p.id);
    expect(ids.slice(12)).toEqual(['k1', 'k2', 'k3', 'k4', 'h1', 'h2', 'v1', 'v2', 'd1', 'd2']);
    expect(sys.primitives.find((p) => p.id === 'k1')).toEqual({ id: 'k1', type: 'p2p_coincident', p1_id: 'l1.b', p2_id: 'l2.a' });
    expect(sys.primitives.find((p) => p.id === 'd1')).toEqual({ id: 'd1', type: 'p2p_distance', p1_id: 'l1.a', p2_id: 'l1.b', distance: 100 });
    expect(sys.primitives.find((p) => p.id === 'v1')).toEqual({ id: 'v1', type: 'vertical_l', l_id: 'l2' });
    expect(sys.pointOf({ entity: 'l3', point: 'b' })).toBe('l3.b');
    expect(sys.pointOf({ entity: 'l3', point: 'center' })).toBeUndefined();
    expect(sys.entityPrimitive('l2')).toBe('l2');
    expect(sys.constraintPrimitives('h2')).toEqual(['h2']);
    expect(sys.ownerOf('d2')).toBe('d2');
    expect(sys.unknowns).toBe(16);
    expect(analyse(rectangle()).clusters).toEqual([['l1', 'l2', 'l3', 'l4']]);
  });

  it('maps every constraint kind to the matching planegcs constraint', () => {
    const doc = docOf(
      [
        L('a', 0, 0, 10, 0),
        L('b', 0, 5, 10, 6),
        { id: 'c', type: 'circle', layer: '0', center: { x: 20, y: 20 }, radius: 5 },
        { id: 'r', type: 'arc', layer: '0', center: { x: 40, y: 0 }, radius: 3, start: 0, end: Math.PI / 2 },
        { id: 'q', type: 'circle', layer: '0', center: { x: 60, y: 0 }, radius: 5 },
      ],
      [
        { id: 'c1', kind: 'pointOnLine', p: { entity: 'c', point: 'center' }, line: 'a' },
        { id: 'c2', kind: 'parallel', a: 'a', b: 'b' },
        { id: 'c3', kind: 'perpendicular', a: 'a', b: 'b' },
        { id: 'c4', kind: 'tangent', a: 'c', b: 'a' },
        { id: 'c5', kind: 'tangent', a: 'r', b: 'b' },
        { id: 'c6', kind: 'tangent', a: 'c', b: 'q' },
        { id: 'c7', kind: 'tangent', a: 'r', b: 'c' },
        { id: 'c8', kind: 'equal', a: 'a', b: 'b' },
        { id: 'c9', kind: 'equal', a: 'r', b: 'c' },
        { id: 'c10', kind: 'symmetric', p1: { entity: 'b', point: 'a' }, p2: { entity: 'b', point: 'b' }, line: 'a' },
        { id: 'c11', kind: 'pointLineDistance', p: { entity: 'r', point: 'start' }, line: 'b', value: 7 },
        { id: 'c12', kind: 'angle', a: 'a', b: 'b', value: Math.PI / 6 },
        { id: 'c13', kind: 'radius', entity: 'r', value: 4 },
        { id: 'c14', kind: 'radius', entity: 'q', value: 6 },
        { id: 'c15', kind: 'equal', a: 'c', b: 'q' },
      ],
    );
    const sys = buildSystem(doc);
    const byId = new Map(sys.primitives.map((p) => [p.id, p]));
    expect(byId.get('c1')).toEqual({ id: 'c1', type: 'point_on_line_pl', p_id: 'c.center', l_id: 'a' });
    expect(byId.get('c2')).toEqual({ id: 'c2', type: 'parallel', l1_id: 'a', l2_id: 'b' });
    // Parallel and perpendicular on the same pair never hold together: the later one is left out.
    expect(byId.get('c3')).toBeUndefined();
    expect(sys.structuralConflicts).toEqual([['c2', 'c3']]);
    expect(byId.get('c4')).toEqual({ id: 'c4', type: 'tangent_lc', l_id: 'a', c_id: 'c' });
    expect(byId.get('c5')).toEqual({ id: 'c5', type: 'tangent_la', l_id: 'b', a_id: 'r' });
    expect(byId.get('c6')).toEqual({ id: 'c6', type: 'tangent_cc', c1_id: 'c', c2_id: 'q' });
    expect(byId.get('c7')).toEqual({ id: 'c7', type: 'tangent_ca', c_id: 'c', a_id: 'r' });
    expect(byId.get('c8')).toEqual({ id: 'c8', type: 'equal_length', l1_id: 'a', l2_id: 'b' });
    expect(byId.get('c9')).toEqual({ id: 'c9', type: 'equal_radius_ca', c1_id: 'c', a2_id: 'r' });
    expect(byId.get('c10')).toEqual({ id: 'c10', type: 'p2p_symmetric_ppl', p1_id: 'b.a', p2_id: 'b.b', l_id: 'a' });
    expect(byId.get('c11')).toEqual({ id: 'c11', type: 'p2l_distance', p_id: 'r.start', l_id: 'b', distance: 7 });
    expect(byId.get('c12')).toEqual({ id: 'c12', type: 'l2l_angle_ll', l1_id: 'a', l2_id: 'b', angle: Math.PI / 6 });
    expect(byId.get('c13')).toEqual({ id: 'c13', type: 'arc_radius', a_id: 'r', radius: 4 });
    expect(byId.get('c14')).toEqual({ id: 'c14', type: 'circle_radius', c_id: 'q', radius: 6 });
    expect(byId.get('c15')).toEqual({ id: 'c15', type: 'equal_radius_cc', c1_id: 'c', c2_id: 'q' });
    // The arc: centre, start and end points, the arc and its rules.
    expect(byId.get('r')).toEqual({ id: 'r', type: 'arc', c_id: 'r.center', start_id: 'r.start', end_id: 'r.end', radius: 3, start_angle: 0, end_angle: Math.PI / 2 });
    expect(byId.get('r.rules')).toEqual({ id: 'r.rules', type: 'arc_rules', a_id: 'r' });
    expect(byId.get('r.start')).toMatchObject({ type: 'point', x: 43, y: 0 });
    expect(sys.ownerOf('r.rules')).toBeUndefined();
  });

  it('makes a tangent at a shared end point an angle through that point (fillet corners)', () => {
    // Line ending where a quarter arc starts, joined by a coincident: tangent at the end point.
    const arc: Entity = { id: 'r', type: 'arc', layer: '0', center: { x: 110, y: 10 }, radius: 10, start: (3 * Math.PI) / 2, end: 0 };
    const up = L('u', 120, 10, 120, 70);
    const doc = docOf([L('a', 10, 0, 110, 0), arc, up, L('back', 120, 70, 120, 10)], [
      { id: 'k', kind: 'coincident', p1: { entity: 'a', point: 'b' }, p2: { entity: 'r', point: 'start' } },
      { id: 't1', kind: 'tangent', a: 'a', b: 'r' },
      { id: 't2', kind: 'tangent', a: 'r', b: 'u' },
      { id: 't3', kind: 'tangent', a: 'back', b: 'r' },
    ]);
    const sys = buildSystem(doc);
    const byId = new Map(sys.primitives.map((p) => [p.id, p]));
    // Normals there: line a → (0, 100) (direction turned left), arc → centre − point = (0, 10): angle 0.
    expect(byId.get('t1')).toEqual({ id: 't1', type: 'angle_via_point', crv1_id: 'a', crv2_id: 'r', p_id: 'a.b', angle: 0 });
    // r's end touches u's start with no coincident: the join is added; normals (−10, 0) and (−60, 0).
    expect(byId.get('t2')).toEqual({ id: 't2', type: 'angle_via_point', crv1_id: 'r', crv2_id: 'u', p_id: 'r.end', angle: 0 });
    expect(byId.get('t2.p')).toEqual({ id: 't2.p', type: 'p2p_coincident', p1_id: 'r.end', p2_id: 'u.a' });
    expect(sys.ownerOf('t2.p')).toBe('t2');
    // A line running the other way: normals opposite, angle π.
    expect(byId.get('t3')).toMatchObject({ type: 'angle_via_point', crv1_id: 'back', crv2_id: 'r', p_id: 'back.b', angle: Math.PI });
    // Without a shared point the distance-based tangent stays.
    const apart = docOf([L('a', 0, 5, 10, 6), arc], [{ id: 't', kind: 'tangent', a: 'a', b: 'r' }]);
    expect(buildSystem(apart).primitives.find((p) => p.id === 't')).toEqual({ id: 't', type: 'tangent_la', l_id: 'a', a_id: 'r' });
  });

  it('fixes an entity with exactly as many equations as it has degrees of freedom', () => {
    const doc = docOf(
      [L('a', 0, 0, 10, 0), { id: 'c', type: 'circle', layer: '0', center: { x: 1, y: 2 }, radius: 5 }, { id: 'r', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 3, start: 0.5, end: 2 }],
      [
        { id: 'f1', kind: 'fixed', entity: 'a' },
        { id: 'f2', kind: 'fixed', entity: 'c' },
        { id: 'f3', kind: 'fixed', entity: 'r' },
      ],
    );
    const sys = buildSystem(doc);
    expect(sys.constraintPrimitives('f1')).toHaveLength(4);
    expect(sys.constraintPrimitives('f2')).toHaveLength(3);
    expect(sys.constraintPrimitives('f3')).toHaveLength(5);
    expect(sys.primitives.find((p) => p.id === 'f1.ax')).toEqual({ id: 'f1.ax', type: 'coordinate_x', p_id: 'a.a', x: 0 });
    expect(sys.primitives.find((p) => p.id === 'f2.r')).toEqual({ id: 'f2.r', type: 'circle_radius', c_id: 'c', radius: 5 });
    expect(sys.primitives.find((p) => p.id === 'f3.s')).toEqual({ id: 'f3.s', type: 'equal', param1: { o_id: 'r', prop: 'start_angle' }, param2: 0.5 });
    expect(sys.ownerOf('f3.e')).toBe('f3');
    expect([...sys.fixedEntities].sort()).toEqual(['a', 'c', 'r']);
  });

  it('maps driving dimensions onto the geometry they measure, matching points by coordinates', () => {
    const doc = docOf([
      L('h', 0, 0, 30, 0),
      L('s', 0, 0, 10, 10),
      L('back', 10, 10, 0, 0),
      { id: 'c', type: 'circle', layer: '0', center: { x: 50, y: 50 }, radius: 5 },
      dim('dl', 'linear', { x: 30, y: 0 }, { x: 0, y: 0 }, 40),
      dim('dv', 'linear', { x: 0, y: 0 }, { x: 10, y: 10 }, 12, { rotation: Math.PI / 2 }),
      dim('da', 'aligned', { x: 0, y: 0 }, { x: 10, y: 10 }, 15),
      dim('dr', 'radius', { x: 50, y: 50 }, { x: 55, y: 50 }, 7),
      dim('dd', 'diameter', { x: 50, y: 50 }, { x: 50, y: 55 }, 16),
      dim('dg', 'angular', { x: 30, y: 0 }, { x: 10, y: 10 }, 45, { center: { x: 0, y: 0 } }),
      dim('do', 'ordinate', { x: 0, y: 0 }, { x: 30, y: 0 }, 35, { rotation: Math.PI }),
      dim('dx', 'aligned', { x: 0, y: 0 }, { x: 3, y: 3 }, 5),
      dim('dz', 'linear', { x: 0, y: 0 }, { x: 30, y: 0 }, 5, { rotation: 0.3 }),
      { ...dim('dn', 'aligned', { x: 0, y: 0 }, { x: 30, y: 0 }, 1), driving: undefined },
    ]);
    const sys = buildSystem(doc);
    const byId = new Map(sys.primitives.map((p) => [p.id, p]));
    // b − a along x keeps the current sign: b is left of a, so the difference is −40.
    expect(byId.get('dl')).toEqual({ id: 'dl', type: 'difference', param1: { o_id: 'h.b', prop: 'x' }, param2: { o_id: 'h.a', prop: 'x' }, difference: -40 });
    expect(byId.get('dv')).toEqual({ id: 'dv', type: 'difference', param1: { o_id: 'h.a', prop: 'y' }, param2: { o_id: 's.b', prop: 'y' }, difference: 12 });
    expect(byId.get('da')).toEqual({ id: 'da', type: 'p2p_distance', p1_id: 'h.a', p2_id: 's.b', distance: 15 });
    expect(byId.get('dr')).toEqual({ id: 'dr', type: 'circle_radius', c_id: 'c', radius: 7 });
    expect(byId.get('dd')).toEqual({ id: 'dd', type: 'circle_radius', c_id: 'c', radius: 8 });
    // Both legs run with their lines (h and s start at the vertex): the angle as it is, in radians.
    expect(byId.get('dg')).toEqual({ id: 'dg', type: 'l2l_angle_ll', l1_id: 'h', l2_id: 's', angle: Math.PI / 4 });
    // Ordinate along −x: b.x − a.x = −35.
    expect(byId.get('do')).toEqual({ id: 'do', type: 'difference', param1: { o_id: 'h.a', prop: 'x' }, param2: { o_id: 'h.b', prop: 'x' }, difference: -35 });
    // (3, 3) is on no entity point; a rotated linear dimension has no planegcs equivalent yet.
    expect(sys.skippedDimensions).toEqual(['dx', 'dz']);
    expect(byId.has('dn')).toBe(false);
    expect(buildSystem(doc, { drivingDimensions: false }).primitives.some((p) => p.id.startsWith('d'))).toBe(false);
  });

  it('adds π to a driving angle when one leg runs against its line', () => {
    const doc = docOf([L('h', 0, 0, 30, 0), L('back', 10, 10, 0, 0), dim('dg', 'angular', { x: 30, y: 0 }, { x: 10, y: 10 }, 45, { center: { x: 0, y: 0 } })]);
    const p = buildSystem(doc).primitives.find((q) => q.id === 'dg');
    expect(p).toEqual({ id: 'dg', type: 'l2l_angle_ll', l1_id: 'h', l2_id: 'back', angle: Math.PI / 4 + Math.PI });
  });

  it('keeps polylines with arcs as fixed points and leaves out what the solver does not handle', () => {
    const doc = docOf(
      [
        { id: 'p', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false, bulges: [0, 0.5] },
        { id: 'q', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true },
        { id: 'e', type: 'ellipse', layer: '0', center: { x: 0, y: 0 }, major: { x: 5, y: 0 }, ratio: 0.5, start: 0, end: Math.PI * 2 },
        { id: 't', type: 'text', layer: '0', position: { x: 0, y: 0 }, text: 'A', height: 3.5, rotation: 0 },
      ],
      [
        { id: 'k', kind: 'coincident', p1: { entity: 'q', point: 2 }, p2: { entity: 'p', point: 2 } },
        { id: 'x', kind: 'horizontal', entity: 'e' },
        { id: 'y', kind: 'coincident', p1: { entity: 'q', point: 7 }, p2: { entity: 'p', point: 0 } },
      ],
    );
    const sys = buildSystem(doc);
    const ids = sys.primitives.map((p) => p.id);
    expect(ids).toEqual(['p.0', 'p.1', 'p.2', 'q.0', 'q.1', 'q.2', 'q.s0', 'q.s1', 'q.s2', 'k']);
    expect(sys.primitives[0]).toEqual({ id: 'p.0', type: 'point', x: 0, y: 0, fixed: true });
    expect(sys.primitives[3]).toEqual({ id: 'q.0', type: 'point', x: 0, y: 0, fixed: false });
    expect(sys.primitives[8]).toEqual({ id: 'q.s2', type: 'line', p1_id: 'q.2', p2_id: 'q.0' });
    expect(sys.fixedOnly).toEqual(['p']);
    expect(sys.skippedConstraints).toEqual(['x', 'y']);
    expect(sys.entities).toEqual(['p', 'q']);
  });

  it('adds a temporary constraint towards a fixed point for dragging', () => {
    const sys = buildSystem(rectangle(), { temporary: { ref: { entity: 'l2', point: 'b' }, to: { x: 120, y: 70 } } });
    expect(sys.primitives.slice(-2)).toEqual([
      { id: '__drag.point', type: 'point', x: 120, y: 70, fixed: true },
      { id: '__drag', type: 'p2p_coincident', p1_id: 'l2.b', p2_id: '__drag.point', temporary: true },
    ]);
  });

  it('builds one cluster at a time: entities linked by constraints, free entities apart', () => {
    const doc = docOf([L('a', 0, 0, 10, 0), L('b', 10, 0, 10, 10), L('free', 50, 50, 60, 60), L('c', 0, 20, 10, 20)], [
      { id: 'k', kind: 'coincident', p1: { entity: 'a', point: 'b' }, p2: { entity: 'b', point: 'a' } },
      { id: 'h', kind: 'horizontal', entity: 'c' },
    ]);
    const a = analyse(doc);
    expect(a.clusters).toEqual([['a', 'b'], ['c']]);
    expect(a.unconstrained).toEqual(['free']);
    const sys = buildSystem(doc, { analysis: a, entities: new Set(['c']) });
    expect(sys.primitives.map((p) => p.id)).toEqual(['c.a', 'c.b', 'c', 'h']);
    expect(freeDof(doc.entities.free as SolverEntity)).toBe(4);
  });
});

describe('applySolution', () => {
  it('returns only the entities whose geometry changed, as new objects', () => {
    const doc = rectangle();
    const sys = buildSystem(doc);
    expect(applySolution(doc, sys, sys.primitives)).toEqual([]);
    const moved: SketchPrimitive[] = sys.primitives.map((p) => (p.id === 'l2.b' && p.type === 'point' ? { ...p, x: 90, y: 60 } : p));
    const out = applySolution(doc, sys, moved);
    expect(out).toEqual([{ id: 'l2', type: 'line', layer: '0', a: { x: 90, y: 1 }, b: { x: 90, y: 60 } }]);
    expect(out[0]).not.toBe(doc.entities.l2);
    expect(doc.entities.l2).toEqual(L('l2', 90, 1, 91, 50));
  });

  it('copies solved values exactly, without rounding (product rule 1)', () => {
    const doc = docOf([{ id: 'r', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 3, start: 0, end: 1 }], [{ id: 'k', kind: 'radius', entity: 'r', value: 4 }]);
    const sys = buildSystem(doc);
    const solved = sys.primitives.map((p) => (p.type === 'arc' ? { ...p, radius: 4.000000000000001, start_angle: 0.1 + 0.2, end_angle: 1 } : p));
    expect(applySolution(doc, sys, solved)).toEqual([{ id: 'r', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 4.000000000000001, start: 0.30000000000000004, end: 1 }]);
  });

  it('treats changes at floating-point noise level as no change', () => {
    const doc = rectangle();
    const sys = buildSystem(doc);
    const noisy = sys.primitives.map((p) => (p.id === 'l2.b' && p.type === 'point' ? { ...p, y: 50.000000000000014 } : p));
    expect(applySolution(doc, sys, noisy)).toEqual([]);
    const real = sys.primitives.map((p) => (p.id === 'l2.b' && p.type === 'point' ? { ...p, x: 91.000000001, y: 50.000000000000014 } : p));
    expect(applySolution(doc, sys, real)).toEqual([{ ...doc.entities.l2, b: { x: 91.000000001, y: 50 } }]);
  });

  it('never moves a fixed entity', () => {
    const doc = docOf([L('a', 0, 0, 10, 0)], [{ id: 'f', kind: 'fixed', entity: 'a' }]);
    const sys = buildSystem(doc);
    const moved = sys.primitives.map((p) => (p.type === 'point' ? { ...p, x: p.x + 1 } : p));
    expect(applySolution(doc, sys, moved)).toEqual([]);
  });
});

describe('explain', () => {
  const doc = docOf(
    [L('l12', 0, 0, 10, 0), L('l7', 0, 0, 10, 10), L('x3kf9a2b', 0, 0, 1, 1), dim('d4', 'aligned', { x: 0, y: 0 }, { x: 10, y: 0 }, 10)],
    [
      { id: 'h', kind: 'horizontal', entity: 'l12' },
      { id: 'g', kind: 'angle', a: 'l12', b: 'l7', value: Math.PI / 6 },
      { id: 'k', kind: 'coincident', p1: { entity: 'l12', point: 'a' }, p2: { entity: 'l7', point: 'a' } },
    ],
  );

  it('names the two constraints of a conflict and offers a way out', () => {
    expect(explain(doc, diag({ status: 'conflicting', conflicting: ['h', 'g'] }), t)).toBe(
      'Over-constrained: the horizontal constraint on line l12 conflicts with the angle 30° between line l12 and line l7. Remove one of them.',
    );
    expect(explain(doc, diag({ status: 'conflicting', conflicting: ['h', 'g', 'k'] }))).toBe(
      'Over-constrained: these constraints cannot all hold: the horizontal constraint on line l12, the angle 30° between line l12 and line l7 and the coincident constraint between the start of line l12 and the start of line l7. Remove one of them.',
    );
  });

  it('counts degrees of freedom and gives an example of what can move', () => {
    expect(explain(doc, diag({ dof: 0 }))).toBe('Solved; fully constrained.');
    expect(explain(doc, diag({ dof: 3, freeExample: 'x3kf9a2b' }))).toBe('Solved. The sketch has 3 degrees of freedom left (for example line x3kf can still move).');
    expect(explain(doc, diag({ dof: 1 }))).toBe('Solved. The sketch has 1 degree of freedom left.');
    expect(explain(doc, diag({ status: 'empty', dof: 12 }))).toBe('No constraints yet: the sketch has 12 degrees of freedom.');
  });

  it('explains redundant, failed, too large and skipped items', () => {
    expect(explain(doc, diag({ status: 'redundant', redundant: ['h'] }))).toBe('Solved, but the horizontal constraint on line l12 is redundant: the other constraints already fix the same thing. You can delete it.');
    expect(explain(doc, diag({ status: 'failed' }))).toMatch(/^The solver could not satisfy the constraints/);
    expect(explain(doc, diag({ status: 'failed', reason: 'too-large', detail: '300 entities in one connected group, 1200 unknowns' }))).toBe(
      'The sketch is too large for the solver: 300 entities in one connected group, 1200 unknowns. Split it into smaller groups of connected geometry.',
    );
    expect(explain(doc, diag({ skippedDimensions: ['d4'], fixedOnly: ['l7'] }))).toBe(
      'Solved; fully constrained. Driving dimensions not applied, because their points are not on sketch geometry (or the direction is not horizontal or vertical): dimension d4. Polylines with arcs take part only as fixed points: line l7. Explode them into lines and arcs to constrain them.',
    );
    expect(explain(doc, diag({ status: 'conflicting', conflicting: ['d4', 'h'] }))).toBe(
      'Over-constrained: the driving dimension 10 mm (dimension d4) conflicts with the horizontal constraint on line l12. Remove one of them.',
    );
  });

  it('speaks Italian', () => {
    setLanguage('it');
    expect(explain(doc, diag({ status: 'conflicting', conflicting: ['h', 'g'] }), t)).toBe(
      'Sovravincolato: il vincolo orizzontale su linea l12 è in conflitto con l’angolo 30° tra linea l12 e linea l7. Eliminane uno.',
    );
    expect(explain(doc, diag({ dof: 0 }), t)).toBe('Risolto; completamente vincolato.');
  });
});
