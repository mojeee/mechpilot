// What the assistant's model sees of the drawing: a compact, JSON-friendly summary of the context
// snapshot the renderer sends with every request (product rule 7: the model reads before it
// proposes). Geometry is rounded to 3 decimals here for reading only; proposals always carry the
// model's own full-precision numbers, and get_entities returns the records unrounded.

import type { AssistantContext, Reference } from './types';
import type { Document, EdgeSelector, Entity, FaceSelector, Feature, Id, Part, SketchPlane } from '../doc/types';
import { planeFrame } from '../cad/profile';
import { dimensionValue } from '../draw/annotations';
import { documentBox } from '../doc/document';
import { bulgeToArc, polylineSegments } from '../geometry/flatten';
import { dist, type Vec2 } from '../geometry/vec2';
import materials from '@library/materials/common.json';

/** Round for display to the model: 3 decimals (mm), no "-0". */
export const r3 = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};
/** Angles in radians keep 6 decimals (0.001 rad would be 0.06°). */
export const r6 = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};
const pt = (v: Vec2) => ({ x: r3(v.x), y: r3(v.y) });
const deg = (rad: number) => r3((rad * 180) / Math.PI);

/** Length of a polyline including its arc segments, mm. */
export function polylineLength(e: Entity & { type: 'polyline' }): number {
  let total = 0;
  for (const s of polylineSegments(e)) {
    const arc = bulgeToArc(s.a, s.b, s.bulge);
    if (!arc) total += dist(s.a, s.b);
    else total += Math.abs(4 * Math.atan(s.bulge)) * arc.radius;
  }
  return total;
}

/** Counter-clockwise sweep of an arc from start to end, radians in (0, 2π]. */
export function arcSweep(start: number, end: number): number {
  let s = end - start;
  while (s <= 0) s += Math.PI * 2;
  while (s > Math.PI * 2) s -= Math.PI * 2;
  return s;
}

/** One entity in the compact form the model reads. */
export function compactEntity(e: Entity): Record<string, unknown> {
  const base = { id: e.id, type: e.type, layer: e.layer };
  switch (e.type) {
    case 'line':
      return { ...base, a: pt(e.a), b: pt(e.b), length: r3(dist(e.a, e.b)) };
    case 'circle':
      return { ...base, center: pt(e.center), radius: r3(e.radius), diameter: r3(e.radius * 2) };
    case 'arc':
      return { ...base, center: pt(e.center), radius: r3(e.radius), start: r6(e.start), end: r6(e.end), sweepDeg: deg(arcSweep(e.start, e.end)) };
    case 'polyline':
      return { ...base, points: e.points.map(pt), closed: e.closed, ...(e.bulges?.some((b) => b !== 0) ? { bulges: e.bulges.map(r6) } : {}), length: r3(polylineLength(e)) };
    case 'ellipse':
      return { ...base, center: pt(e.center), major: pt(e.major), ratio: r6(e.ratio), start: r6(e.start), end: r6(e.end) };
    case 'spline':
      return { ...base, degree: e.degree, controlPoints: e.controlPoints.map(pt), closed: e.closed };
    case 'text':
      return { ...base, position: pt(e.position), text: e.text, height: r3(e.height), rotation: r6(e.rotation) };
    case 'dimension': {
      const out: Record<string, unknown> = { ...base, kind: e.kind, a: pt(e.a), b: pt(e.b), position: pt(e.position), rotation: r6(e.rotation), value: r3(dimensionValue(e)) };
      if (e.center) out.center = pt(e.center);
      if (e.tolerance) out.tolerance = e.tolerance;
      if (e.driving !== undefined) out.driving = e.driving;
      if (e.text !== undefined) out.text = e.text;
      if (e.prefix !== undefined) out.prefix = e.prefix;
      if (e.suffix !== undefined) out.suffix = e.suffix;
      if (e.decimals !== undefined) out.decimals = e.decimals;
      return out;
    }
    case 'note':
      return { ...base, position: pt(e.position), text: e.text, height: r3(e.height), ...(e.leader ? { leader: e.leader.map(pt) } : {}) };
    case 'balloon':
      return { ...base, position: pt(e.position), text: e.text, leader: pt(e.leader) };
    case 'surface':
      return { ...base, position: pt(e.position), removal: e.removal, ...(e.ra !== undefined ? { ra: e.ra } : {}), ...(e.text ? { text: e.text } : {}) };
    case 'gdt':
      return { ...base, position: pt(e.position), characteristic: e.characteristic, tolerance: e.tolerance, datums: e.datums };
    case 'datum':
      return { ...base, position: pt(e.position), label: e.label };
  }
}

function compactFeature(f: Feature): Record<string, unknown> {
  const { id, name, kind } = f;
  const base: Record<string, unknown> = { id, name, kind, ...(f.suppressed ? { suppressed: true } : {}) };
  switch (f.kind) {
    case 'sketch':
      return { ...base, plane: f.plane, offset: f.offset, entities: f.entities };
    case 'extrude':
      return { ...base, sketch: f.sketch, distance: f.distance, direction: f.direction, op: f.op };
    case 'revolve':
      return { ...base, sketch: f.sketch, axis: { a: pt(f.axis.a), b: pt(f.axis.b) }, angle: f.angle, op: f.op };
    case 'hole':
      return { ...base, sketch: f.sketch, spec: f.spec, depth: f.depth };
    case 'fillet':
      return { ...base, edges: f.edges, radius: f.radius };
    case 'chamfer':
      return { ...base, edges: f.edges, distance: f.distance };
    case 'shell':
      return { ...base, thickness: f.thickness, faces: f.faces };
    case 'mirror':
      return { ...base, plane: f.plane, offset: f.offset };
    case 'pattern':
      return f.mode === 'linear' ? { ...base, mode: f.mode, counts: f.counts, spacing: f.spacing, axes: f.axes } : { ...base, mode: f.mode, axis: f.axis, count: f.count, angle: f.angle };
    case 'import':
      // The STEP data itself is never sent: it is large and the model cannot use it.
      return { ...base, format: f.format, sourceName: f.sourceName };
  }
}

interface MaterialRow {
  id: string;
  name: string;
  density: number;
  densitySource: string;
}
export const MATERIALS: MaterialRow[] = ((materials as { materials?: unknown }).materials as MaterialRow[] | undefined) ?? [];

function compactPart(p: Part, ctx: AssistantContext): Record<string, unknown> {
  const build = ctx.activePart === p.id ? ctx.build : null;
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    ...(p.material ? { material: p.material } : {}),
    features: p.features.map((f) => ({ ...compactFeature(f), ...(build?.status[f.id] ? { status: build.status[f.id] } : {}) })),
  };
  if (build) {
    const props = build.properties;
    out.build = {
      note: 'measured by the kernel on the last build of this part',
      errors: build.errors,
      ...(props
        ? {
            volumeMm3: r3(props.volume),
            areaMm2: r3(props.area),
            centerOfMass: props.centerOfMass.map(r3),
            bbox: { min: props.bbox.min.map(r3), max: props.bbox.max.map(r3), size: props.bbox.max.map((v, i) => r3(v - props.bbox.min[i])) },
          }
        : {}),
    };
    const mat = p.material ? MATERIALS.find((m) => m.id === p.material) : undefined;
    if (props && mat) (out.build as Record<string, unknown>).massKg = { value: r3(props.volume * 1e-9 * mat.density), density: mat.density, densitySource: mat.densitySource };
  } else out.build = 'not built in this snapshot (only the active part is built)';
  return out;
}

const AXIS_DIRS: { axis: 0 | 1 | 2; plane: SketchPlane; pos: FaceSelector & { kind: 'normal' }; neg: FaceSelector & { kind: 'normal' } }[] = [
  { axis: 0, plane: 'YZ', pos: { kind: 'normal', direction: 'X+' }, neg: { kind: 'normal', direction: 'X-' } },
  { axis: 1, plane: 'XZ', pos: { kind: 'normal', direction: 'Y+' }, neg: { kind: 'normal', direction: 'Y-' } },
  { axis: 2, plane: 'XY', pos: { kind: 'normal', direction: 'Z+' }, neg: { kind: 'normal', direction: 'Z-' } },
];

/**
 * How a face clicked in 3D maps to the feature selectors (only for faces whose normal is along a
 * principal axis): the edges of that face are an `inPlane` EdgeSelector, and the face itself a
 * `normal` FaceSelector. The offset is measured along the plane's own normal (XZ points to −Y,
 * shared/cad/profile.ts planeFrame), so a face at y = 25 is inPlane XZ offset −25.
 */
export function faceSelectors(center: [number, number, number], normal: [number, number, number]): { edges: EdgeSelector; face: FaceSelector; facePlane: FaceSelector } | null {
  for (const d of AXIS_DIRS) {
    const n = normal[d.axis];
    const others = [0, 1, 2].filter((i) => i !== d.axis).map((i) => Math.abs(normal[i]));
    if (Math.abs(n) > 0.999 && others.every((o) => o < 0.01)) {
      const f = planeFrame(d.plane, 0);
      const offset = r3(center[0] * f.normal[0] + center[1] * f.normal[1] + center[2] * f.normal[2]);
      return { edges: { kind: 'inPlane', plane: d.plane, offset }, face: n > 0 ? d.pos : d.neg, facePlane: { kind: 'inPlane', plane: d.plane, offset } };
    }
  }
  return null;
}

/** The references the user attached, with what the model needs to use them. */
export function describeReferences(refs: Reference[], doc: Document): Record<string, unknown>[] {
  return refs.map((r) => {
    switch (r.kind) {
      case 'entities':
        return { kind: r.kind, label: r.label, ids: r.ids, entities: r.ids.map((id) => doc.entities[id]).filter((e): e is Entity => !!e).slice(0, 50).map(compactEntity) };
      case 'part': {
        const p = doc.parts[r.partId];
        return { kind: r.kind, label: r.label, partId: r.partId, ...(p ? { name: p.name } : { missing: true }) };
      }
      case 'feature': {
        const f = doc.parts[r.partId]?.features.find((x) => x.id === r.featureId);
        return { kind: r.kind, label: r.label, partId: r.partId, featureId: r.featureId, ...(f ? { feature: compactFeature(f) } : { missing: true }) };
      }
      case 'face': {
        const sel = faceSelectors(r.center, r.normal);
        return {
          kind: r.kind,
          label: r.label,
          partId: r.partId,
          faceId: r.faceId,
          center: r.center.map(r3),
          normal: r.normal.map(r6),
          areaMm2: r3(r.area),
          measured: 'center, normal and area were measured on the built mesh',
          ...(sel ? { edgesOfThisFace: sel.edges, thisFaceByNormal: sel.face, thisFaceByPlane: sel.facePlane } : { note: 'the face is not perpendicular to a principal axis; no plane selector matches it' }),
        };
      }
      case 'point':
        return { kind: r.kind, label: r.label, partId: r.partId, at: r.at.map(r3) };
    }
  });
}

export interface SummaryOptions {
  /** Entities listed (from `offset`); the rest are counted. */
  maxEntities?: number;
  offset?: number;
  /** Only entities on this layer. */
  layer?: Id;
}

/** The read_model answer: everything the model needs to reason about the drawing. */
export function summarizeContext(ctx: AssistantContext, opts: SummaryOptions = {}): Record<string, unknown> {
  const { doc } = ctx;
  const max = opts.maxEntities ?? 400;
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const ids = doc.entityOrder.filter((id) => doc.entities[id] && (!opts.layer || doc.entities[id].layer === opts.layer));
  const shown = ids.slice(offset, offset + max);
  const byType: Record<string, number> = {};
  for (const id of doc.entityOrder) {
    const e = doc.entities[id];
    if (e) byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  const box = documentBox(doc, false);
  const out: Record<string, unknown> = {
    units: 'mm (angles of entities and constraints in radians; feature angles in degrees)',
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    standard: doc.standard,
    projection: doc.projection,
    activeLayer: doc.activeLayer,
    layers: doc.layerOrder.map((id) => doc.layers[id]).filter(Boolean).map((l) => ({ id: l.id, name: l.name, lineType: l.lineType, lineWidth: l.lineWidth, ...(l.locked ? { locked: true } : {}), ...(l.visible ? {} : { hidden: true }) })),
    dimStyle: { textHeight: doc.dimStyle.textHeight, decimals: doc.dimStyle.decimals, annotationScale: doc.dimStyle.annotationScale },
    entityCount: doc.entityOrder.length,
    entityTypes: byType,
    bounds: box ? { min: pt(box.min), max: pt(box.max), size: { x: r3(box.max.x - box.min.x), y: r3(box.max.y - box.min.y) } } : null,
    entities: shown.map((id) => compactEntity(doc.entities[id])),
  };
  if (shown.length < ids.length) out.entitiesShown = `${offset} to ${offset + shown.length - 1} of ${ids.length}; call read_model with offset ${offset + shown.length} for more`;
  out.constraints = doc.constraintOrder.map((id) => doc.constraints[id]).filter(Boolean).map((c) => (c.kind === 'angle' ? { ...c, valueDeg: deg(c.value) } : c));
  out.parts = doc.partOrder.map((id) => doc.parts[id]).filter(Boolean).map((p) => compactPart(p, ctx));
  out.sheets = doc.sheetOrder.map((id) => doc.sheets[id]).filter(Boolean).map((s) => ({
    id: s.id,
    name: s.name,
    size: s.size,
    orientation: s.orientation,
    titleBlock: s.titleBlock,
    views: s.views.map((v) => ({ id: v.id, name: v.name, scale: v.scale, center: pt(v.center), position: pt(v.position), width: r3(v.width), height: r3(v.height) })),
  }));
  out.selection = ctx.selection.filter((id) => doc.entities[id]);
  out.activePart = ctx.activePart;
  out.activeSheet = ctx.activeSheet;
  out.sketchSolver = ctx.sketch;
  return out;
}

/** The selected entities in compact form (always shown in full, even when the list is cut). */
export const selectedEntities = (ctx: AssistantContext): Record<string, unknown>[] =>
  ctx.selection.map((id) => ctx.doc.entities[id]).filter((e): e is Entity => !!e).slice(0, 200).map(compactEntity);
