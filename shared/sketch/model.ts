// The sketch model for the constraint solver: a Document translated into planegcs primitives
// (plain JSON objects) and the solved primitives translated back into entities. Pure: no
// WebAssembly here, so it is testable on its own. Only shared/sketch/solver.ts and the worker
// (app/workers/solver) load the engine, an LGPL module kept separate and replaceable (CLAUDE.md).
//
// Product rule 1: nothing is rounded. Solved values are copied as they are; "changed" means "not
// exactly equal".

import type { Constraint as GcsConstraint, SketchPrimitive } from '@salusoft89/planegcs';
import { t as defaultT } from '../i18n';
import type { Vec2 } from '../geometry/vec2';
import type { ArcEntity, CircleEntity, Constraint, DimensionEntity, Document, Entity, Id, LineEntity, PointRef, PolylineEntity } from '../doc/types';

export type { SketchPrimitive };

/** A dimension point matches an entity point when both coordinates are within this distance (mm). */
export const MATCH_TOL = 1e-9;
/** Solved changes up to this size (mm, or radians for arc angles) are solver noise: the stored value is kept. */
export const SOLVER_NOISE = 1e-12;

/** Entities the solver moves. Ellipses, splines, text and annotations do not take part. */
export type SolverEntity = LineEntity | CircleEntity | ArcEntity | PolylineEntity;
export const isSolverEntity = (e: Entity | undefined): e is SolverEntity => e !== undefined && (e.type === 'line' || e.type === 'circle' || e.type === 'arc' || e.type === 'polyline');
/** A polyline with any arc segment takes part only as fixed points (its arcs are not modelled yet). */
export const isFixedOnly = (e: SolverEntity): boolean => e.type === 'polyline' && (e.bulges ?? []).some((b) => b !== 0);

/** Id of the fixed point and the temporary constraint used for dragging. */
export const DRAG_POINT = '__drag.point';
export const DRAG_CONSTRAINT = '__drag';

export interface BuildOptions {
  /** Pull this entity point towards `to` with a temporary constraint (dragging). */
  temporary?: { ref: PointRef; to: Vec2 };
  /** Driving dimensions add constraints on the geometry they measure (default true). */
  drivingDimensions?: boolean;
  /** Build only these entities (one cluster); constraints that touch other entities are left out. */
  entities?: ReadonlySet<Id>;
  /** A precomputed analysis of the same document and options (saves work when building clusters). */
  analysis?: SketchAnalysis;
}

/** The planegcs system for a document, with the maps between MechPilot ids and planegcs ids. */
export interface SketchSystem {
  primitives: SketchPrimitive[];
  /** Solver entities in this system, in drawing order. */
  entities: Id[];
  /** The planegcs point id of an entity point (`${entity}.a`, `${entity}.center`, `${entity}.3`), if it is in the system. */
  pointOf(ref: PointRef): string | undefined;
  /** The planegcs geometry id of an entity (the entity id itself for lines, circles and arcs). */
  entityPrimitive(id: Id): string | undefined;
  /** The planegcs constraint ids made for a MechPilot constraint or driving dimension. */
  constraintPrimitives(id: Id): string[];
  /** The MechPilot constraint or dimension a planegcs constraint id belongs to (undefined for internal ones). */
  ownerOf(primitiveId: string): Id | undefined;
  /** Entities with a `fixed` constraint: the solution never moves them. */
  fixedEntities: ReadonlySet<Id>;
  /** Polylines with arc segments, taking part as fixed points only. */
  fixedOnly: Id[];
  /** Driving dimensions that could not be linked to entity points. */
  skippedDimensions: Id[];
  /** Constraints that refer to geometry the solver does not handle (or to points that do not exist). */
  skippedConstraints: Id[];
  /** Pairs of constraints that can never hold together (e.g. horizontal and vertical on one line);
   *  the second of each pair is left out of the system. */
  structuralConflicts: [Id, Id][];
  /** Number of unknowns the engine will see (for the size guard). */
  unknowns: number;
}

export type SketchStatus = 'solved' | 'conflicting' | 'redundant' | 'failed' | 'empty';

export interface SketchDiagnosis {
  status: SketchStatus;
  /** Degrees of freedom left, as planegcs counts them (plus those of unconstrained entities). */
  dof: number;
  conflicting: Id[];
  redundant: Id[];
  partiallyRedundant: Id[];
  skippedDimensions: Id[];
  skippedConstraints: Id[];
  /** Polylines with arc segments that took part as fixed points only. */
  fixedOnly: Id[];
  /** An entity that certainly can still move (one with no constraint), for the message. */
  freeExample?: Id;
  /** Why the solver gave up, when status is 'failed' for a reason other than the geometry. */
  reason?: 'too-large' | 'engine-error';
  /** Detail for `reason`: the size of the group, or the engine's error text. */
  detail?: string;
  /** The plain-words explanation (explain(), in the solver's language). */
  message: string;
}

/* ---------------------------------------------------------------------------------------------- */
/* Analysis: which entities take part, how constraints and dimensions link them                     */
/* ---------------------------------------------------------------------------------------------- */

/** A constraint or driving dimension turned into planegcs constraints (ids filled in later). */
interface Link {
  owner: Id;
  entities: Id[];
  prims: GcsConstraint[];
}

export interface SketchAnalysis {
  entities: SolverEntity[];
  byId: Map<Id, SolverEntity>;
  fixedOnly: Id[];
  fixedEntities: Set<Id>;
  links: Link[];
  skippedDimensions: Id[];
  skippedConstraints: Id[];
  structuralConflicts: [Id, Id][];
  /** Groups of entities connected by constraints (or by the drag), in drawing order. */
  clusters: Id[][];
  /** Solver entities in no group: they move freely and need no solving. */
  unconstrained: Id[];
  /** True when at least one constraint or driving dimension applies. */
  hasConstraints: boolean;
}

/** The named points of an entity, with their coordinates. */
export function entityPoints(e: SolverEntity): [PointRef['point'], Vec2][] {
  switch (e.type) {
    case 'line':
      return [
        ['a', e.a],
        ['b', e.b],
      ];
    case 'circle':
      return [['center', e.center]];
    case 'arc':
      return [
        ['center', e.center],
        ['start', arcPoint(e, e.start)],
        ['end', arcPoint(e, e.end)],
      ];
    case 'polyline':
      return e.points.map((p, i) => [i, p]);
  }
}

const arcPoint = (e: ArcEntity, angle: number): Vec2 => ({ x: e.center.x + e.radius * Math.cos(angle), y: e.center.y + e.radius * Math.sin(angle) });

/** The planegcs id of an entity point, or undefined when the entity has no such point. */
function pointId(e: SolverEntity | undefined, point: PointRef['point']): string | undefined {
  if (!e) return undefined;
  switch (e.type) {
    case 'line':
      return point === 'a' || point === 'b' ? `${e.id}.${point}` : undefined;
    case 'circle':
      return point === 'center' ? `${e.id}.center` : undefined;
    case 'arc':
      return point === 'center' || point === 'start' || point === 'end' ? `${e.id}.${point}` : undefined;
    case 'polyline':
      return typeof point === 'number' && Number.isInteger(point) && point >= 0 && point < e.points.length ? `${e.id}.${point}` : undefined;
  }
}

/** Degrees of freedom of an entity with no constraint: line 4, circle 3, arc 5, polyline 2 per vertex. */
export function freeDof(e: SolverEntity): number {
  if (isFixedOnly(e)) return 0;
  switch (e.type) {
    case 'line':
      return 4;
    case 'circle':
      return 3;
    case 'arc':
      return 5;
    case 'polyline':
      return 2 * e.points.length;
  }
}

/** Analyse a document once: solver entities, links, clusters, what was skipped. */
export function analyse(doc: Document, opts: Pick<BuildOptions, 'temporary' | 'drivingDimensions'> = {}): SketchAnalysis {
  const entities: SolverEntity[] = [];
  const byId = new Map<Id, SolverEntity>();
  for (const id of doc.entityOrder) {
    const e = doc.entities[id];
    if (isSolverEntity(e)) {
      entities.push(e);
      byId.set(id, e);
    }
  }
  const fixedOnly = entities.filter(isFixedOnly).map((e) => e.id);
  const fixedEntities = new Set<Id>();
  const links: Link[] = [];
  const skippedConstraints: Id[] = [];
  const skippedDimensions: Id[] = [];

  // Constraints that can never hold together: the later one is left out and both are reported.
  const structuralConflicts = findStructuralConflicts(doc);
  const leftOut = new Set(structuralConflicts.map(([, b]) => b));

  for (const cid of doc.constraintOrder) {
    const c = doc.constraints[cid];
    if (!c || leftOut.has(cid)) continue;
    const link = constraintLink(c, byId, doc);
    if (!link) {
      skippedConstraints.push(cid);
      continue;
    }
    if (c.kind === 'fixed') fixedEntities.add(c.entity);
    links.push(link);
  }

  if (opts.drivingDimensions !== false) {
    const index = pointIndex(entities);
    for (const id of doc.entityOrder) {
      const d = doc.entities[id];
      if (d?.type !== 'dimension' || d.driving === undefined) continue;
      const link = dimensionLink(d, d.driving, index, byId);
      if (link) links.push(link);
      else skippedDimensions.push(id);
    }
  }

  // Union-find over entities linked by a constraint, a dimension or the drag.
  const parent = new Map<Id, Id>();
  const find = (x: Id): Id => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as Id;
    let y = x;
    while (y !== r) {
      const next = parent.get(y) as Id;
      parent.set(y, r);
      y = next;
    }
    return r;
  };
  const linked = new Set<Id>();
  const join = (ids: Id[]) => {
    for (const id of ids) {
      if (!parent.has(id)) parent.set(id, id);
      linked.add(id);
    }
    for (let i = 1; i < ids.length; i++) parent.set(find(ids[i]), find(ids[0]));
  };
  for (const l of links) join(l.entities);
  const drag = opts.temporary && byId.has(opts.temporary.ref.entity) && !isFixedOnly(byId.get(opts.temporary.ref.entity) as SolverEntity) ? opts.temporary.ref.entity : undefined;
  if (drag) join([drag]);

  const groups = new Map<Id, Id[]>();
  const unconstrained: Id[] = [];
  for (const e of entities) {
    if (!linked.has(e.id)) {
      if (!isFixedOnly(e)) unconstrained.push(e.id);
      continue;
    }
    const r = find(e.id);
    const g = groups.get(r);
    if (g) g.push(e.id);
    else groups.set(r, [e.id]);
  }

  return {
    entities,
    byId,
    fixedOnly,
    fixedEntities,
    links,
    skippedDimensions,
    skippedConstraints,
    structuralConflicts,
    clusters: [...groups.values()],
    unconstrained,
    hasConstraints: links.length > 0 || structuralConflicts.length > 0,
  };
}

/**
 * Pairs that planegcs accepts but that make no sense in a drawing: horizontal and vertical on one
 * line (planegcs solves it by shrinking the line to a point), parallel and perpendicular on the
 * same two lines (same: a zero-length line). Reported as conflicts before solving.
 */
export function findStructuralConflicts(doc: Document): [Id, Id][] {
  const out: [Id, Id][] = [];
  const firstHV = new Map<string, Id>();
  const firstPP = new Map<string, Id>();
  for (const cid of doc.constraintOrder) {
    const c = doc.constraints[cid];
    if (!c) continue;
    if (c.kind === 'horizontal' || c.kind === 'vertical') {
      const other = firstHV.get(`${c.entity}|${c.kind === 'horizontal' ? 'vertical' : 'horizontal'}`);
      if (other) out.push([other, cid]);
      else if (!firstHV.has(`${c.entity}|${c.kind}`)) firstHV.set(`${c.entity}|${c.kind}`, cid);
    } else if ((c.kind === 'parallel' || c.kind === 'perpendicular') && c.a !== c.b) {
      const pair = [c.a, c.b].sort().join('|');
      const other = firstPP.get(`${pair}|${c.kind === 'parallel' ? 'perpendicular' : 'parallel'}`);
      if (other) out.push([other, cid]);
      else if (!firstPP.has(`${pair}|${c.kind}`)) firstPP.set(`${pair}|${c.kind}`, cid);
    }
  }
  return out;
}

/** planegcs constraints for one MechPilot constraint; undefined when it cannot be mapped. */
function constraintLink(c: Constraint, byId: Map<Id, SolverEntity>, doc: Document): Link | undefined {
  const pt = (r: PointRef) => pointId(byId.get(r.entity), r.point);
  const line = (id: Id) => (byId.get(id)?.type === 'line' ? id : undefined);
  const id = c.id;
  const mk = (entities: Id[], prims: GcsConstraint[]): Link => ({ owner: id, entities: [...new Set(entities)], prims });
  switch (c.kind) {
    case 'coincident': {
      const p1 = pt(c.p1);
      const p2 = pt(c.p2);
      if (!p1 || !p2 || p1 === p2) return undefined;
      return mk([c.p1.entity, c.p2.entity], [{ id, type: 'p2p_coincident', p1_id: p1, p2_id: p2 }]);
    }
    case 'pointOnLine': {
      const p = pt(c.p);
      const l = line(c.line);
      if (!p || !l || c.p.entity === c.line) return undefined;
      return mk([c.p.entity, l], [{ id, type: 'point_on_line_pl', p_id: p, l_id: l }]);
    }
    case 'horizontal':
    case 'vertical': {
      const l = line(c.entity);
      if (!l) return undefined;
      return mk([l], [c.kind === 'horizontal' ? { id, type: 'horizontal_l', l_id: l } : { id, type: 'vertical_l', l_id: l }]);
    }
    case 'parallel':
    case 'perpendicular': {
      const a = line(c.a);
      const b = line(c.b);
      if (!a || !b || a === b) return undefined;
      return mk([a, b], [c.kind === 'parallel' ? { id, type: 'parallel', l1_id: a, l2_id: b } : { id, type: 'perpendicular_ll', l1_id: a, l2_id: b }]);
    }
    case 'tangent': {
      const a = byId.get(c.a);
      const b = byId.get(c.b);
      if (!a || !b || a === b) return undefined;
      const atEnd = endpointTangent(id, a, b, doc);
      if (atEnd) return mk([a.id, b.id], atEnd);
      const prim = tangentPrim(id, a, b);
      return prim ? mk([a.id, b.id], [prim]) : undefined;
    }
    case 'equal': {
      const a = byId.get(c.a);
      const b = byId.get(c.b);
      if (!a || !b || a === b) return undefined;
      const prim = equalPrim(id, a, b);
      return prim ? mk([a.id, b.id], [prim]) : undefined;
    }
    case 'symmetric': {
      const p1 = pt(c.p1);
      const p2 = pt(c.p2);
      const l = line(c.line);
      if (!p1 || !p2 || !l || p1 === p2) return undefined;
      return mk([c.p1.entity, c.p2.entity, l], [{ id, type: 'p2p_symmetric_ppl', p1_id: p1, p2_id: p2, l_id: l }]);
    }
    case 'fixed': {
      const e = byId.get(c.entity);
      if (!e) return undefined;
      return mk([e.id], fixedPrims(id, e));
    }
    case 'distance': {
      const p1 = pt(c.p1);
      const p2 = pt(c.p2);
      if (!p1 || !p2 || p1 === p2) return undefined;
      return mk([c.p1.entity, c.p2.entity], [{ id, type: 'p2p_distance', p1_id: p1, p2_id: p2, distance: c.value }]);
    }
    case 'pointLineDistance': {
      const p = pt(c.p);
      const l = line(c.line);
      if (!p || !l || c.p.entity === c.line) return undefined;
      return mk([c.p.entity, l], [{ id, type: 'p2l_distance', p_id: p, l_id: l, distance: c.value }]);
    }
    case 'angle': {
      const a = line(c.a);
      const b = line(c.b);
      if (!a || !b || a === b) return undefined;
      return mk([a, b], [{ id, type: 'l2l_angle_ll', l1_id: a, l2_id: b, angle: c.value }]);
    }
    case 'radius': {
      const e = byId.get(c.entity);
      if (e?.type === 'circle') return mk([e.id], [{ id, type: 'circle_radius', c_id: e.id, radius: c.value }]);
      if (e?.type === 'arc') return mk([e.id], [{ id, type: 'arc_radius', a_id: e.id, radius: c.value }]);
      return undefined;
    }
  }
}

function tangentPrim(id: Id, a: SolverEntity, b: SolverEntity): GcsConstraint | undefined {
  const k = `${a.type}-${b.type}`;
  switch (k) {
    case 'line-circle':
      return { id, type: 'tangent_lc', l_id: a.id, c_id: b.id };
    case 'circle-line':
      return { id, type: 'tangent_lc', l_id: b.id, c_id: a.id };
    case 'line-arc':
      return { id, type: 'tangent_la', l_id: a.id, a_id: b.id };
    case 'arc-line':
      return { id, type: 'tangent_la', l_id: b.id, a_id: a.id };
    case 'circle-circle':
      return { id, type: 'tangent_cc', c1_id: a.id, c2_id: b.id };
    case 'circle-arc':
      return { id, type: 'tangent_ca', c_id: a.id, a_id: b.id };
    case 'arc-circle':
      return { id, type: 'tangent_ca', c_id: b.id, a_id: a.id };
    case 'arc-arc':
      return { id, type: 'tangent_aa', a1_id: a.id, a2_id: b.id };
    default:
      return undefined;
  }
}

/* ---------- tangency at a shared end point ---------- */

const ENDS: Record<'line' | 'arc', PointRef['point'][]> = { line: ['a', 'b'], arc: ['start', 'end'] };

/** Coordinates of an entity end point (line a/b, arc start/end). */
function endAt(e: LineEntity | ArcEntity, point: PointRef['point']): Vec2 {
  if (e.type === 'line') return point === 'a' ? e.a : e.b;
  return arcPoint(e, point === 'start' ? e.start : e.end);
}

/**
 * The normal planegcs uses for a curve at a point (FreeCAD planegcs Geo.cpp, CalculateNormal): a
 * line's direction (a → b) turned 90° counter-clockwise; a circle's or arc's centre minus the point.
 */
function normalAt(e: LineEntity | ArcEntity, p: Vec2): Vec2 {
  if (e.type === 'line') return { x: -(e.b.y - e.a.y), y: e.b.x - e.a.x };
  return { x: e.center.x - p.x, y: e.center.y - p.y };
}

/**
 * Tangency where a line or arc ends on another (a fillet corner), as FreeCAD's Sketcher does it:
 * planegcs' distance-based tangent_la / tangent_aa is degenerate when the tangency point is also a
 * coincident end point (it is reported redundant and holds nothing), so the two curves are made
 * tangent through the shared point with angle_via_point: the angle between their normals there is
 * 0 or π, whichever is closer to the current shape. When the ends only touch (no coincident
 * constraint joins them), a coincident is added too: tangency at an end point implies the join.
 */
function endpointTangent(id: Id, a: SolverEntity, b: SolverEntity, doc: Document): GcsConstraint[] | undefined {
  if ((a.type !== 'line' && a.type !== 'arc') || (b.type !== 'line' && b.type !== 'arc') || (a.type === 'line' && b.type === 'line')) return undefined;
  let shared: { pa: PointRef['point']; pb: PointRef['point']; joined: boolean } | undefined;
  // A coincident constraint joining an end of one to an end of the other.
  for (const cid of doc.constraintOrder) {
    const k = doc.constraints[cid];
    if (k?.kind !== 'coincident') continue;
    const [r1, r2] = k.p1.entity === a.id && k.p2.entity === b.id ? [k.p1, k.p2] : k.p1.entity === b.id && k.p2.entity === a.id ? [k.p2, k.p1] : [undefined, undefined];
    if (r1 && r2 && ENDS[a.type].includes(r1.point) && ENDS[b.type].includes(r2.point)) {
      shared = { pa: r1.point, pb: r2.point, joined: true };
      break;
    }
  }
  // Or end points that touch.
  if (!shared) {
    for (const pa of ENDS[a.type])
      for (const pb of ENDS[b.type]) {
        const p = endAt(a, pa);
        const q = endAt(b, pb);
        if (!shared && Math.abs(p.x - q.x) <= MATCH_TOL && Math.abs(p.y - q.y) <= MATCH_TOL) shared = { pa, pb, joined: false };
      }
  }
  if (!shared) return undefined;
  const at = endAt(a, shared.pa);
  const n1 = normalAt(a, at);
  const n2 = normalAt(b, at);
  // planegcs: the error is the angle from n1 (turned by `angle`) to n2.
  const current = Math.atan2(n1.x * n2.y - n1.y * n2.x, n1.x * n2.x + n1.y * n2.y);
  const pa = pointId(a, shared.pa) as string;
  const out: GcsConstraint[] = [{ id, type: 'angle_via_point', crv1_id: a.id, crv2_id: b.id, p_id: pa, angle: Math.abs(current) <= Math.PI / 2 ? 0 : Math.PI }];
  if (!shared.joined) out.push({ id: `${id}.p`, type: 'p2p_coincident', p1_id: pa, p2_id: pointId(b, shared.pb) as string });
  return out;
}

function equalPrim(id: Id, a: SolverEntity, b: SolverEntity): GcsConstraint | undefined {
  const k = `${a.type}-${b.type}`;
  switch (k) {
    case 'line-line':
      return { id, type: 'equal_length', l1_id: a.id, l2_id: b.id };
    case 'circle-circle':
      return { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id };
    case 'circle-arc':
      return { id, type: 'equal_radius_ca', c1_id: a.id, a2_id: b.id };
    case 'arc-circle':
      return { id, type: 'equal_radius_ca', c1_id: b.id, a2_id: a.id };
    case 'arc-arc':
      return { id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id };
    default:
      return undefined;
  }
}

/**
 * `fixed` as explicit equations rather than planegcs `fixed: true` points: planegcs silently
 * ignores a constraint whose unknowns are all fixed (a horizontal constraint on a fixed sloping
 * line "solves" with no error), while coordinate equations are diagnosed like any other constraint
 * and conflicts are reported. Exactly as many equations as the entity has degrees of freedom, so a
 * fixed entity is fully constrained and nothing is redundant.
 */
function fixedPrims(id: Id, e: SolverEntity): GcsConstraint[] {
  const coords = (pid: string, p: Vec2, tag: string): GcsConstraint[] => [
    { id: `${id}.${tag}x`, type: 'coordinate_x', p_id: pid, x: p.x },
    { id: `${id}.${tag}y`, type: 'coordinate_y', p_id: pid, y: p.y },
  ];
  switch (e.type) {
    case 'line':
      return [...coords(`${e.id}.a`, e.a, 'a'), ...coords(`${e.id}.b`, e.b, 'b')];
    case 'circle':
      return [...coords(`${e.id}.center`, e.center, 'c'), { id: `${id}.r`, type: 'circle_radius', c_id: e.id, radius: e.radius }];
    case 'arc':
      return [
        ...coords(`${e.id}.center`, e.center, 'c'),
        { id: `${id}.r`, type: 'arc_radius', a_id: e.id, radius: e.radius },
        { id: `${id}.s`, type: 'equal', param1: { o_id: e.id, prop: 'start_angle' }, param2: e.start },
        { id: `${id}.e`, type: 'equal', param1: { o_id: e.id, prop: 'end_angle' }, param2: e.end },
      ];
    case 'polyline':
      // A polyline with arcs is fixed already (its points are fixed in the system).
      return isFixedOnly(e) ? [] : e.points.flatMap((p, i) => coords(`${e.id}.${i}`, p, `${i}`));
  }
}

/* ---------- driving dimensions ---------- */

interface PointHit {
  entity: Id;
  pid: string;
}
type PointIndex = (p: Vec2) => PointHit | undefined;

/** Find the first entity point (drawing order) within MATCH_TOL of a position. */
function pointIndex(entities: SolverEntity[]): PointIndex {
  // A grid keyed on the rounded coordinate (lookup only; the stored values are never rounded).
  const cell = (v: number) => Math.round(v * 1e6);
  const grid = new Map<string, { at: Vec2; order: number; hit: PointHit }[]>();
  entities.forEach((e, order) => {
    for (const [name, at] of entityPoints(e)) {
      const pid = pointId(e, name) as string;
      const key = `${cell(at.x)},${cell(at.y)}`;
      const list = grid.get(key);
      const item = { at, order, hit: { entity: e.id, pid } };
      if (list) list.push(item);
      else grid.set(key, [item]);
    }
  });
  return (p) => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    let best: { order: number; hit: PointHit } | undefined;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const item of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.abs(item.at.x - p.x) <= MATCH_TOL && Math.abs(item.at.y - p.y) <= MATCH_TOL) {
            if (!best || item.order < best.order) best = { order: item.order, hit: item.hit };
          }
        }
    return best?.hit;
  };
}

/** Exact axis of a dimension direction (the same test as shared/draw/annotations.ts). */
function axisOf(rotation: number): 'x' | 'y' | undefined {
  const dx = Math.cos(rotation);
  const dy = Math.sin(rotation);
  if (Math.abs(dy) < 1e-15) return 'x';
  if (Math.abs(dx) < 1e-15) return 'y';
  return undefined;
}

function dimensionLink(d: DimensionEntity, value: number, at: PointIndex, byId: Map<Id, SolverEntity>): Link | undefined {
  const id = d.id;
  const mk = (entities: Id[], prims: GcsConstraint[]): Link => ({ owner: id, entities: [...new Set(entities)], prims });
  switch (d.kind) {
    case 'linear':
    case 'ordinate': {
      const axis = axisOf(d.rotation);
      const a = at(d.a);
      const b = at(d.b);
      if (!axis || !a || !b || a.pid === b.pid) return undefined;
      const span = axis === 'x' ? d.b.x - d.a.x : d.b.y - d.a.y;
      // linear: |b − a| along the axis keeps its current sign; ordinate: the signed coordinate of b
      // from a, in the dimension's direction (shared/draw/annotations.ts, dimensionValue).
      const dir = axis === 'x' ? Math.cos(d.rotation) : Math.sin(d.rotation);
      const diff = d.kind === 'linear' ? (span < 0 ? -value : value) : dir < 0 ? -value : value;
      return mk([a.entity, b.entity], [{ id, type: 'difference', param1: { o_id: a.pid, prop: axis }, param2: { o_id: b.pid, prop: axis }, difference: diff }]);
    }
    case 'aligned': {
      const a = at(d.a);
      const b = at(d.b);
      if (!a || !b || a.pid === b.pid) return undefined;
      return mk([a.entity, b.entity], [{ id, type: 'p2p_distance', p1_id: a.pid, p2_id: b.pid, distance: value }]);
    }
    case 'radius':
    case 'diameter': {
      const r = d.kind === 'radius' ? value : value / 2;
      const measured = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      for (const e of byId.values()) {
        if (e.type !== 'circle' && e.type !== 'arc') continue;
        if (Math.abs(e.center.x - d.a.x) > MATCH_TOL || Math.abs(e.center.y - d.a.y) > MATCH_TOL || Math.abs(e.radius - measured) > MATCH_TOL) continue;
        return mk([e.id], [e.type === 'circle' ? { id, type: 'circle_radius', c_id: e.id, radius: r } : { id, type: 'arc_radius', a_id: e.id, radius: r }]);
      }
      return undefined;
    }
    case 'angular': {
      if (!d.center) return undefined;
      const center = d.center;
      const l1 = legLine(center, d.a, byId);
      const l2 = legLine(center, d.b, byId);
      if (!l1 || !l2 || l1.line === l2.line) return undefined;
      // The dimension measures counter-clockwise from leg a to leg b (dimensionValue). planegcs
      // measures between line directions (point a → point b of each line): add π for each leg that
      // runs against its line.
      const flips = (l1.reversed ? 1 : 0) + (l2.reversed ? 1 : 0);
      const angle = (value * Math.PI) / 180 + (flips === 1 ? Math.PI : 0);
      return mk([l1.line, l2.line], [{ id, type: 'l2l_angle_ll', l1_id: l1.line, l2_id: l2.line, angle }]);
    }
  }
}

/** The line of an angular dimension's leg: a line through the vertex and the leg point. */
function legLine(center: Vec2, p: Vec2, byId: Map<Id, SolverEntity>): { line: Id; reversed: boolean } | undefined {
  const leg = { x: p.x - center.x, y: p.y - center.y };
  const legLen = Math.hypot(leg.x, leg.y);
  if (legLen === 0) return undefined;
  for (const e of byId.values()) {
    if (e.type !== 'line') continue;
    const d = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
    const len = Math.hypot(d.x, d.y);
    if (len === 0) continue;
    // Both the vertex and the leg point lie on the line's infinite extension.
    const off = (q: Vec2) => Math.abs(d.x * (q.y - e.a.y) - d.y * (q.x - e.a.x)) / len;
    if (off(center) > MATCH_TOL || off(p) > MATCH_TOL) continue;
    return { line: e.id, reversed: d.x * leg.x + d.y * leg.y < 0 };
  }
  return undefined;
}

/* ---------------------------------------------------------------------------------------------- */
/* Building the system                                                                              */
/* ---------------------------------------------------------------------------------------------- */

/** Translate a document (or one cluster of it) into planegcs primitives. */
export function buildSystem(doc: Document, opts: BuildOptions = {}): SketchSystem {
  const a = opts.analysis ?? analyse(doc, opts);
  const only = opts.entities;
  const included = a.entities.filter((e) => !only || only.has(e.id));
  const inSet = new Set(included.map((e) => e.id));
  const prims: SketchPrimitive[] = [];
  const used = new Set<string>();
  const owner = new Map<string, Id>();
  const byOwner = new Map<Id, string[]>();
  const geometry = new Map<Id, string>();
  let unknowns = 0;

  const push = (p: SketchPrimitive) => {
    prims.push(p);
    used.add(p.id);
  };

  for (const e of included) {
    const fixed = isFixedOnly(e);
    const point = (name: PointRef['point'], at: Vec2) => {
      push({ id: pointId(e, name) as string, type: 'point', x: at.x, y: at.y, fixed });
      if (!fixed) unknowns += 2;
    };
    switch (e.type) {
      case 'line':
        point('a', e.a);
        point('b', e.b);
        push({ id: e.id, type: 'line', p1_id: `${e.id}.a`, p2_id: `${e.id}.b` });
        geometry.set(e.id, e.id);
        break;
      case 'circle':
        point('center', e.center);
        push({ id: e.id, type: 'circle', c_id: `${e.id}.center`, radius: e.radius });
        unknowns += 1;
        geometry.set(e.id, e.id);
        break;
      case 'arc':
        point('center', e.center);
        point('start', arcPoint(e, e.start));
        point('end', arcPoint(e, e.end));
        push({ id: e.id, type: 'arc', c_id: `${e.id}.center`, start_id: `${e.id}.start`, end_id: `${e.id}.end`, radius: e.radius, start_angle: e.start, end_angle: e.end });
        push({ id: `${e.id}.rules`, type: 'arc_rules', a_id: e.id });
        unknowns += 3;
        geometry.set(e.id, e.id);
        break;
      case 'polyline':
        e.points.forEach((p, i) => point(i, p));
        if (!fixed) {
          const n = e.closed ? e.points.length : e.points.length - 1;
          for (let i = 0; i < n; i++) push({ id: `${e.id}.s${i}`, type: 'line', p1_id: `${e.id}.${i}`, p2_id: `${e.id}.${(i + 1) % e.points.length}` });
        }
        break;
    }
  }

  // Constraint ids are MechPilot ids where possible, so conflicts read back directly.
  const fresh = (pid: string) => {
    let id = pid;
    for (let k = 2; used.has(id); k++) id = `${pid}~${k}`;
    return id;
  };
  for (const link of a.links) {
    if (!link.entities.every((id) => inSet.has(id))) continue;
    for (const p of link.prims) {
      const id = fresh(p.id);
      push({ ...p, id });
      owner.set(id, link.owner);
      const list = byOwner.get(link.owner);
      if (list) list.push(id);
      else byOwner.set(link.owner, [id]);
    }
  }

  const tmp = opts.temporary;
  if (tmp && inSet.has(tmp.ref.entity)) {
    const pid = pointId(a.byId.get(tmp.ref.entity), tmp.ref.point);
    if (pid && !isFixedOnly(a.byId.get(tmp.ref.entity) as SolverEntity)) {
      push({ id: DRAG_POINT, type: 'point', x: tmp.to.x, y: tmp.to.y, fixed: true });
      push({ id: DRAG_CONSTRAINT, type: 'p2p_coincident', p1_id: pid, p2_id: DRAG_POINT, temporary: true });
    }
  }

  const fixedOnly = a.fixedOnly.filter((id) => inSet.has(id));
  return {
    primitives: prims,
    entities: included.map((e) => e.id),
    pointOf: (ref) => (inSet.has(ref.entity) ? pointId(a.byId.get(ref.entity), ref.point) : undefined),
    entityPrimitive: (id) => geometry.get(id),
    constraintPrimitives: (id) => byOwner.get(id) ?? [],
    ownerOf: (pid) => owner.get(pid),
    fixedEntities: a.fixedEntities,
    fixedOnly,
    skippedDimensions: a.skippedDimensions,
    skippedConstraints: a.skippedConstraints,
    structuralConflicts: a.structuralConflicts,
    unknowns,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Reading the solution back                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The entities whose geometry the solution changed (new objects, same ids; unchanged entities are
 * left out). Entities with a `fixed` constraint and polylines with arcs never change.
 *
 * A solved value within SOLVER_NOISE of the stored one keeps the stored value: such a change is
 * floating-point noise from the solver (e.g. an arc end point at sin(π) = 1.2e-16 pulling its line
 * end by 2e-15 mm), far below planegcs' own convergence threshold (1e-10), not an edit. Every
 * other value is copied exactly as solved (product rule 1: nothing is rounded).
 */
export function applySolution(doc: Document, system: SketchSystem, primitives: SketchPrimitive[]): Entity[] {
  const byId = new Map<string, SketchPrimitive>();
  for (const p of primitives) byId.set(p.id, p);
  const keep = (solved: number, stored: number) => (Math.abs(solved - stored) <= SOLVER_NOISE ? stored : solved);
  const pt = (id: string, fallback: Vec2): Vec2 => {
    const p = byId.get(id);
    return p?.type === 'point' ? { x: keep(p.x, fallback.x), y: keep(p.y, fallback.y) } : fallback;
  };
  const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
  const out: Entity[] = [];
  for (const id of system.entities) {
    const e = doc.entities[id];
    if (!isSolverEntity(e) || isFixedOnly(e) || system.fixedEntities.has(id)) continue;
    switch (e.type) {
      case 'line': {
        const a = pt(`${id}.a`, e.a);
        const b = pt(`${id}.b`, e.b);
        if (!same(a, e.a) || !same(b, e.b)) out.push({ ...e, a, b });
        break;
      }
      case 'circle': {
        const center = pt(`${id}.center`, e.center);
        const c = byId.get(id);
        const radius = c?.type === 'circle' ? keep(c.radius, e.radius) : e.radius;
        if (!same(center, e.center) || radius !== e.radius) out.push({ ...e, center, radius });
        break;
      }
      case 'arc': {
        const center = pt(`${id}.center`, e.center);
        const g = byId.get(id);
        const radius = g?.type === 'arc' ? keep(g.radius, e.radius) : e.radius;
        const start = g?.type === 'arc' ? keep(g.start_angle, e.start) : e.start;
        const end = g?.type === 'arc' ? keep(g.end_angle, e.end) : e.end;
        if (!same(center, e.center) || radius !== e.radius || start !== e.start || end !== e.end) out.push({ ...e, center, radius, start, end });
        break;
      }
      case 'polyline': {
        const points = e.points.map((p, i) => pt(`${id}.${i}`, p));
        if (points.some((p, i) => !same(p, e.points[i]))) out.push({ ...e, points });
        break;
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Plain-words explanation (product rule 5)                                                         */
/* ---------------------------------------------------------------------------------------------- */

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** A short id for people: sequential ids as they are ("e7"), random ones by their first 4 characters. */
export const shortId = (id: Id): string => (id.length <= 6 ? id : id.slice(0, 4));

/** "line e7", "circle 3kf2", ... */
export function entityName(doc: Document, id: Id, t: Translate = defaultT): string {
  const e = doc.entities[id];
  const s = shortId(id);
  switch (e?.type) {
    case 'line':
      return t('line {id}', { id: s });
    case 'circle':
      return t('circle {id}', { id: s });
    case 'arc':
      return t('arc {id}', { id: s });
    case 'polyline':
      return t('polyline {id}', { id: s });
    case 'dimension':
      return t('dimension {id}', { id: s });
    default:
      return t('entity {id}', { id: s });
  }
}

function pointName(doc: Document, r: PointRef, t: Translate): string {
  const e = doc.entities[r.entity];
  const id = shortId(r.entity);
  if (e?.type === 'line') return r.point === 'a' ? t('the start of line {id}', { id }) : t('the end of line {id}', { id });
  if (e?.type === 'circle') return t('the centre of circle {id}', { id });
  if (e?.type === 'arc') return r.point === 'start' ? t('the start of arc {id}', { id }) : r.point === 'end' ? t('the end of arc {id}', { id }) : t('the centre of arc {id}', { id });
  if (e?.type === 'polyline' && typeof r.point === 'number') return t('vertex {n} of polyline {id}', { n: r.point + 1, id });
  return entityName(doc, r.entity, t);
}

/** Numbers in messages: up to 6 decimals, trailing zeros trimmed (display only; nothing stored changes). */
const num = (v: number): string => String(Number(v.toFixed(6)));

/** One constraint or driving dimension in words: "the horizontal constraint on line e7". */
export function describeConstraint(doc: Document, id: Id, t: Translate = defaultT): string {
  const c = doc.constraints[id];
  if (!c) {
    const d = doc.entities[id];
    if (d?.type === 'dimension' && d.driving !== undefined) {
      return d.kind === 'angular' ? t('the driving dimension {v}° ({name})', { v: num(d.driving), name: entityName(doc, id, t) }) : t('the driving dimension {v} mm ({name})', { v: num(d.driving), name: entityName(doc, id, t) });
    }
    return t('constraint {id}', { id: shortId(id) });
  }
  const e = (x: Id) => entityName(doc, x, t);
  const p = (r: PointRef) => pointName(doc, r, t);
  switch (c.kind) {
    case 'coincident':
      return t('the coincident constraint between {a} and {b}', { a: p(c.p1), b: p(c.p2) });
    case 'pointOnLine':
      return t('the point-on-line constraint of {p} on {line}', { p: p(c.p), line: e(c.line) });
    case 'horizontal':
      return t('the horizontal constraint on {e}', { e: e(c.entity) });
    case 'vertical':
      return t('the vertical constraint on {e}', { e: e(c.entity) });
    case 'parallel':
      return t('the parallel constraint between {a} and {b}', { a: e(c.a), b: e(c.b) });
    case 'perpendicular':
      return t('the perpendicular constraint between {a} and {b}', { a: e(c.a), b: e(c.b) });
    case 'tangent':
      return t('the tangent constraint between {a} and {b}', { a: e(c.a), b: e(c.b) });
    case 'equal':
      return t('the equal constraint between {a} and {b}', { a: e(c.a), b: e(c.b) });
    case 'symmetric':
      return t('the symmetry of {a} and {b} about {line}', { a: p(c.p1), b: p(c.p2), line: e(c.line) });
    case 'fixed':
      return t('the fixed constraint on {e}', { e: e(c.entity) });
    case 'distance':
      return t('the distance {v} mm between {a} and {b}', { v: num(c.value), a: p(c.p1), b: p(c.p2) });
    case 'pointLineDistance':
      return t('the distance {v} mm from {p} to {line}', { v: num(c.value), p: p(c.p), line: e(c.line) });
    case 'angle':
      return t('the angle {v}° between {a} and {b}', { v: num((c.value * 180) / Math.PI), a: e(c.a), b: e(c.b) });
    case 'radius':
      return t('the radius {v} mm of {e}', { v: num(c.value), e: e(c.entity) });
  }
}

const list = (items: string[], t: Translate): string => (items.length <= 1 ? (items[0] ?? '') : t('{list} and {last}', { list: items.slice(0, -1).join(', '), last: items[items.length - 1] }));

/** The diagnosis in plain words for the command line. */
export function explain(doc: Document, diagnosis: SketchDiagnosis, t: Translate = defaultT): string {
  const out: string[] = [];
  const d = diagnosis;
  const names = (ids: Id[]) => ids.map((id) => describeConstraint(doc, id, t));
  switch (d.status) {
    case 'empty':
      out.push(d.dof === 1 ? t('No constraints yet: the sketch has 1 degree of freedom.') : t('No constraints yet: the sketch has {n} degrees of freedom.', { n: d.dof }));
      break;
    case 'conflicting': {
      const c = names(d.conflicting);
      if (c.length === 2) out.push(t('Over-constrained: {a} conflicts with {b}. Remove one of them.', { a: c[0], b: c[1] }));
      else if (c.length > 2) out.push(t('Over-constrained: these constraints cannot all hold: {list}. Remove one of them.', { list: list(c, t) }));
      else out.push(t('Over-constrained: {a} cannot hold with the other constraints. Remove it or change its value.', { a: c[0] ?? '' }));
      break;
    }
    case 'redundant': {
      const r = names(d.redundant);
      if (r.length === 1) out.push(t('Solved, but {a} is redundant: the other constraints already fix the same thing. You can delete it.', { a: r[0] }));
      else out.push(t('Solved, but these constraints are redundant: {list}. The other constraints already fix the same things; you can delete them.', { list: list(r, t) }));
      break;
    }
    case 'failed':
      if (d.reason === 'too-large') out.push(t('The sketch is too large for the solver: {detail}. Split it into smaller groups of connected geometry.', { detail: d.detail ?? '' }));
      else if (d.reason === 'engine-error') out.push(t('The constraint solver stopped with an internal error ({detail}). Undo the last change and try again.', { detail: d.detail ?? '' }));
      else out.push(t('The solver could not satisfy the constraints from the current shape. Some may contradict each other (for example an angle between two horizontal lines), or the geometry is too far from the intended shape: move it closer and try again.'));
      break;
    case 'solved':
      if (d.dof === 0) out.push(t('Solved; fully constrained.'));
      else if (d.freeExample) out.push(d.dof === 1 ? t('Solved. The sketch has 1 degree of freedom left (for example {e} can still move).', { e: entityName(doc, d.freeExample, t) }) : t('Solved. The sketch has {n} degrees of freedom left (for example {e} can still move).', { n: d.dof, e: entityName(doc, d.freeExample, t) }));
      else out.push(d.dof === 1 ? t('Solved. The sketch has 1 degree of freedom left.') : t('Solved. The sketch has {n} degrees of freedom left.', { n: d.dof }));
      break;
  }
  if (d.partiallyRedundant.length && d.status !== 'conflicting') out.push(t('Partly redundant: {list}.', { list: list(names(d.partiallyRedundant), t) }));
  if (d.skippedDimensions.length)
    out.push(t('Driving dimensions not applied, because their points are not on sketch geometry (or the direction is not horizontal or vertical): {list}.', { list: list(d.skippedDimensions.map((id) => entityName(doc, id, t)), t) }));
  if (d.skippedConstraints.length) out.push(t('Constraints ignored, because they refer to geometry the solver does not handle (ellipses, splines, text): {list}.', { list: list(names(d.skippedConstraints), t) }));
  if (d.fixedOnly.length) out.push(t('Polylines with arcs take part only as fixed points: {list}. Explode them into lines and arcs to constrain them.', { list: list(d.fixedOnly.map((id) => entityName(doc, id, t)), t) }));
  return out.join(' ');
}
