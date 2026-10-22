// The .mechpilot.json file format (docs/file-format.md): versioned JSON with migrations and stable
// ordering so files diff well in Git (product rule 3). Numbers are written by JSON.stringify, which
// round-trips every double exactly, so nothing is rounded on save or load (product rule 1).

import { DEFAULT_DIM_STYLE } from '../draw/annotations';
import { FORMAT_NAME, FORMAT_VERSION, type Constraint, type DimensionKind, type DimStyle, type Document, type EdgeSelector, type Entity, type FaceSelector, type Feature, type HoleSpec, type Layer, type Part, type PointRef, type Sheet, type SheetView, type SketchPlane, type Tolerance } from './types';

export interface FileError {
  code: 'not-json' | 'not-mechpilot' | 'newer-version' | 'invalid';
  message: string;
  hint?: string;
}
export type ParseResult = { ok: true; doc: Document; migratedFrom?: number } | { ok: false; error: FileError };

export const FILE_EXTENSION = '.mechpilot.json';

/** Fixed key order for the top level; other objects get their keys sorted. */
const TOP_ORDER: (keyof Document)[] = ['format', 'version', 'unit', 'name', 'description', 'standard', 'projection', 'dimStyle', 'layerOrder', 'activeLayer', 'layers', 'entityOrder', 'entities', 'constraintOrder', 'constraints', 'partOrder', 'parts', 'sheetOrder', 'sheets'];
/** Entities and layers: id and type first, then the rest alphabetically, so a diff reads naturally. */
const FIRST_KEYS = ['id', 'type', 'kind', 'layer'];

function canonical(value: unknown, firstKeys: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => canonical(v));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => {
      const ia = firstKeys.indexOf(a);
      const ib = firstKeys.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const out: Record<string, unknown> = {};
    for (const k of keys) if (obj[k] !== undefined) out[k] = canonical(obj[k]);
    return out;
  }
  return value;
}

/** Serialize with stable ordering: top-level keys in TOP_ORDER, maps keyed in their order arrays. */
export function serialize(doc: Document): string {
  const out: Record<string, unknown> = {};
  for (const k of TOP_ORDER) {
    const v = doc[k];
    if (v === undefined) continue;
    if (k === 'layers') {
      const m: Record<string, unknown> = {};
      for (const id of doc.layerOrder) if (doc.layers[id]) m[id] = canonical(doc.layers[id], FIRST_KEYS);
      out[k] = m;
    } else if (k === 'entities') {
      const m: Record<string, unknown> = {};
      for (const id of doc.entityOrder) if (doc.entities[id]) m[id] = canonical(doc.entities[id], FIRST_KEYS);
      out[k] = m;
    } else if (k === 'sheets') {
      const m: Record<string, unknown> = {};
      for (const id of doc.sheetOrder) if (doc.sheets[id]) m[id] = canonical(doc.sheets[id], FIRST_KEYS);
      out[k] = m;
    } else if (k === 'constraints') {
      const m: Record<string, unknown> = {};
      for (const id of doc.constraintOrder) if (doc.constraints[id]) m[id] = canonical(doc.constraints[id], FIRST_KEYS);
      out[k] = m;
    } else if (k === 'parts') {
      const m: Record<string, unknown> = {};
      for (const id of doc.partOrder) if (doc.parts[id]) m[id] = canonical(doc.parts[id], FIRST_KEYS);
      out[k] = m;
    } else out[k] = canonical(v);
  }
  return JSON.stringify(out, null, 2) + '\n';
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
/** migrations[n] upgrades a version-n file to version n+1. */
const migrations: Record<number, Migration> = {
  // 1 → 2 (M1): new entity types only; a version-1 file is a valid version-2 file.
  1: (raw) => ({ ...raw, version: 2 }),
  // 2 → 3 (M2): dimension style and sheets, with defaults.
  2: (raw) => ({ ...raw, version: 3, dimStyle: { ...DEFAULT_DIM_STYLE }, sheets: {}, sheetOrder: [] }),
  // 3 → 4 (M3): sketch constraints (none yet) and driving dimensions (none yet).
  3: (raw) => ({ ...raw, version: 4, constraints: {}, constraintOrder: [] }),
  // 4 → 5 (M4): parts (none yet).
  4: (raw) => ({ ...raw, version: 5, parts: {}, partOrder: [] }),
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isVec = (v: unknown): v is { x: number; y: number } => isObj(v) && isNum(v.x) && isNum(v.y);
const isVecList = (v: unknown): v is { x: number; y: number }[] => Array.isArray(v) && v.every(isVec);
const vec = (v: { x: number; y: number }) => ({ x: v.x, y: v.y });

function validateLayer(v: unknown, id: string): Layer | string {
  if (!isObj(v)) return `layer ${id} is not an object`;
  if (v.id !== id) return `layer ${id} has id "${String(v.id)}"`;
  if (!isStr(v.name)) return `layer ${id}: name`;
  if (!isStr(v.color)) return `layer ${id}: color`;
  if (!isStr(v.lineType)) return `layer ${id}: lineType`;
  if (!isNum(v.lineWidth) || v.lineWidth <= 0) return `layer ${id}: lineWidth`;
  return { id, name: v.name, color: v.color, lineType: v.lineType, lineWidth: v.lineWidth, visible: v.visible !== false, locked: v.locked === true };
}

function validateTolerance(v: unknown, id: string): Tolerance | string | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return `entity ${id}: tolerance`;
  switch (v.kind) {
    case 'deviation':
    case 'limits':
      if (!isNum(v.upper) || !isNum(v.lower)) return `entity ${id}: tolerance needs upper and lower`;
      return { kind: v.kind, upper: v.upper, lower: v.lower };
    case 'symmetric':
      if (!isNum(v.value) || v.value < 0) return `entity ${id}: symmetric tolerance needs a value >= 0`;
      return { kind: 'symmetric', value: v.value };
    case 'fit':
      if (!isStr(v.cls) || !/^[A-Za-z]{1,2}\d{1,2}$/.test(v.cls)) return `entity ${id}: fit class must look like H7 or g6`;
      return { kind: 'fit', cls: v.cls };
    default:
      return `entity ${id}: unknown tolerance kind "${String(v.kind)}"`;
  }
}

function validateEntity(v: unknown, id: string, layers: Record<string, Layer>): Entity | string {
  if (!isObj(v)) return `entity ${id} is not an object`;
  if (v.id !== id) return `entity ${id} has id "${String(v.id)}"`;
  if (!isStr(v.layer) || !layers[v.layer]) return `entity ${id}: layer "${String(v.layer)}" does not exist`;
  const base = { id, layer: v.layer };
  switch (v.type) {
    case 'line':
      if (!isVec(v.a) || !isVec(v.b)) return `entity ${id}: line needs points a and b`;
      return { ...base, type: 'line', a: vec(v.a), b: vec(v.b) };
    case 'circle':
      if (!isVec(v.center) || !isNum(v.radius) || v.radius <= 0) return `entity ${id}: circle needs center and radius > 0`;
      return { ...base, type: 'circle', center: vec(v.center), radius: v.radius };
    case 'arc':
      if (!isVec(v.center) || !isNum(v.radius) || v.radius <= 0 || !isNum(v.start) || !isNum(v.end)) return `entity ${id}: arc needs center, radius > 0, start, end`;
      return { ...base, type: 'arc', center: vec(v.center), radius: v.radius, start: v.start, end: v.end };
    case 'polyline': {
      if (!isVecList(v.points) || v.points.length < 2) return `entity ${id}: polyline needs at least two points`;
      const e: Entity = { ...base, type: 'polyline', points: v.points.map(vec), closed: v.closed === true };
      if (v.bulges !== undefined) {
        if (!Array.isArray(v.bulges) || !v.bulges.every(isNum)) return `entity ${id}: bulges must be numbers`;
        if (v.bulges.some((b) => b !== 0)) e.bulges = v.bulges.slice();
      }
      return e;
    }
    case 'ellipse':
      if (!isVec(v.center) || !isVec(v.major) || !isNum(v.ratio) || v.ratio <= 0 || v.ratio > 1 || !isNum(v.start) || !isNum(v.end)) return `entity ${id}: ellipse needs center, major, 0 < ratio <= 1, start, end`;
      if (v.major.x === 0 && v.major.y === 0) return `entity ${id}: ellipse major axis has zero length`;
      return { ...base, type: 'ellipse', center: vec(v.center), major: vec(v.major), ratio: v.ratio, start: v.start, end: v.end };
    case 'spline': {
      if (!isNum(v.degree) || v.degree < 1 || !Number.isInteger(v.degree)) return `entity ${id}: spline degree must be a positive integer`;
      if (!isVecList(v.controlPoints) || v.controlPoints.length < v.degree + 1) return `entity ${id}: spline needs at least degree + 1 control points`;
      if (!Array.isArray(v.knots) || !v.knots.every(isNum) || v.knots.length !== v.controlPoints.length + v.degree + 1) return `entity ${id}: spline needs controlPoints + degree + 1 knots`;
      for (let i = 1; i < v.knots.length; i++) if (v.knots[i] < v.knots[i - 1]) return `entity ${id}: spline knots must not decrease`;
      const e: Entity = { ...base, type: 'spline', degree: v.degree, controlPoints: v.controlPoints.map(vec), knots: v.knots.slice(), closed: v.closed === true };
      if (v.fitPoints !== undefined) {
        if (!isVecList(v.fitPoints)) return `entity ${id}: fitPoints must be points`;
        e.fitPoints = v.fitPoints.map(vec);
      }
      return e;
    }
    case 'text':
      if (!isVec(v.position) || !isStr(v.text) || !isNum(v.height) || v.height <= 0 || !isNum(v.rotation)) return `entity ${id}: text needs position, text, height > 0, rotation`;
      return { ...base, type: 'text', position: vec(v.position), text: v.text, height: v.height, rotation: v.rotation };
    case 'dimension': {
      const kinds = ['linear', 'aligned', 'angular', 'radius', 'diameter', 'ordinate'];
      if (!isStr(v.kind) || !kinds.includes(v.kind)) return `entity ${id}: dimension kind must be one of ${kinds.join(', ')}`;
      if (!isVec(v.a) || !isVec(v.b) || !isVec(v.position) || !isNum(v.rotation)) return `entity ${id}: dimension needs a, b, position, rotation`;
      if (v.kind === 'angular' && !isVec(v.center)) return `entity ${id}: angular dimension needs center`;
      const tol = validateTolerance(v.tolerance, id);
      if (typeof tol === 'string') return tol;
      const e: Entity = { ...base, type: 'dimension', kind: v.kind as DimensionKind, a: vec(v.a), b: vec(v.b), position: vec(v.position), rotation: v.rotation };
      if (isVec(v.center)) e.center = vec(v.center);
      if (isStr(v.text)) e.text = v.text;
      if (isStr(v.prefix)) e.prefix = v.prefix;
      if (isStr(v.suffix)) e.suffix = v.suffix;
      if (tol) e.tolerance = tol;
      if (isNum(v.decimals) && Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 6) e.decimals = v.decimals;
      if (v.driving !== undefined) {
        if (!isNum(v.driving)) return `entity ${id}: driving must be a number`;
        e.driving = v.driving;
      }
      return e;
    }
    case 'note': {
      if (!isVec(v.position) || !isStr(v.text) || !isNum(v.height) || v.height <= 0 || !isNum(v.rotation)) return `entity ${id}: note needs position, text, height > 0, rotation`;
      const e: Entity = { ...base, type: 'note', position: vec(v.position), text: v.text, height: v.height, rotation: v.rotation };
      if (v.leader !== undefined) {
        if (!isVecList(v.leader)) return `entity ${id}: leader must be points`;
        if (v.leader.length) e.leader = v.leader.map(vec);
      }
      return e;
    }
    case 'balloon':
      if (!isVec(v.position) || !isStr(v.text) || !isVec(v.leader)) return `entity ${id}: balloon needs position, text, leader`;
      return { ...base, type: 'balloon', position: vec(v.position), text: v.text, leader: vec(v.leader) };
    case 'surface': {
      if (!isVec(v.position) || !isNum(v.rotation) || !['any', 'required', 'prohibited'].includes(String(v.removal))) return `entity ${id}: surface symbol needs position, rotation, removal (any, required, prohibited)`;
      const e: Entity = { ...base, type: 'surface', position: vec(v.position), rotation: v.rotation, removal: v.removal as 'any' | 'required' | 'prohibited' };
      if (v.ra !== undefined) {
        if (!isNum(v.ra) || v.ra <= 0) return `entity ${id}: Ra must be a number > 0 (µm)`;
        e.ra = v.ra;
      }
      if (isStr(v.text) && v.text) e.text = v.text;
      if (v.leader !== undefined) {
        if (!isVec(v.leader)) return `entity ${id}: leader must be a point`;
        e.leader = vec(v.leader);
      }
      return e;
    }
    case 'gdt': {
      if (!isVec(v.position) || !isNum(v.rotation) || !isStr(v.characteristic) || !isStr(v.tolerance) || !Array.isArray(v.datums) || !v.datums.every(isStr) || v.datums.length > 3) return `entity ${id}: tolerance frame needs position, rotation, characteristic, tolerance, up to three datums`;
      const e: Entity = { ...base, type: 'gdt', position: vec(v.position), rotation: v.rotation, characteristic: v.characteristic, tolerance: v.tolerance, datums: v.datums.slice() };
      if (v.leader !== undefined) {
        if (!isVec(v.leader)) return `entity ${id}: leader must be a point`;
        e.leader = vec(v.leader);
      }
      return e;
    }
    case 'datum':
      if (!isVec(v.position) || !isNum(v.rotation) || !isStr(v.label) || !v.label) return `entity ${id}: datum needs position, rotation, label`;
      return { ...base, type: 'datum', position: vec(v.position), rotation: v.rotation, label: v.label };
    default:
      return `entity ${id}: unknown type "${String(v.type)}"`;
  }
}

const POINT_NAMES = ['a', 'b', 'center', 'start', 'end'];
function validatePointRef(v: unknown, entities: Record<string, Entity>, where: string): PointRef | string {
  if (!isObj(v) || !isStr(v.entity) || !entities[v.entity]) return `${where}: unknown entity`;
  const e = entities[v.entity];
  const p = v.point;
  if (typeof p === 'number') {
    if (e.type !== 'polyline' || !Number.isInteger(p) || p < 0 || p >= e.points.length) return `${where}: vertex ${String(p)} does not exist`;
    return { entity: v.entity, point: p };
  }
  if (!isStr(p) || !POINT_NAMES.includes(p)) return `${where}: point must be a, b, center, start, end or a vertex index`;
  const ok = (e.type === 'line' && (p === 'a' || p === 'b')) || (e.type === 'circle' && p === 'center') || (e.type === 'arc' && (p === 'center' || p === 'start' || p === 'end'));
  if (!ok) return `${where}: a ${e.type} has no point "${p}"`;
  return { entity: v.entity, point: p as PointRef['point'] };
}

function validateConstraint(v: unknown, id: string, entities: Record<string, Entity>): Constraint | string {
  if (!isObj(v)) return `constraint ${id} is not an object`;
  if (v.id !== id) return `constraint ${id} has id "${String(v.id)}"`;
  const ent = (key: string, types: Entity['type'][]): string | null => {
    const eid = v[key];
    if (!isStr(eid) || !entities[eid]) return `constraint ${id}: ${key} is not an entity`;
    if (!types.includes(entities[eid].type)) return `constraint ${id}: ${key} must be a ${types.join(' or ')}`;
    return null;
  };
  const pt = (key: string): PointRef | string => validatePointRef(v[key], entities, `constraint ${id}: ${key}`);
  const num = (key: string): number | string => (isNum(v[key]) ? (v[key] as number) : `constraint ${id}: ${key} must be a number`);
  switch (v.kind) {
    case 'coincident':
    case 'distance': {
      const p1 = pt('p1');
      if (typeof p1 === 'string') return p1;
      const p2 = pt('p2');
      if (typeof p2 === 'string') return p2;
      if (v.kind === 'coincident') return { id, kind: 'coincident', p1, p2 };
      const value = num('value');
      if (typeof value === 'string') return value;
      return { id, kind: 'distance', p1, p2, value };
    }
    case 'pointOnLine':
    case 'pointLineDistance': {
      const p = pt('p');
      if (typeof p === 'string') return p;
      const bad = ent('line', ['line']);
      if (bad) return bad;
      if (v.kind === 'pointOnLine') return { id, kind: 'pointOnLine', p, line: v.line as string };
      const value = num('value');
      if (typeof value === 'string') return value;
      return { id, kind: 'pointLineDistance', p, line: v.line as string, value };
    }
    case 'horizontal':
    case 'vertical': {
      const bad = ent('entity', ['line']);
      if (bad) return bad;
      return { id, kind: v.kind, entity: v.entity as string };
    }
    case 'parallel':
    case 'perpendicular':
    case 'angle': {
      const bad = ent('a', ['line']) ?? ent('b', ['line']);
      if (bad) return bad;
      if (v.a === v.b) return `constraint ${id}: a and b are the same line`;
      if (v.kind === 'angle') {
        const value = num('value');
        if (typeof value === 'string') return value;
        return { id, kind: 'angle', a: v.a as string, b: v.b as string, value };
      }
      return { id, kind: v.kind, a: v.a as string, b: v.b as string };
    }
    case 'tangent':
    case 'equal': {
      const bad = ent('a', ['line', 'circle', 'arc']) ?? ent('b', ['line', 'circle', 'arc']);
      if (bad) return bad;
      if (v.a === v.b) return `constraint ${id}: a and b are the same entity`;
      return { id, kind: v.kind, a: v.a as string, b: v.b as string };
    }
    case 'symmetric': {
      const p1 = pt('p1');
      if (typeof p1 === 'string') return p1;
      const p2 = pt('p2');
      if (typeof p2 === 'string') return p2;
      const bad = ent('line', ['line']);
      if (bad) return bad;
      return { id, kind: 'symmetric', p1, p2, line: v.line as string };
    }
    case 'fixed': {
      const bad = ent('entity', ['line', 'circle', 'arc', 'polyline']);
      if (bad) return bad;
      return { id, kind: 'fixed', entity: v.entity as string };
    }
    case 'radius': {
      const bad = ent('entity', ['circle', 'arc']);
      if (bad) return bad;
      const value = num('value');
      if (typeof value === 'string') return value;
      if (value <= 0) return `constraint ${id}: radius must be > 0`;
      return { id, kind: 'radius', entity: v.entity as string, value };
    }
    default:
      return `constraint ${id}: unknown kind "${String(v.kind)}"`;
  }
}

const PLANES = ['XY', 'XZ', 'YZ'];
const AXES = ['X', 'Y', 'Z'];

function validateEdgeSelector(v: unknown, where: string): EdgeSelector | string {
  if (!isObj(v)) return `${where}: edges selector`;
  switch (v.kind) {
    case 'all':
      return { kind: 'all' };
    case 'parallelTo':
      if (!isStr(v.axis) || !AXES.includes(v.axis)) return `${where}: axis must be X, Y or Z`;
      return { kind: 'parallelTo', axis: v.axis as 'X' | 'Y' | 'Z' };
    case 'inPlane':
      if (!isStr(v.plane) || !PLANES.includes(v.plane) || !isNum(v.offset)) return `${where}: inPlane needs plane and offset`;
      return { kind: 'inPlane', plane: v.plane as SketchPlane, offset: v.offset };
    case 'ofLength':
      if (!isNum(v.length) || v.length <= 0) return `${where}: length > 0`;
      return { kind: 'ofLength', length: v.length };
    case 'inBox': {
      const ok = (a: unknown): a is [number, number, number] => Array.isArray(a) && a.length === 3 && a.every(isNum);
      if (!ok(v.min) || !ok(v.max)) return `${where}: inBox needs min and max [x, y, z]`;
      return { kind: 'inBox', min: [v.min[0], v.min[1], v.min[2]], max: [v.max[0], v.max[1], v.max[2]] };
    }
    default:
      return `${where}: unknown edges selector "${String(v.kind)}"`;
  }
}

function validateFaceSelector(v: unknown, where: string): FaceSelector | string {
  if (!isObj(v)) return `${where}: face selector`;
  if (v.kind === 'normal') {
    if (!isStr(v.direction) || !['X+', 'X-', 'Y+', 'Y-', 'Z+', 'Z-'].includes(v.direction)) return `${where}: direction must be X+, X-, Y+, Y-, Z+ or Z-`;
    return { kind: 'normal', direction: v.direction as FaceSelector extends { direction: infer D } ? D : never };
  }
  if (v.kind === 'inPlane') {
    if (!isStr(v.plane) || !PLANES.includes(v.plane) || !isNum(v.offset)) return `${where}: inPlane needs plane and offset`;
    return { kind: 'inPlane', plane: v.plane as SketchPlane, offset: v.offset };
  }
  return `${where}: unknown face selector "${String(v.kind)}"`;
}

function validateFeature(v: unknown, where: string, entities: Record<string, Entity>, sketchIds: Set<string>): Feature | string {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name)) return `${where}: a feature needs id and name`;
  const base = { id: v.id, name: v.name, ...(v.suppressed === true ? { suppressed: true } : {}) };
  const w = `${where} ${v.id}`;
  const sketchRef = (): string | null => (isStr(v.sketch) && sketchIds.has(v.sketch) ? null : `${w}: sketch must be the id of an earlier sketch feature`);
  const op = (): 'add' | 'cut' | string => (v.op === 'add' || v.op === 'cut' ? v.op : `${w}: op must be add or cut`);
  switch (v.kind) {
    case 'sketch': {
      if (!isStr(v.plane) || !PLANES.includes(v.plane) || !isNum(v.offset)) return `${w}: sketch needs plane (XY, XZ, YZ) and offset`;
      if (!Array.isArray(v.entities) || !v.entities.every(isStr) || v.entities.length === 0) return `${w}: sketch needs entity ids`;
      for (const eid of v.entities) if (!entities[eid]) return `${w}: entity ${eid} does not exist`;
      return { ...base, kind: 'sketch', plane: v.plane as SketchPlane, offset: v.offset, entities: v.entities.slice() };
    }
    case 'extrude': {
      const bad = sketchRef();
      if (bad) return bad;
      if (!isNum(v.distance) || v.distance <= 0) return `${w}: distance > 0`;
      if (!['normal', 'reverse', 'both'].includes(String(v.direction))) return `${w}: direction must be normal, reverse or both`;
      const o = op();
      if (o !== 'add' && o !== 'cut') return o;
      return { ...base, kind: 'extrude', sketch: v.sketch as string, distance: v.distance, direction: v.direction as 'normal' | 'reverse' | 'both', op: o };
    }
    case 'revolve': {
      const bad = sketchRef();
      if (bad) return bad;
      if (!isObj(v.axis) || !isVec(v.axis.a) || !isVec(v.axis.b)) return `${w}: axis needs points a and b`;
      if (!isNum(v.angle) || v.angle <= 0 || v.angle > 360) return `${w}: angle in (0, 360]`;
      const o = op();
      if (o !== 'add' && o !== 'cut') return o;
      return { ...base, kind: 'revolve', sketch: v.sketch as string, axis: { a: vec(v.axis.a), b: vec(v.axis.b) }, angle: v.angle, op: o };
    }
    case 'hole': {
      const bad = sketchRef();
      if (bad) return bad;
      if (!isObj(v.spec)) return `${w}: hole spec`;
      let spec: HoleSpec;
      if (v.spec.kind === 'simple') {
        if (!isNum(v.spec.diameter) || v.spec.diameter <= 0) return `${w}: diameter > 0`;
        spec = { kind: 'simple', diameter: v.spec.diameter };
      } else if (v.spec.kind === 'clearance') {
        if (!isStr(v.spec.thread) || !['fine', 'medium', 'coarse'].includes(String(v.spec.series))) return `${w}: clearance hole needs thread (e.g. M6) and series fine, medium or coarse`;
        spec = { kind: 'clearance', thread: v.spec.thread, series: v.spec.series as 'fine' | 'medium' | 'coarse' };
      } else if (v.spec.kind === 'tapped') {
        if (!isStr(v.spec.thread)) return `${w}: tapped hole needs thread (e.g. M6)`;
        spec = { kind: 'tapped', thread: v.spec.thread };
      } else return `${w}: unknown hole kind "${String(v.spec.kind)}"`;
      if (v.depth !== 'through' && !(isNum(v.depth) && v.depth > 0)) return `${w}: depth > 0 or "through"`;
      return { ...base, kind: 'hole', sketch: v.sketch as string, spec, depth: v.depth as number | 'through' };
    }
    case 'fillet':
    case 'chamfer': {
      const edges = validateEdgeSelector(v.edges, w);
      if (typeof edges === 'string') return edges;
      if (v.kind === 'fillet') {
        if (!isNum(v.radius) || v.radius <= 0) return `${w}: radius > 0`;
        return { ...base, kind: 'fillet', edges, radius: v.radius };
      }
      if (!isNum(v.distance) || v.distance <= 0) return `${w}: distance > 0`;
      return { ...base, kind: 'chamfer', edges, distance: v.distance };
    }
    case 'shell': {
      if (!isNum(v.thickness) || v.thickness <= 0) return `${w}: thickness > 0`;
      if (!Array.isArray(v.faces)) return `${w}: faces must be a list`;
      const faces: FaceSelector[] = [];
      for (const f of v.faces) {
        const r = validateFaceSelector(f, w);
        if (typeof r === 'string') return r;
        faces.push(r);
      }
      return { ...base, kind: 'shell', thickness: v.thickness, faces };
    }
    case 'mirror':
      if (!isStr(v.plane) || !PLANES.includes(v.plane) || !isNum(v.offset)) return `${w}: mirror needs plane and offset`;
      return { ...base, kind: 'mirror', plane: v.plane as SketchPlane, offset: v.offset };
    case 'pattern': {
      if (v.mode === 'linear') {
        const counts = v.counts;
        const spacing = v.spacing;
        const axes = v.axes;
        if (!Array.isArray(counts) || counts.length !== 2 || !counts.every((c) => Number.isInteger(c) && (c as number) >= 1)) return `${w}: counts [n1, n2] of integers >= 1`;
        if (!Array.isArray(spacing) || spacing.length !== 2 || !spacing.every(isNum)) return `${w}: spacing [d1, d2] in mm`;
        if (!Array.isArray(axes) || axes.length !== 2 || !axes.every((a) => isStr(a) && AXES.includes(a))) return `${w}: axes [X|Y|Z, X|Y|Z]`;
        return { ...base, kind: 'pattern', mode: 'linear', counts: [counts[0] as number, counts[1] as number], spacing: [spacing[0] as number, spacing[1] as number], axes: [axes[0] as 'X' | 'Y' | 'Z', axes[1] as 'X' | 'Y' | 'Z'] };
      }
      if (v.mode === 'circular') {
        if (!isStr(v.axis) || !AXES.includes(v.axis) || !Number.isInteger(v.count) || (v.count as number) < 2 || !isNum(v.angle) || v.angle <= 0 || v.angle > 360) return `${w}: circular pattern needs axis, count >= 2, angle in (0, 360]`;
        return { ...base, kind: 'pattern', mode: 'circular', axis: v.axis as 'X' | 'Y' | 'Z', count: v.count as number, angle: v.angle };
      }
      return `${w}: pattern mode must be linear or circular`;
    }
    case 'import':
      if (v.format !== 'step' || !isStr(v.data) || !isStr(v.sourceName)) return `${w}: import needs format "step", data and sourceName`;
      return { ...base, kind: 'import', format: 'step', data: v.data, sourceName: v.sourceName };
    default:
      return `${w}: unknown feature kind "${String(v.kind)}"`;
  }
}

function validatePart(v: unknown, id: string, entities: Record<string, Entity>): Part | string {
  if (!isObj(v)) return `part ${id} is not an object`;
  if (v.id !== id) return `part ${id} has id "${String(v.id)}"`;
  if (!isStr(v.name)) return `part ${id}: name`;
  if (!Array.isArray(v.features)) return `part ${id}: features must be a list`;
  const features: Feature[] = [];
  const sketchIds = new Set<string>();
  const seen = new Set<string>();
  for (const f of v.features) {
    const r = validateFeature(f, `part ${id}: feature`, entities, sketchIds);
    if (typeof r === 'string') return r;
    if (seen.has(r.id)) return `part ${id}: duplicate feature id ${r.id}`;
    seen.add(r.id);
    if (r.kind === 'sketch') sketchIds.add(r.id);
    features.push(r);
  }
  const part: Part = { id, name: v.name, features };
  if (isStr(v.material) && v.material) part.material = v.material;
  return part;
}

function validateDimStyle(v: unknown): DimStyle | string {
  if (!isObj(v)) return 'dimStyle is missing';
  const positive: (keyof DimStyle)[] = ['textHeight', 'arrowSize', 'annotationScale'];
  for (const k of positive) if (!isNum(v[k]) || (v[k] as number) <= 0) return `dimStyle.${k} must be a number > 0`;
  const nonNegative: (keyof DimStyle)[] = ['extensionOvershoot', 'extensionGap', 'textGap'];
  for (const k of nonNegative) if (!isNum(v[k]) || (v[k] as number) < 0) return `dimStyle.${k} must be a number >= 0`;
  if (!isNum(v.decimals) || !Number.isInteger(v.decimals) || v.decimals < 0 || v.decimals > 6) return 'dimStyle.decimals must be an integer from 0 to 6';
  const arrows = ['closed-filled', 'open', 'oblique', 'dot'];
  if (!isStr(v.arrowhead) || !arrows.includes(v.arrowhead)) return `dimStyle.arrowhead must be one of ${arrows.join(', ')}`;
  return {
    textHeight: v.textHeight as number,
    arrowSize: v.arrowSize as number,
    extensionOvershoot: v.extensionOvershoot as number,
    extensionGap: v.extensionGap as number,
    textGap: v.textGap as number,
    decimals: v.decimals,
    annotationScale: v.annotationScale as number,
    arrowhead: v.arrowhead as DimStyle['arrowhead'],
  };
}

function validateSheet(v: unknown, id: string): Sheet | string {
  if (!isObj(v)) return `sheet ${id} is not an object`;
  if (v.id !== id) return `sheet ${id} has id "${String(v.id)}"`;
  if (!isStr(v.name)) return `sheet ${id}: name`;
  if (!isStr(v.size) || !['A0', 'A1', 'A2', 'A3', 'A4'].includes(v.size)) return `sheet ${id}: size must be A0 to A4`;
  if (v.orientation !== 'landscape' && v.orientation !== 'portrait') return `sheet ${id}: orientation must be landscape or portrait`;
  if (!isObj(v.titleBlock) || !Object.values(v.titleBlock).every(isStr)) return `sheet ${id}: titleBlock must map field ids to strings`;
  if (!Array.isArray(v.views)) return `sheet ${id}: views must be a list`;
  const views: SheetView[] = [];
  for (const w of v.views) {
    if (!isObj(w) || !isStr(w.id) || !isStr(w.name) || !isNum(w.scale) || w.scale <= 0 || !isVec(w.center) || !isVec(w.position) || !isNum(w.width) || w.width <= 0 || !isNum(w.height) || w.height <= 0) return `sheet ${id}: a view needs id, name, scale > 0, center, position, width > 0, height > 0`;
    views.push({ id: w.id, name: w.name, scale: w.scale, center: vec(w.center), position: vec(w.position), width: w.width, height: w.height, label: w.label !== false });
  }
  return { id, name: v.name, size: v.size as Sheet['size'], orientation: v.orientation, titleBlock: { ...(v.titleBlock as Record<string, string>) }, views };
}

/** Validate a raw object of the current version into a Document, or say what is wrong. */
export function validate(raw: Record<string, unknown>): Document | string {
  if (raw.unit !== 'mm') return `unit must be "mm", found ${JSON.stringify(raw.unit)}`;
  if (!isStr(raw.name)) return 'name is missing';
  if (raw.standard !== 'iso' && raw.standard !== 'asme') return 'standard must be "iso" or "asme"';
  if (raw.projection !== 'first' && raw.projection !== 'third') return 'projection must be "first" or "third"';
  if (!isObj(raw.layers) || !Array.isArray(raw.layerOrder)) return 'layers and layerOrder are missing';
  if (!isObj(raw.entities) || !Array.isArray(raw.entityOrder)) return 'entities and entityOrder are missing';
  const dimStyle = validateDimStyle(raw.dimStyle);
  if (typeof dimStyle === 'string') return dimStyle;
  const layers: Record<string, Layer> = {};
  const layerOrder: string[] = [];
  for (const id of raw.layerOrder) {
    if (!isStr(id)) return 'layerOrder must contain ids';
    const l = validateLayer(raw.layers[id], id);
    if (typeof l === 'string') return l;
    layers[id] = l;
    layerOrder.push(id);
  }
  for (const id of Object.keys(raw.layers)) if (!layers[id]) return `layer ${id} is not in layerOrder`;
  if (layerOrder.length === 0) return 'a document needs at least one layer';
  const activeLayer = isStr(raw.activeLayer) && layers[raw.activeLayer] ? raw.activeLayer : layerOrder[0];
  const entities: Record<string, Entity> = {};
  const entityOrder: string[] = [];
  for (const id of raw.entityOrder) {
    if (!isStr(id)) return 'entityOrder must contain ids';
    const e = validateEntity(raw.entities[id], id, layers);
    if (typeof e === 'string') return e;
    entities[id] = e;
    entityOrder.push(id);
  }
  for (const id of Object.keys(raw.entities)) if (!entities[id]) return `entity ${id} is not in entityOrder`;
  if (!isObj(raw.sheets) || !Array.isArray(raw.sheetOrder)) return 'sheets and sheetOrder are missing';
  const sheets: Record<string, Sheet> = {};
  const sheetOrder: string[] = [];
  for (const id of raw.sheetOrder) {
    if (!isStr(id)) return 'sheetOrder must contain ids';
    const s = validateSheet(raw.sheets[id], id);
    if (typeof s === 'string') return s;
    sheets[id] = s;
    sheetOrder.push(id);
  }
  for (const id of Object.keys(raw.sheets)) if (!sheets[id]) return `sheet ${id} is not in sheetOrder`;
  if (!isObj(raw.constraints) || !Array.isArray(raw.constraintOrder)) return 'constraints and constraintOrder are missing';
  const constraints: Record<string, Constraint> = {};
  const constraintOrder: string[] = [];
  for (const id of raw.constraintOrder) {
    if (!isStr(id)) return 'constraintOrder must contain ids';
    const c = validateConstraint(raw.constraints[id], id, entities);
    if (typeof c === 'string') return c;
    constraints[id] = c;
    constraintOrder.push(id);
  }
  for (const id of Object.keys(raw.constraints)) if (!constraints[id]) return `constraint ${id} is not in constraintOrder`;
  if (!isObj(raw.parts) || !Array.isArray(raw.partOrder)) return 'parts and partOrder are missing';
  const parts: Record<string, Part> = {};
  const partOrder: string[] = [];
  for (const id of raw.partOrder) {
    if (!isStr(id)) return 'partOrder must contain ids';
    const p = validatePart(raw.parts[id], id, entities);
    if (typeof p === 'string') return p;
    parts[id] = p;
    partOrder.push(id);
  }
  for (const id of Object.keys(raw.parts)) if (!parts[id]) return `part ${id} is not in partOrder`;
  const doc: Document = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    unit: 'mm',
    name: raw.name,
    standard: raw.standard,
    projection: raw.projection,
    layers,
    layerOrder,
    activeLayer,
    entities,
    entityOrder,
    dimStyle,
    sheets,
    sheetOrder,
    constraints,
    constraintOrder,
    parts,
    partOrder,
  };
  if (isStr(raw.description)) doc.description = raw.description;
  return doc;
}

export function parse(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: { code: 'not-json', message: `The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, hint: 'MechPilot files are plain JSON text. Check that the file was not truncated.' } };
  }
  if (!isObj(raw) || raw.format !== FORMAT_NAME) {
    return { ok: false, error: { code: 'not-mechpilot', message: 'This is not a MechPilot file.', hint: 'A MechPilot file starts with "format": "mechpilot". To bring in a DXF, use File > Import.' } };
  }
  let version = isNum(raw.version) ? raw.version : 0;
  if (version > FORMAT_VERSION) {
    return { ok: false, error: { code: 'newer-version', message: `This file was saved by a newer MechPilot (format ${version}; this app reads up to ${FORMAT_VERSION}).`, hint: 'Update MechPilot to open it.' } };
  }
  const from = version;
  let cur: Record<string, unknown> = raw;
  while (version < FORMAT_VERSION) {
    const m = migrations[version];
    if (!m) return { ok: false, error: { code: 'invalid', message: `No migration from format ${version}.` } };
    cur = m(cur);
    version++;
  }
  const doc = validate(cur);
  if (typeof doc === 'string') return { ok: false, error: { code: 'invalid', message: `The file has a problem: ${doc}.`, hint: 'The file may have been edited by hand. Compare it with docs/file-format.md.' } };
  return from < FORMAT_VERSION ? { ok: true, doc, migratedFrom: from } : { ok: true, doc };
}
