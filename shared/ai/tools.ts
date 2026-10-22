// The assistant's read-only tools, answered from the request's context snapshot with pure code
// from /shared (no renderer round trip, no kernel). The model looks before it proposes
// (product rule 5) and every number it quotes can carry a source (product rule 7): measured on
// this model, or a library file and entry. Tool results are JSON text for the model; the log
// summaries are for the user and go through t().
//
// The only tool that changes anything is `propose` (shared/ai/proposal.ts): it never edits the
// document, it returns a validated Proposal the user accepts or rejects.

import type { AssistantContext, Claim } from './types';
import type { DimensionEntity, Entity, Id, PointRef } from '../doc/types';
import { buildProfile, type ProfileResult } from '../cad/profile';
import { dimensionValue } from '../draw/annotations';
import { fitDeviations, parseFitClass } from '../fits';
import { dist, type Vec2 } from '../geometry/vec2';
import { t } from '../i18n';
import { arcSweep, compactEntity, MATERIALS, polylineLength, r3, r6, summarizeContext } from './summary';
import iso273 from '@library/holes/iso-273.json';
import tapDrills from '@library/holes/tap-drills.json';
import iso286 from '@library/fits/iso-286.json';
import iso5457 from '@library/sheets/iso-5457.json';
import iso5455 from '@library/scales/iso-5455.json';
import iso7200 from '@library/title-blocks/iso-7200.json';

export type JsonSchema = Record<string, unknown>;

/** A function the model may call; `parameters` is a JSON Schema for an object. */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolOutcome {
  /** JSON text for the model. */
  content: string;
  isError: boolean;
  /** One line for the chat's "what the assistant looked at" log (translated). */
  summary: string;
  /** A sourced fact the tool established (a measurement, a library value), shown with the reply. */
  claim?: Claim;
}

const point: JsonSchema = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };
const pointRef: JsonSchema = {
  type: 'object',
  description: 'A point of an entity: a/b of a line, center/start/end of an arc, center of a circle, or a polyline vertex index.',
  properties: { entity: { type: 'string' }, point: { description: '"a", "b", "center", "start", "end" or a vertex index (number)' } },
  required: ['entity', 'point'],
};

export const TOOL_SPECS: AiToolSpec[] = [
  {
    name: 'read_model',
    description:
      'Read the drawing: layers, entities (geometry rounded to 3 decimals), dimensions with their measured values and tolerances, constraints, parts with feature trees and build status, sheets, selection. Long entity lists are paged: pass offset to continue, or layer to filter.',
    parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, layer: { type: 'string', description: 'Only entities on this layer id.' } } },
  },
  {
    name: 'get_entities',
    description: 'Full, unrounded records of entities by id (use before updateEntities: an update replaces the whole entity).',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 200 } }, required: ['ids'] },
  },
  {
    name: 'measure',
    description:
      'Measure on this model. Either the distance between two points (a and b, each {x,y} or a point of an entity {entity, point}), or one entity (length, radius, sweep, dimension value), or the area of the closed loop(s) formed by several entities, or the built part (volume, bounding box). Results are measured values you may quote with source kind "measured".',
    parameters: {
      type: 'object',
      properties: {
        a: { anyOf: [point, pointRef] },
        b: { anyOf: [point, pointRef] },
        entity: { type: 'string' },
        entities: { type: 'array', items: { type: 'string' } },
        part: { type: 'string', description: 'A part id: its last build properties.' },
      },
    },
  },
  {
    name: 'library',
    description:
      "Look up MechPilot's standards library. topic: clearance (ISO 273 clearance holes; query = thread like M6), tapDrill (ISO 2306 tap drills; query = thread), fit (ISO 286 deviations; query = class like H7, or a pair like H7/g6, with size = nominal mm), material (densities; query = name or id), sheet (ISO 5457 sizes; query = A0..A4), scale (ISO 5455 recommended scales), titleBlock (ISO 7200 field ids). Every answer carries its source file and entry: quote it in claims.",
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['clearance', 'tapDrill', 'fit', 'material', 'sheet', 'scale', 'titleBlock'] },
        query: { type: 'string' },
        size: { type: 'number', description: 'Nominal size in mm (fits).' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'check',
    description:
      'Check before proposing: whether entities form closed profile loops (for a sketch feature), the sketch features of a part, ISO 286 fit classes on dimensions, and the constraint solver status and build errors of the snapshot.',
    parameters: { type: 'object', properties: { entities: { type: 'array', items: { type: 'string' } }, part: { type: 'string' } } },
  },
  {
    name: 'propose',
    description:
      'The only way to change the drawing. Proposes a list of commands (see the system prompt) as a preview the user accepts or rejects; nothing changes until they accept. The proposal is dry-run and validated; on an error you get the reason and should fix and propose again. Several proposals in one reply are applied in order: a later one may use ids created by an earlier one.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, e.g. "Plate 120 × 80 with four M6 clearance holes".' },
        summary: { type: 'string', description: 'One or two sentences: what changes and why.' },
        commands: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] }, minItems: 1 },
        claims: {
          type: 'array',
          description: 'Every number or rule you rely on, with its source.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              source: {
                type: 'object',
                description: '{kind:"measured", what} | {kind:"standard", standard, clause?} | {kind:"library", file, entry} | {kind:"suggestion"}',
                properties: { kind: { type: 'string', enum: ['measured', 'standard', 'library', 'suggestion'] }, what: { type: 'string' }, standard: { type: 'string' }, clause: { type: 'string' }, file: { type: 'string' }, entry: { type: 'string' } },
                required: ['kind'],
              },
            },
            required: ['text', 'source'],
          },
        },
        touches: { type: 'object', properties: { entities: { type: 'array', items: { type: 'string' } }, parts: { type: 'array', items: { type: 'string' } } } },
        then: {
          type: 'object',
          description: 'Optional action after the user accepts: {kind:"exportPdf"} | {kind:"openPart", partId} | {kind:"openSheet", sheetId}.',
          properties: { kind: { type: 'string', enum: ['exportPdf', 'openPart', 'openSheet'] }, partId: { type: 'string' }, sheetId: { type: 'string' } },
          required: ['kind'],
        },
      },
      required: ['title', 'summary', 'commands'],
    },
  },
];

/* ---------- helpers ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const json = (v: unknown): string => JSON.stringify(v);
const ok = (value: unknown, summary: string, claim?: Claim): ToolOutcome => ({ content: json(value), isError: false, summary, ...(claim ? { claim } : {}) });
const bad = (error: string, summary: string): ToolOutcome => ({ content: json({ error }), isError: true, summary });

/** A point of an entity in model coordinates, or null. */
export function pointOf(e: Entity, p: PointRef['point']): Vec2 | null {
  if (typeof p === 'number') return e.type === 'polyline' ? (e.points[p] ?? null) : null;
  switch (e.type) {
    case 'line':
      return p === 'a' ? e.a : p === 'b' ? e.b : null;
    case 'circle':
      return p === 'center' ? e.center : null;
    case 'arc':
      if (p === 'center') return e.center;
      if (p === 'start') return { x: e.center.x + e.radius * Math.cos(e.start), y: e.center.y + e.radius * Math.sin(e.start) };
      if (p === 'end') return { x: e.center.x + e.radius * Math.cos(e.end), y: e.center.y + e.radius * Math.sin(e.end) };
      return null;
    case 'ellipse':
      return p === 'center' ? e.center : null;
    case 'dimension':
      return p === 'a' ? e.a : p === 'b' ? e.b : p === 'center' ? (e.center ?? null) : null;
    default:
      return null;
  }
}

function resolvePoint(ctx: AssistantContext, v: unknown): Vec2 | string {
  if (isObj(v) && isNum(v.x) && isNum(v.y)) return { x: v.x, y: v.y };
  if (isObj(v) && typeof v.entity === 'string') {
    const e = ctx.doc.entities[v.entity];
    if (!e) return `entity ${v.entity} does not exist`;
    const which = typeof v.point === 'number' ? v.point : String(v.point ?? '');
    const p = pointOf(e, which as PointRef['point']);
    return p ?? `a ${e.type} has no point "${String(v.point)}"`;
  }
  return 'a point is {x, y} or {entity, point}';
}

/** Closed-loop check of a set of entities, as the kernel would see a sketch of them. */
export function profileOf(ctx: AssistantContext, ids: Id[], name = 'check'): ProfileResult {
  return buildProfile(ctx.doc, { name, entities: ids });
}

function profileSummary(r: ProfileResult): Record<string, unknown> {
  if (!r.ok) return { closed: false, problem: r.error.message, ...(r.error.at ? { at: { x: r3(r.error.at.x), y: r3(r.error.at.y) } } : {}), entities: r.error.entities };
  const regions = r.profile.regions.map((g) => {
    const outer = Math.abs(g.outer.area);
    const holes = g.holes.reduce((s, h) => s + Math.abs(h.area), 0);
    return { outerLoop: g.outer.entities, holes: g.holes.map((h) => h.entities), areaMm2: r3(outer - holes) };
  });
  return { closed: true, loops: r.profile.loops.length, regions, totalAreaMm2: r3(regions.reduce((s, g) => s + g.areaMm2, 0)) };
}

/* ---------- read_model, get_entities ---------- */

function readModel(ctx: AssistantContext, args: Record<string, unknown>): ToolOutcome {
  const offset = isNum(args.offset) ? args.offset : 0;
  const layer = typeof args.layer === 'string' && args.layer ? args.layer : undefined;
  return ok(summarizeContext(ctx, { maxEntities: 400, offset, layer }), t('Read the model ({n} entities, {p} parts, {s} sheets)', { n: ctx.doc.entityOrder.length, p: ctx.doc.partOrder.length, s: ctx.doc.sheetOrder.length }));
}

function getEntities(ctx: AssistantContext, args: Record<string, unknown>): ToolOutcome {
  const ids = strList(args.ids).slice(0, 200);
  const found = ids.map((id) => ctx.doc.entities[id]).filter((e): e is Entity => !!e);
  const missing = ids.filter((id) => !ctx.doc.entities[id]);
  return ok({ entities: found, ...(missing.length ? { missing } : {}) }, t('Looked at {n} entities', { n: found.length }));
}

/* ---------- measure ---------- */

function measureEntity(e: Entity): Record<string, unknown> {
  switch (e.type) {
    case 'line':
      return { length: r3(dist(e.a, e.b)), angleDeg: r3((Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180) / Math.PI) };
    case 'circle':
      return { radius: r3(e.radius), diameter: r3(2 * e.radius), circumference: r3(2 * Math.PI * e.radius), areaMm2: r3(Math.PI * e.radius * e.radius) };
    case 'arc': {
      const sweep = arcSweep(e.start, e.end);
      return { radius: r3(e.radius), sweepDeg: r3((sweep * 180) / Math.PI), length: r3(sweep * e.radius) };
    }
    case 'polyline':
      return { length: r3(polylineLength(e)), vertices: e.points.length, closed: e.closed };
    case 'dimension':
      return { kind: e.kind, value: r3(dimensionValue(e as DimensionEntity)), unit: e.kind === 'angular' ? 'deg' : 'mm' };
    default:
      return { note: `a ${e.type} has no length to measure` };
  }
}

/** A measurement as one line for the user, e.g. "length 120 mm, angle 0°". */
function measuredText(res: Record<string, unknown>): string {
  const label: Record<string, [string, string]> = {
    length: [t('length'), 'mm'],
    radius: [t('radius'), 'mm'],
    diameter: [t('diameter'), 'mm'],
    sweepDeg: [t('sweep'), '°'],
    areaMm2: [t('area'), 'mm²'],
    value: [t('value'), res.unit === 'deg' ? '°' : 'mm'],
  };
  return Object.entries(res)
    .filter(([k, v]) => label[k] && typeof v === 'number')
    .map(([k, v]) => `${label[k][0]} ${String(v)} ${label[k][1]}`)
    .join(', ');
}

function measure(ctx: AssistantContext, args: Record<string, unknown>): ToolOutcome {
  if (args.a !== undefined || args.b !== undefined) {
    const a = resolvePoint(ctx, args.a);
    const b = resolvePoint(ctx, args.b);
    if (typeof a === 'string' || typeof b === 'string') return bad(typeof a === 'string' ? `a: ${a}` : `b: ${String(b)}`, t('Could not measure'));
    const what = 'distance between two points';
    return ok({ a: { x: r3(a.x), y: r3(a.y) }, b: { x: r3(b.x), y: r3(b.y) }, distance: r3(dist(a, b)), dx: r3(b.x - a.x), dy: r3(b.y - a.y), angleDeg: r3((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI), source: { kind: 'measured', what } }, t('Measured a distance: {d} mm', { d: r3(dist(a, b)) }), { text: t('Distance {d} mm', { d: r3(dist(a, b)) }), source: { kind: 'measured', what: t('between ({ax}, {ay}) and ({bx}, {by})', { ax: r3(a.x), ay: r3(a.y), bx: r3(b.x), by: r3(b.y) }) } });
  }
  if (typeof args.entity === 'string') {
    const e = ctx.doc.entities[args.entity];
    if (!e) return bad(`entity ${args.entity} does not exist`, t('Could not measure'));
    const res = measureEntity(e);
    if (e.type === 'polyline' && e.closed) Object.assign(res, { profile: profileSummary(profileOf(ctx, [e.id])) });
    return ok({ entity: compactEntity(e), ...res, source: { kind: 'measured', what: `${e.type} ${e.id}` } }, t('Measured {what}', { what: `${e.type} ${e.id}` }), { text: measuredText(res), source: { kind: 'measured', what: `${e.type} ${e.id}` } });
  }
  const ids = strList(args.entities);
  if (ids.length) {
    const missing = ids.filter((id) => !ctx.doc.entities[id]);
    if (missing.length) return bad(`entities do not exist: ${missing.join(', ')}`, t('Could not measure'));
    return ok({ ...profileSummary(profileOf(ctx, ids)), source: { kind: 'measured', what: `closed loops of ${ids.length} entities` } }, t('Measured the area of {n} entities', { n: ids.length }));
  }
  if (typeof args.part === 'string') {
    const part = ctx.doc.parts[args.part];
    if (!part) return bad(`part ${args.part} does not exist`, t('Could not measure'));
    if (ctx.activePart !== part.id || !ctx.build) return bad(`part ${args.part} is not built in this snapshot; only the active part (${ctx.activePart ?? 'none'}) has build results`, t('Could not measure'));
    const props = ctx.build.properties;
    if (!props) return bad('the part did not build; see check for the errors', t('Could not measure'));
    const mat = part.material ? MATERIALS.find((m) => m.id === part.material) : undefined;
    return ok(
      {
        volumeMm3: r3(props.volume),
        areaMm2: r3(props.area),
        centerOfMass: props.centerOfMass.map(r3),
        bbox: { min: props.bbox.min.map(r3), max: props.bbox.max.map(r3), size: props.bbox.max.map((v, i) => r3(v - props.bbox.min[i])) },
        ...(mat ? { massKg: r3(props.volume * 1e-9 * mat.density), densitySource: mat.densitySource } : {}),
        source: { kind: 'measured', what: `the last build of part ${part.name}` },
      },
      t('Measured part {name}', { name: part.name }),
    );
  }
  return bad('pass a and b, entity, entities or part', t('Could not measure'));
}

/* ---------- library ---------- */

interface Row {
  [k: string]: unknown;
}
const rows = (lib: unknown, key: string): Row[] => (isObj(lib) && Array.isArray(lib[key]) ? (lib[key] as Row[]) : []);
const sameThread = (a: unknown, b: string) => typeof a === 'string' && a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase();
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const L273 = iso273 as unknown as Row;
const LTAP = tapDrills as unknown as Row;
const L286 = iso286 as unknown as Row;
const L5457 = iso5457 as unknown as Row;
const L5455 = iso5455 as unknown as Row;
const L7200 = iso7200 as unknown as Row;

/** The threads the library has clearance holes for (ISO 273) and tap drills for (ISO 2306). */
export const CLEARANCE_THREADS: string[] = rows(L273, 'holes').map((r) => str(r.thread));
export const TAP_THREADS: string[] = rows(LTAP, 'threads').map((r) => str(r.thread));

function library(args: Record<string, unknown>): ToolOutcome {
  const topic = String(args.topic ?? '');
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const looked = t('Looked up {what} in the library', { what: query ? `${topic} ${query}` : topic });
  switch (topic) {
    case 'clearance': {
      const file = 'library/holes/iso-273.json';
      if (!query) return ok({ file, source: L273.holesSource, threads: CLEARANCE_THREADS, defaultSeries: L273.defaultSeries }, looked);
      const row = rows(L273, 'holes').find((r) => sameThread(r.thread, query));
      if (!row) return bad(`no clearance hole for "${query}" in ${file}; threads: ${CLEARANCE_THREADS.join(', ')}`, looked);
      return ok({ file, entry: `${str(row.thread)}`, thread: row.thread, fine: row.fine, medium: row.medium, coarse: row.coarse, defaultSeries: L273.defaultSeries, toleranceClasses: L273.toleranceClasses, source: L273.holesSource, claimSource: { kind: 'library', file, entry: `${str(row.thread)} clearance hole` } }, looked, { text: t('Clearance hole for {thread} (ISO 273): fine {fine}, medium {medium}, coarse {coarse} mm', { thread: str(row.thread), fine: String(row.fine), medium: String(row.medium), coarse: String(row.coarse) }), source: { kind: 'library', file, entry: `${str(row.thread)} clearance hole` } });
    }
    case 'tapDrill': {
      const file = 'library/holes/tap-drills.json';
      if (!query) return ok({ file, source: LTAP.drillSource, threads: TAP_THREADS }, looked);
      const row = rows(LTAP, 'threads').find((r) => sameThread(r.thread, query));
      if (!row) return bad(`no tap drill for "${query}" in ${file}; threads: ${TAP_THREADS.join(', ')}`, looked);
      return ok({ file, thread: row.thread, pitch: row.pitch, drill: row.drill, source: LTAP.drillSource, pitchSource: LTAP.pitchSource, claimSource: { kind: 'library', file, entry: `${str(row.thread)} tap drill` } }, looked, { text: t('Tap drill for {thread}: {drill} mm (pitch {pitch} mm)', { thread: str(row.thread), drill: String(row.drill), pitch: String(row.pitch) }), source: { kind: 'library', file, entry: `${str(row.thread)} tap drill` } });
    }
    case 'fit': {
      const file = 'library/fits/iso-286.json';
      const size = isNum(args.size) ? args.size : NaN;
      if (!query || !(size > 0)) return bad('a fit lookup needs query (e.g. H7 or H7/g6) and size (nominal mm)', looked);
      const classes = query.split('/').map((s) => s.trim()).filter(Boolean);
      const out: Record<string, unknown> = { file, nominal: size, source: L286.source };
      const devs: { cls: string; upper: number; lower: number; hole: boolean }[] = [];
      for (const cls of classes) {
        const fc = parseFitClass(cls);
        const d = fitDeviations(cls, size);
        if (!fc || !d) return bad(`${cls} at ${size} mm is not in MechPilot's ISO 286 data (${file}); do not guess its deviations`, looked);
        devs.push({ cls, upper: r6(d.upper), lower: r6(d.lower), hole: fc.hole });
      }
      out.classes = devs.map((d) => ({ class: d.cls, kind: d.hole ? 'hole' : 'shaft', upperDeviationMm: d.upper, lowerDeviationMm: d.lower, max: r6(size + d.upper), min: r6(size + d.lower) }));
      const hole = devs.find((d) => d.hole);
      const shaft = devs.find((d) => !d.hole);
      if (hole && shaft) {
        const maxClearance = r6(hole.upper - shaft.lower);
        const minClearance = r6(hole.lower - shaft.upper);
        out.fit = { maxClearanceMm: maxClearance, minClearanceMm: minClearance, type: minClearance >= 0 ? 'clearance' : maxClearance <= 0 ? 'interference' : 'transition' };
      }
      out.claimSource = { kind: 'library', file, entry: `${query} at ${size} mm` };
      const fmtDev = (v: number) => (v > 0 ? '+' : '') + String(v);
      const text = devs.map((d) => `${d.cls} ${fmtDev(d.upper)}/${fmtDev(d.lower)}`).join(', ');
      return ok(out, looked, { text: t('ISO 286 deviations at {size} mm: {list} mm', { size, list: text }), source: { kind: 'library', file, entry: `${query} at ${size} mm` } });
    }
    case 'material': {
      const file = 'library/materials/common.json';
      const q = query.toLowerCase();
      const found = MATERIALS.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
      if (!found.length) return bad(`no material matches "${query}"; ids: ${MATERIALS.map((m) => m.id).join(', ')}`, looked);
      return ok({ file, materials: found.slice(0, 20).map((m) => ({ id: m.id, name: m.name, densityKgM3: m.density, source: m.densitySource, claimSource: { kind: 'library', file, entry: m.id } })) }, looked);
    }
    case 'sheet': {
      const file = 'library/sheets/iso-5457.json';
      const sizes = rows(L5457, 'sizes').map((s) => ({ id: s.id, width: s.width, height: s.height, orientation: s.orientation, frameMargins: s.frameMargins }));
      const pick = query ? sizes.filter((s) => String(s.id).toUpperCase() === query.toUpperCase()) : sizes;
      if (!pick.length) return bad(`no sheet size "${query}"; sizes: A0 to A4`, looked);
      return ok({ file, source: L5457.sizesSource, note: 'width and height in mm as the sheet is used (A0 to A3 landscape, A4 portrait)', sizes: pick, claimSource: { kind: 'library', file, entry: query || 'sizes' } }, looked);
    }
    case 'scale': {
      const file = 'library/scales/iso-5455.json';
      return ok({ file, source: L5455.scalesSource, scales: rows(L5455, 'scales').map((s) => ({ id: s.id, ratio: s.ratio })), claimSource: { kind: 'library', file, entry: 'recommended scales' } }, looked);
    }
    case 'titleBlock': {
      const file = 'library/title-blocks/iso-7200.json';
      return ok({ file, source: L7200.fieldsSource, fields: rows(L7200, 'fields').map((f) => ({ id: f.id, name: f.name, mandatory: f.mandatory, maxChars: f.maxChars })), claimSource: { kind: 'library', file, entry: 'fields' } }, looked);
    }
    default:
      return bad(`unknown topic "${topic}"`, looked);
  }
}

/* ---------- check ---------- */

function check(ctx: AssistantContext, args: Record<string, unknown>): ToolOutcome {
  const out: Record<string, unknown> = {};
  const ids = strList(args.entities);
  if (ids.length) {
    const missing = ids.filter((id) => !ctx.doc.entities[id]);
    out.profile = missing.length ? { closed: false, problem: `entities do not exist: ${missing.join(', ')}` } : profileSummary(profileOf(ctx, ids));
  }
  if (typeof args.part === 'string') {
    const part = ctx.doc.parts[args.part];
    if (!part) return bad(`part ${args.part} does not exist`, t('Checked the drawing'));
    out.sketches = part.features.flatMap((f) => (f.kind === 'sketch' ? [{ feature: f.id, name: f.name, ...profileSummary(buildProfile(ctx.doc, f)) }] : []));
    if (ctx.activePart === part.id && ctx.build) out.build = { status: ctx.build.status, errors: ctx.build.errors };
  }
  // ISO 286 classes written on dimensions that MechPilot's data does not have (product rule 6).
  const fits: Record<string, unknown>[] = [];
  for (const id of ctx.doc.entityOrder) {
    const e = ctx.doc.entities[id];
    if (e?.type !== 'dimension' || e.tolerance?.kind !== 'fit') continue;
    const nominal = dimensionValue(e);
    if (!fitDeviations(e.tolerance.cls, nominal)) fits.push({ entity: id, class: e.tolerance.cls, nominal: r3(nominal), problem: 'not in ISO 286 data at this size' });
  }
  out.fitProblems = fits;
  out.sketchSolver = ctx.sketch ?? 'no solver result in this snapshot';
  if (ctx.build && !args.part) out.activePartBuild = { part: ctx.activePart, status: ctx.build.status, errors: ctx.build.errors };
  return ok(out, t('Checked the drawing'));
}

/** Run one read-only tool. `propose` is handled by the assistant loop (it needs the proposal state). */
export function runReadTool(name: string, args: Record<string, unknown>, ctx: AssistantContext): ToolOutcome {
  try {
    switch (name) {
      case 'read_model':
        return readModel(ctx, args);
      case 'get_entities':
        return getEntities(ctx, args);
      case 'measure':
        return measure(ctx, args);
      case 'library':
        return library(args);
      case 'check':
        return check(ctx, args);
      default:
        return bad(`unknown tool "${name}"`, t('Unknown tool {name}', { name }));
    }
  } catch (e) {
    return bad(`the tool failed: ${e instanceof Error ? e.message : String(e)}`, t('A tool failed: {name}', { name }));
  }
}
