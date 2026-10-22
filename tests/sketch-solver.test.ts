// The solver wrapper (shared/sketch/solver.ts) with the real planegcs WebAssembly engine.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import type { Constraint, DimensionEntity, Document, Entity, LineEntity } from '@shared/doc/types';
import { createSolver, type SketchSolver } from '@shared/sketch/solver';

const L = (id: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({ id, type: 'line', layer: '0', a: { x: ax, y: ay }, b: { x: bx, y: by } });

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

const RECT: Constraint[] = [
  { id: 'k1', kind: 'coincident', p1: { entity: 'l1', point: 'b' }, p2: { entity: 'l2', point: 'a' } },
  { id: 'k2', kind: 'coincident', p1: { entity: 'l2', point: 'b' }, p2: { entity: 'l3', point: 'a' } },
  { id: 'k3', kind: 'coincident', p1: { entity: 'l3', point: 'b' }, p2: { entity: 'l4', point: 'a' } },
  { id: 'k4', kind: 'coincident', p1: { entity: 'l4', point: 'b' }, p2: { entity: 'l1', point: 'a' } },
  { id: 'h1', kind: 'horizontal', entity: 'l1' },
  { id: 'h2', kind: 'horizontal', entity: 'l3' },
  { id: 'v1', kind: 'vertical', entity: 'l2' },
  { id: 'v2', kind: 'vertical', entity: 'l4' },
];
const rectangle = (extra: Constraint[] = [], dims: Constraint[] = RECT_DIMS): Document =>
  docOf([L('l1', 0, 0, 90, 1), L('l2', 90, 1, 91, 50), L('l3', 91, 50, 1, 52), L('l4', 1, 52, 0, 0)], [...RECT, ...dims, ...extra]);
const RECT_DIMS: Constraint[] = [
  { id: 'd1', kind: 'distance', p1: { entity: 'l1', point: 'a' }, p2: { entity: 'l1', point: 'b' }, value: 100 },
  { id: 'd2', kind: 'distance', p1: { entity: 'l2', point: 'a' }, p2: { entity: 'l2', point: 'b' }, value: 60 },
];

/** Apply the solver's entities to the document (what the UI does with one updateEntities command). */
function applied(doc: Document, entities: Entity[]): Document {
  return { ...doc, entities: { ...doc.entities, ...Object.fromEntries(entities.map((e) => [e.id, e])) } };
}
const line = (doc: Document, id: string) => doc.entities[id] as LineEntity;
const length = (l: LineEntity) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);

let solver: SketchSolver;
beforeAll(async () => {
  // Node: hand the engine its bytes (the emscripten build is a web build; see createSolver).
  const pkg = dirname(createRequire(import.meta.url).resolve('@salusoft89/planegcs'));
  solver = await createSolver({ wasmBinary: readFileSync(join(pkg, 'planegcs_dist', 'planegcs.wasm')) });
});
afterAll(() => solver.dispose());

describe('solve', () => {
  it('solves a rectangle to 100 × 60 with 2 degrees of freedom left (its position)', () => {
    const doc = rectangle();
    const { entities, diagnosis } = solver.solve(doc);
    expect(diagnosis.status).toBe('solved');
    expect(diagnosis.dof).toBe(2);
    expect(diagnosis.conflicting).toEqual([]);
    expect(entities.map((e) => e.id).sort()).toEqual(['l1', 'l2', 'l3', 'l4']);
    const out = applied(doc, entities);
    expect(length(line(out, 'l1'))).toBeCloseTo(100, 9);
    expect(length(line(out, 'l2'))).toBeCloseTo(60, 9);
    expect(line(out, 'l1').a.y).toBe(line(out, 'l1').b.y);
    expect(line(out, 'l2').a.x).toBe(line(out, 'l2').b.x);
    expect(line(out, 'l1').b).toEqual(line(out, 'l2').a);
    expect(diagnosis.message).toBe('Solved. The sketch has 2 degrees of freedom left.');
    // Solving the solution again changes nothing.
    expect(solver.solve(out).entities).toEqual([]);
  });

  it('drives a line length with a driving dimension; the line can still move until it is fixed', () => {
    const d: DimensionEntity = { id: 'dm', type: 'dimension', layer: 'dimensions', kind: 'linear', a: { x: 0, y: 0 }, b: { x: 40, y: 3 }, position: { x: 20, y: -10 }, rotation: 0, driving: 50 };
    const doc = docOf([L('a', 0, 0, 40, 3), d], [{ id: 'h', kind: 'horizontal', entity: 'a' }]);
    const r = solver.solve(doc);
    expect(r.diagnosis.status).toBe('solved');
    expect(r.diagnosis.dof).toBe(2);
    const out = applied(doc, r.entities);
    expect(length(line(out, 'a'))).toBeCloseTo(50, 9);
    expect(line(out, 'a').b.x - line(out, 'a').a.x).toBeCloseTo(50, 9);
    expect(solver.freedom(out)).toEqual({ a: 'free' });

    // The dimension follows the geometry in the UI; here: move it onto the solved points and fix the line.
    const moved = line(out, 'a');
    const fixed: Document = {
      ...out,
      entities: { ...out.entities, dm: { ...d, a: moved.a, b: moved.b } },
      constraints: { ...out.constraints, f: { id: 'f', kind: 'fixed', entity: 'a' } },
      constraintOrder: [...out.constraintOrder, 'f'],
    };
    const r2 = solver.solve(fixed);
    expect(r2.diagnosis.dof).toBe(0);
    // The fixed line already satisfies the horizontal and the dimension: planegcs calls them redundant.
    expect(r2.diagnosis.status).toBe('redundant');
    expect(r2.diagnosis.redundant.length).toBeGreaterThan(0);
    expect(r2.entities).toEqual([]);
    expect(solver.freedom(fixed)).toEqual({ a: 'constrained' });
  });

  it('reports horizontal + vertical on one line as a conflict, naming both', () => {
    const doc = docOf([L('a', 0, 0, 40, 3)], [
      { id: 'h', kind: 'horizontal', entity: 'a' },
      { id: 'v', kind: 'vertical', entity: 'a' },
    ]);
    const { diagnosis, entities } = solver.solve(doc);
    expect(diagnosis.status).toBe('conflicting');
    expect(diagnosis.conflicting).toEqual(['h', 'v']);
    expect(diagnosis.message).toBe('Over-constrained: the horizontal constraint on line a conflicts with the vertical constraint on line a. Remove one of them.');
    // The vertical one is left out, so the line does not collapse to a point.
    expect(entities).toHaveLength(1);
    expect(length(entities[0] as LineEntity)).toBeGreaterThan(30);
    expect(solver.freedom(doc)).toEqual({ a: 'unknown' });
  });

  it('reports conflicts that planegcs finds, by MechPilot id', () => {
    const doc = docOf([L('a', 0, 0, 40, 3)], [
      { id: 'd100', kind: 'distance', p1: { entity: 'a', point: 'a' }, p2: { entity: 'a', point: 'b' }, value: 100 },
      { id: 'd60', kind: 'distance', p1: { entity: 'a', point: 'a' }, p2: { entity: 'a', point: 'b' }, value: 60 },
    ]);
    const { diagnosis } = solver.solve(doc);
    expect(diagnosis.status).toBe('conflicting');
    expect(diagnosis.conflicting.sort()).toEqual(['d100', 'd60']);
    expect(diagnosis.message).toMatch(/^Over-constrained: the distance (100|60) mm between the start of line a and the end of line a conflicts with the distance (100|60) mm/);
  });

  it('reports a constraint that repeats another as redundant', () => {
    const doc = docOf([L('a', 0, 0, 40, 3)], [
      { id: 'h1', kind: 'horizontal', entity: 'a' },
      { id: 'h2', kind: 'horizontal', entity: 'a' },
    ]);
    const { diagnosis, entities } = solver.solve(doc);
    expect(diagnosis.status).toBe('redundant');
    expect(diagnosis.redundant).toEqual(['h2']);
    expect(diagnosis.dof).toBe(3);
    expect(entities).toHaveLength(1);
    expect(diagnosis.message).toMatch(/the horizontal constraint on line a is redundant/);
  });

  it('makes a line tangent to a circle', () => {
    const doc = docOf([L('a', 0, 5, 10, 6), { id: 'c', type: 'circle', layer: '0', center: { x: 5, y: 20 }, radius: 7 }], [{ id: 't', kind: 'tangent', a: 'a', b: 'c' }]);
    const r = solver.solve(doc);
    expect(r.diagnosis.status).toBe('solved');
    const out = applied(doc, r.entities);
    const l = line(out, 'a');
    const c = out.entities.c as Extract<Entity, { type: 'circle' }>;
    const d = Math.abs((l.b.x - l.a.x) * (c.center.y - l.a.y) - (l.b.y - l.a.y) * (c.center.x - l.a.x)) / length(l);
    expect(Math.abs(d - c.radius)).toBeLessThan(1e-9);
  });

  it('holds a fillet corner: a line and an arc tangent at their shared end point', () => {
    // A fixed horizontal line, a quarter arc starting at its end (pulled off-tangent), a vertical line.
    const arc: Entity = { id: 'r', type: 'arc', layer: '0', center: { x: 112, y: 9 }, radius: 10, start: 4.5, end: 0.2 };
    const doc = docOf([L('a', 10, 0, 110, 0), arc, L('u', 121, 12, 121, 70)], [
      { id: 'f', kind: 'fixed', entity: 'a' },
      { id: 'k1', kind: 'coincident', p1: { entity: 'a', point: 'b' }, p2: { entity: 'r', point: 'start' } },
      { id: 'k2', kind: 'coincident', p1: { entity: 'r', point: 'end' }, p2: { entity: 'u', point: 'a' } },
      { id: 't1', kind: 'tangent', a: 'a', b: 'r' },
      { id: 't2', kind: 'tangent', a: 'r', b: 'u' },
      { id: 'v', kind: 'vertical', entity: 'u' },
      { id: 'rad', kind: 'radius', entity: 'r', value: 10 },
    ]);
    const r = solver.solve(doc);
    expect(r.diagnosis.status, r.diagnosis.message).toBe('solved');
    expect(r.diagnosis.redundant).toEqual([]);
    const out = applied(doc, r.entities);
    const c = out.entities.r as Extract<Entity, { type: 'arc' }>;
    expect(c.center.x).toBeCloseTo(110, 9);
    expect(c.center.y).toBeCloseTo(10, 9);
    expect(line(out, 'u').a.x).toBeCloseTo(120, 9);
    expect(line(out, 'u').a.y).toBeCloseTo(10, 9);
    // Only the top end of u can still move (its length): 1 degree of freedom.
    expect(r.diagnosis.dof).toBe(1);
    expect(solver.freedom(out)).toEqual({ a: 'constrained', r: 'constrained', u: 'free' });
  });

  it('drags a corner of a free rectangle to the target, keeping the sides horizontal and vertical', () => {
    const doc = applied(rectangle(), solver.solve(rectangle()).entities);
    const to = { x: -20, y: -30 };
    const r = solver.solve(doc, { temporary: { ref: { entity: 'l1', point: 'a' }, to } });
    expect(r.diagnosis.status).toBe('solved');
    expect(r.diagnosis.dof).toBe(2);
    const out = applied(doc, r.entities);
    expect(line(out, 'l1').a.x).toBeCloseTo(-20, 9);
    expect(line(out, 'l1').a.y).toBeCloseTo(-30, 9);
    expect(line(out, 'l1').b.y).toBeCloseTo(-30, 9);
    expect(line(out, 'l2').a.x).toBe(line(out, 'l2').b.x);
    expect(line(out, 'l3').a.y).toBe(line(out, 'l3').b.y);
    expect(length(line(out, 'l1'))).toBeCloseTo(100, 9);
    expect(length(line(out, 'l4'))).toBeCloseTo(60, 9);
  });

  it('says "empty" for a sketch without constraints, with the degrees of freedom planegcs counts', () => {
    const arc: Entity = { id: 'r', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 3, start: 0, end: 1 };
    const circle: Entity = { id: 'c', type: 'circle', layer: '0', center: { x: 9, y: 9 }, radius: 2 };
    const doc = docOf([L('a', 0, 0, 10, 0), arc, circle]);
    const r = solver.solve(doc);
    expect(r.diagnosis.status).toBe('empty');
    expect(r.diagnosis.dof).toBe(4 + 5 + 3);
    expect(r.entities).toEqual([]);
    expect(r.diagnosis.message).toBe('No constraints yet: the sketch has 12 degrees of freedom.');
    // Dragging puts each entity through planegcs: its count agrees with ours.
    for (const ref of [{ entity: 'a', point: 'b' as const }, { entity: 'r', point: 'center' as const }, { entity: 'c', point: 'center' as const }]) {
      const d = solver.solve(doc, { temporary: { ref, to: { x: 1, y: 1 } } }).diagnosis;
      expect(d.dof).toBe(12);
      expect(d.status).toBe('empty');
    }
    expect(solver.freedom(doc)).toEqual({ a: 'free', r: 'free', c: 'free' });
  });

  it('changes an arc radius', () => {
    const doc = docOf([{ id: 'r', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 10, start: 0, end: 1 }], [{ id: 'k', kind: 'radius', entity: 'r', value: 20 }]);
    const r = solver.solve(doc);
    expect(r.diagnosis.status).toBe('solved');
    expect(r.diagnosis.dof).toBe(4);
    const arc = r.entities[0] as Extract<Entity, { type: 'arc' }>;
    expect(arc.radius).toBe(20);
  });

  it('drives an angle between two lines with an angular dimension', () => {
    const d: DimensionEntity = { id: 'dg', type: 'dimension', layer: 'dimensions', kind: 'angular', a: { x: 30, y: 0 }, b: { x: 0, y: 10 }, center: { x: 0, y: 0 }, position: { x: 5, y: 5 }, rotation: 0, driving: 30 };
    const doc = docOf([L('h', 0, 0, 30, 0), L('s', 0, 10, 0, 0), d], [
      { id: 'k', kind: 'coincident', p1: { entity: 'h', point: 'a' }, p2: { entity: 's', point: 'b' } },
      { id: 'hz', kind: 'horizontal', entity: 'h' },
    ]);
    const out = applied(doc, solver.solve(doc).entities);
    const h = line(out, 'h');
    const s = line(out, 's');
    // Counter-clockwise from leg h (towards +x) to leg s (from the vertex to s.a).
    const angle = Math.atan2(s.a.y - s.b.y, s.a.x - s.b.x) - Math.atan2(h.b.y - h.a.y, h.b.x - h.a.x);
    expect(angle).toBeCloseTo(Math.PI / 6, 9);
  });

  it('keeps polylines with arcs fixed: other geometry snaps to their vertices', () => {
    const doc = docOf(
      [{ id: 'p', type: 'polyline', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false, bulges: [0, 0.4] }, L('a', 3, 4, 20, 20)],
      [{ id: 'k', kind: 'coincident', p1: { entity: 'a', point: 'a' }, p2: { entity: 'p', point: 1 } }],
    );
    const r = solver.solve(doc);
    expect(r.diagnosis.status).toBe('solved');
    expect(r.diagnosis.fixedOnly).toEqual(['p']);
    expect(r.entities.map((e) => e.id)).toEqual(['a']);
    expect(line(applied(doc, r.entities), 'a').a).toEqual({ x: 10, y: 0 });
    expect(r.diagnosis.message).toMatch(/Polylines with arcs take part only as fixed points: polyline p\./);
    expect(solver.freedom(doc)).toEqual({ p: 'constrained', a: 'free' });
  });

  it('colours a fixed rectangle as constrained and a free one as free', () => {
    const free = applied(rectangle(), solver.solve(rectangle()).entities);
    expect(solver.freedom(free)).toEqual({ l1: 'free', l2: 'free', l3: 'free', l4: 'free' });
    // Fix the bottom side: everything is determined (without the 60 the sides can still grow).
    const fixedBottom: Document = { ...free, constraints: { ...free.constraints, f: { id: 'f', kind: 'fixed' as const, entity: 'l1' } }, constraintOrder: [...free.constraintOrder, 'f'] };
    expect(solver.solve(fixedBottom).diagnosis.dof).toBe(0);
    expect(solver.freedom(fixedBottom)).toEqual({ l1: 'constrained', l2: 'constrained', l3: 'constrained', l4: 'constrained' });
    const noHeight: Document = { ...fixedBottom, constraints: { ...fixedBottom.constraints } };
    delete noHeight.constraints.d2;
    noHeight.constraintOrder = fixedBottom.constraintOrder.filter((id) => id !== 'd2');
    expect(solver.freedom(noHeight)).toEqual({ l1: 'constrained', l2: 'free', l3: 'free', l4: 'free' });
    expect(solver.freedom(free, 3)).toEqual({ l1: 'unknown', l2: 'unknown', l3: 'unknown', l4: 'unknown' });
  });

  it('colours a circle whose centre is held but whose radius is not as free', () => {
    const doc = docOf([L('a', 0, 0, 10, 0), { id: 'c', type: 'circle', layer: '0', center: { x: 10, y: 0 }, radius: 4 }], [
      { id: 'f', kind: 'fixed', entity: 'a' },
      { id: 'k', kind: 'coincident', p1: { entity: 'a', point: 'b' }, p2: { entity: 'c', point: 'center' } },
    ]);
    expect(solver.solve(doc).diagnosis.dof).toBe(1);
    expect(solver.freedom(doc)).toEqual({ a: 'constrained', c: 'free' });
    const sized: Document = { ...doc, constraints: { ...doc.constraints, r: { id: 'r', kind: 'radius' as const, entity: 'c', value: 4 } }, constraintOrder: [...doc.constraintOrder, 'r'] };
    expect(solver.freedom(sized)).toEqual({ a: 'constrained', c: 'constrained' });
  });

  it('refuses a connected group too large for the engine instead of running out of memory', () => {
    const { doc } = chain(300);
    const r = solver.solve(doc);
    expect(r.diagnosis.status).toBe('failed');
    expect(r.diagnosis.reason).toBe('too-large');
    expect(r.diagnosis.message).toMatch(/^The sketch is too large for the solver: 300 entities in one connected group, 1200 unknowns\./);
    expect(solver.healthy).toBe(true);
  });

  it('solves a chain of 100 lines in under 1 s (product rule 8; ~70 ms alone, more when the whole suite runs in parallel)', () => {
    const { doc } = chain(100);
    solver.solve(chain(5).doc); // warm up
    const t0 = performance.now();
    const r = solver.solve(doc);
    const ms = performance.now() - t0;
    console.log(`sketch solver: chain of 100 lines (199 constraints) solved in ${ms.toFixed(1)} ms`);
    expect(r.diagnosis.status).toBe('solved');
    expect(r.diagnosis.dof).toBe(102);
    expect(ms).toBeLessThan(1000);
  });
});

describe('createSolver', () => {
  it('loads the engine in Node without options too (the module reads its own wasm file)', async () => {
    const s = await createSolver();
    expect(s.solve(docOf([L('a', 0, 0, 1, 1)], [{ id: 'h', kind: 'horizontal', entity: 'a' }])).diagnosis.dof).toBe(3);
    s.dispose();
    expect(s.healthy).toBe(false);
  });
});

/** n lines end to end, alternately vertical and horizontal, each joined to the next. */
function chain(n: number): { doc: Document } {
  const lines: Entity[] = [];
  const cs: Constraint[] = [];
  for (let i = 0; i < n; i++) lines.push(L(`l${i}`, i * 10, i % 3, i * 10 + 9.5, i % 2));
  for (let i = 1; i < n; i++) cs.push({ id: `k${i}`, kind: 'coincident', p1: { entity: `l${i - 1}`, point: 'b' }, p2: { entity: `l${i}`, point: 'a' } });
  for (let i = 0; i < n; i++) cs.push({ id: `h${i}`, kind: i % 2 ? 'horizontal' : 'vertical', entity: `l${i}` });
  return { doc: docOf(lines, cs) };
}
