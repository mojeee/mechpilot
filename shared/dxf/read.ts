// DXF import: ASCII DXF text (any version from R12 on) as a MechPilot document plus plain-language
// warnings for whatever could not be kept (product rule 5). Lengths are converted to mm from
// $INSUNITS; numbers are parsed with Number() and never rounded (product rule 1).
// Group codes: DXF Reference (Autodesk), sections HEADER, TABLES, BLOCKS, ENTITIES.

import { DEFAULT_DIM_STYLE, defaultLayers } from '../doc/document';
import { FORMAT_NAME, FORMAT_VERSION, type Document, type Entity, type Id, type Layer, type SplineEntity } from '../doc/types';
import { interpolateSpline } from '../geometry/flatten';
import { normAngle, type Vec2 } from '../geometry/vec2';
import { randomId, type IdGen } from '../ids';
import { t } from '../i18n';
import {
  INSUNITS_MM,
  INSUNITS_TO_MM,
  aciToRgb,
  decodeDxfText,
  insunitsName,
  isoLineTypeFor,
  rgbToHex,
  snapLineWidth,
  stripMtext,
  type DxfWarning,
} from './codes';

export interface DxfReadError {
  code: string;
  message: string;
  hint?: string;
}
export type DxfReadResult = { ok: true; doc: Document; warnings: DxfWarning[] } | { ok: false; error: DxfReadError };

/** Nested blocks deeper than this are not expanded (also stops blocks that insert themselves). */
export const MAX_BLOCK_DEPTH = 8;

// ---------------------------------------------------------------------------------------------
// Tags and records
// ---------------------------------------------------------------------------------------------

interface Tag {
  code: number;
  value: string;
}

/** Group code / value pairs. Stops at the first line that is not a group code (a truncated or
 *  damaged file keeps what came before). 999 comments are dropped. */
function tokenize(text: string): Tag[] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: Tag[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = lines[i].trim();
    if (!/^-?\d+$/.test(c)) break;
    const code = Number(c);
    if (code === 999) continue;
    // Text values (1, 3) keep their spaces; names and numbers are trimmed.
    const raw = lines[i + 1];
    out.push({ code, value: code === 1 || code === 3 ? raw.replace(/[ \t]+$/, '') : raw.trim() });
  }
  return out;
}

/** One object of a section: from a code-0 tag to the next. */
class Rec {
  constructor(
    readonly type: string,
    readonly tags: Tag[],
  ) {}
  str(code: number): string | undefined {
    return this.tags.find((g) => g.code === code)?.value;
  }
  num(code: number, fallback: number): number {
    const v = this.str(code);
    if (v === undefined || v.trim() === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  has(code: number): boolean {
    return this.tags.some((g) => g.code === code);
  }
  /** Repeated points (e.g. 10/20 vertices): a new point at each `code`, y from `code + 10`. */
  points(code: number): Vec2[] {
    const out: Vec2[] = [];
    for (const g of this.tags) {
      if (g.code === code) out.push({ x: Number(g.value), y: 0 });
      else if (g.code === code + 10 && out.length > 0) out[out.length - 1].y = Number(g.value);
    }
    return out;
  }
  nums(code: number): number[] {
    return this.tags.filter((g) => g.code === code).map((g) => Number(g.value));
  }
}

function records(tags: Tag[]): Rec[] {
  const out: Rec[] = [];
  let cur: Rec | null = null;
  for (const g of tags) {
    if (g.code === 0) {
      cur = new Rec(g.value.toUpperCase(), []);
      out.push(cur);
    } else if (cur) cur.tags.push(g);
  }
  return out;
}

/** Sections by name. A section runs to ENDSEC, to the next SECTION or to the end of the file. */
function sections(tags: Tag[]): { found: boolean; map: Map<string, Tag[]> } {
  const map = new Map<string, Tag[]>();
  let found = false;
  let cur: Tag[] | null = null;
  for (let i = 0; i < tags.length; i++) {
    const g = tags[i];
    if (g.code === 0) {
      const v = g.value.toUpperCase();
      if (v === 'SECTION') {
        found = true;
        const name = tags[i + 1]?.code === 2 ? tags[i + 1].value.toUpperCase() : '';
        cur = [];
        if (name && !map.has(name)) map.set(name, cur);
        i++;
        continue;
      }
      if (v === 'ENDSEC' || v === 'EOF') {
        cur = null;
        continue;
      }
    }
    cur?.push(g);
  }
  return { found, map };
}

/** HEADER variables: $NAME → its tags. */
function headerVars(tags: Tag[]): Map<string, Rec> {
  const out = new Map<string, Rec>();
  let cur: Rec | null = null;
  for (const g of tags) {
    if (g.code === 9) {
      cur = new Rec(g.value.toUpperCase(), []);
      out.set(cur.type, cur);
    } else cur?.tags.push(g);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Transforms: uniform scale, rotation, optional mirror, translation. p' = k·R·M·p + t, where M
// flips y when `mirror`. Used for units, block inserts and the OCS of entities drawn with the
// extrusion direction (0, 0, -1). Identity and pure scale keep every value exact.
// ---------------------------------------------------------------------------------------------

interface Xf {
  cos: number;
  sin: number;
  /** atan2(sin, cos): the rotation as an angle, added to arc and text angles. */
  angle: number;
  k: number;
  mirror: boolean;
  tx: number;
  ty: number;
}

const xfScale = (k: number): Xf => ({ cos: 1, sin: 0, angle: 0, k, mirror: false, tx: 0, ty: 0 });

/** cos and sin of an angle in degrees, exact for multiples of 90°. */
function cosSinDeg(deg: number): [number, number] {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return [1, 0];
  if (r === 90) return [0, 1];
  if (r === 180) return [-1, 0];
  if (r === 270) return [0, -1];
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

function linear(x: Xf, v: Vec2): Vec2 {
  const vy = x.mirror ? -v.y : v.y;
  return { x: x.k * (x.cos * v.x - x.sin * vy), y: x.k * (x.sin * v.x + x.cos * vy) };
}
function apply(x: Xf, p: Vec2): Vec2 {
  const l = linear(x, p);
  return { x: l.x + x.tx, y: l.y + x.ty };
}
/** A direction angle (radians) through the transform; normalized to [0, 2π) when the transform
 *  turns or mirrors, untouched (exact) when it only scales. */
const mapAngle = (x: Xf, a: number): number => (x.mirror || x.angle !== 0 ? normAngle((x.mirror ? -a : a) + x.angle) : a);

/** a ∘ b: apply b, then a. */
function compose(a: Xf, b: Xf): Xf {
  const bs = a.mirror ? -b.sin : b.sin;
  const cos = a.cos * b.cos - a.sin * bs;
  const sin = a.sin * b.cos + a.cos * bs;
  const t = apply(a, { x: b.tx, y: b.ty });
  return { cos, sin, angle: Math.atan2(sin, cos), k: a.k * b.k, mirror: a.mirror !== b.mirror, tx: t.x, ty: t.y };
}

/** Mirror of the Object Coordinate System with extrusion (0, 0, -1): OCS x = −WCS x
 *  (DXF Reference (Autodesk), Advanced DXF Issues, Arbitrary Axis Algorithm). */
const FLIP_X: Xf = { cos: -1, sin: 0, angle: Math.PI, k: 1, mirror: true, tx: 0, ty: 0 };

// ---------------------------------------------------------------------------------------------
// Warnings, grouped by kind with a count
// ---------------------------------------------------------------------------------------------

class Warnings {
  private items = new Map<string, { code: string; count: number; names: string[]; message: (n: number, names: string) => string }>();
  add(code: string, key: string, message: (n: number, names: string) => string, name?: string): void {
    const k = `${code}:${key}`;
    let w = this.items.get(k);
    if (!w) {
      w = { code, count: 0, names: [], message };
      this.items.set(k, w);
    }
    if (name === undefined) w.count++;
    else if (!w.names.includes(name)) {
      w.names.push(name);
      w.count++;
    }
  }
  list(): DxfWarning[] {
    return [...this.items.values()].map((w) => {
      const shown = w.names.slice(0, 12).join(', ') + (w.names.length > 12 ? ', …' : '');
      return { code: w.code, count: w.count, message: w.message(w.count, shown) };
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

/** Layer id from its name: lower case, anything but [a-z0-9_-] becomes '-'. */
export function layerIdFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'layer';
}

class LayerBook {
  readonly layers: Layer[] = [];
  private byName = new Map<string, Layer>();
  private ids = new Set<string>();
  constructor(
    private warn: Warnings,
    readonly fromTable: boolean,
  ) {}

  add(l: Omit<Layer, 'id'>): Layer {
    const base = layerIdFromName(l.name);
    let id = base;
    for (let n = 2; this.ids.has(id); n++) id = `${base}-${n}`;
    const layer: Layer = { ...l, id };
    this.ids.add(id);
    this.byName.set(l.name.toUpperCase(), layer);
    this.layers.push(layer);
    return layer;
  }
  find(name: string): Layer | undefined {
    return this.byName.get(name.toUpperCase());
  }
  /** The id of the named layer, created with defaults (and one warning) when it is missing. */
  idFor(name: string): Id {
    const found = this.find(name);
    if (found) return found.id;
    this.warn.add('missing-layer', '', (n, names) => t('{n} layers used by the drawing were missing from the layer table and were created with default settings: {names}.', { n, names }), name);
    return this.add(layerFromEntry({ name, flags: 0, color: 7 }, this.warn)).id;
  }
}

interface LayerEntry {
  name: string;
  flags: number;
  color: number;
  trueColor?: number;
  lineType?: string;
  lineweight?: number;
}

/** A LAYER table entry (TABLES section, LAYER: 2 name, 70 flags, 62 ACI (negative = off),
 *  420 true colour, 6 line type, 370 lineweight in 1/100 mm; -1/-2/-3 = by layer/by block/default). */
function layerFromEntry(e: LayerEntry, warn: Warnings): Omit<Layer, 'id'> {
  const lw = e.lineweight !== undefined && e.lineweight >= 0 ? e.lineweight / 100 : undefined;
  const dxfType = e.lineType ?? 'CONTINUOUS';
  let lineType = isoLineTypeFor(dxfType, lw, e.name);
  if (lineType === null) {
    warn.add('unknown-linetype', '', (n, names) => t('{n} line types are not known to MechPilot and were drawn as continuous narrow lines (01.1): {names}.', { n, names }), dxfType);
    lineType = '01.1';
  }
  const width = snapLineWidth(lw ?? (lineType === '01.2' || lineType === '02.2' || lineType === '04.2' ? 0.5 : 0.25));
  const aci = Math.abs(Math.trunc(e.color));
  const color = e.trueColor !== undefined ? rgbToHex(e.trueColor) : aci === 7 || aci === 0 || aci >= 256 ? 'auto' : rgbToHex(aciToRgb(aci));
  return {
    name: e.name,
    color,
    lineType,
    lineWidth: width,
    // Frozen (70 bit 1) or off (negative colour) layers are hidden.
    visible: (e.flags & 1) === 0 && e.color >= 0,
    locked: (e.flags & 4) !== 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

/** An entity with the records that belong to it (POLYLINE + VERTEX…, INSERT + ATTRIB…). */
interface Item {
  rec: Rec;
  children: Rec[];
}

function items(recs: Rec[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (rec.type === 'VERTEX' || rec.type === 'SEQEND') continue; // stray, without a POLYLINE
    const item: Item = { rec, children: [] };
    const takesChildren = rec.type === 'POLYLINE' || (rec.type === 'INSERT' && rec.num(66, 0) === 1);
    if (takesChildren) {
      while (i + 1 < recs.length && recs[i + 1].type !== 'SEQEND' && (recs[i + 1].type === 'VERTEX' || recs[i + 1].type === 'ATTRIB')) {
        item.children.push(recs[++i]);
      }
      if (recs[i + 1]?.type === 'SEQEND') i++;
    }
    out.push(item);
  }
  return out;
}

function unsupported(warn: Warnings, type: string): void {
  warn.add('unsupported-entity', type, (n) => t('{n} entities of type {type} are not supported yet and were skipped.', { n, type }));
}

/** An entity before it gets its id and layer id. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistOmit<Entity, 'id' | 'layer'>;

interface Block {
  name: string;
  base: Vec2;
  xref: boolean;
  items: Item[];
}

interface Ctx {
  warn: Warnings;
  ids: IdGen;
  layers: LayerBook;
  blocks: Map<string, Block>;
  out: Entity[];
  z3d: boolean;
}

const isFiniteAll = (...ns: number[]): boolean => ns.every((n) => Number.isFinite(n));
const finitePts = (ps: Vec2[]): boolean => ps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

/** Any z coordinate (codes 30–37, elevation 38) away from zero, or a tilted extrusion direction. */
function has3d(rec: Rec): boolean {
  for (const g of rec.tags) {
    if ((g.code >= 30 && g.code <= 38) && Math.abs(Number(g.value)) > 1e-9) return true;
  }
  return false;
}

/** The OCS transform of an entity from its extrusion direction (210/220/230; default 0,0,1). */
function ocs(rec: Rec, ctx: Ctx): Xf | null {
  const nx = rec.num(210, 0);
  const ny = rec.num(220, 0);
  const nz = rec.num(230, 1);
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9) return nz < 0 ? FLIP_X : null;
  ctx.z3d = true;
  return null;
}

function invalid(ctx: Ctx, type: string): void {
  ctx.warn.add('invalid-geometry', type, (n) => t('{n} entities of type {type} had invalid geometry (for example a zero radius or too few points) and were skipped.', { n, type }));
}

/** Entity colour, line type or lineweight that differ from the layer's: not kept. */
function hasOverride(rec: Rec): boolean {
  const c = rec.num(62, 256);
  if (c !== 256 && c !== 0) return true;
  if (rec.has(420)) return true;
  const lt = rec.str(6)?.toUpperCase();
  if (lt !== undefined && lt !== 'BYLAYER' && lt !== 'BYBLOCK') return true;
  const lw = rec.num(370, -1);
  return lw >= 0;
}

/** Bulges in MechPilot form: one per segment (n−1 open, n closed), absent when all are 0. */
function polyline(points: Vec2[], bulges: number[], closed: boolean): { points: Vec2[]; closed: boolean; bulges?: number[] } {
  const segs = closed ? points.length : points.length - 1;
  const b = bulges.slice(0, segs).map((v) => (Number.isFinite(v) ? v : 0));
  while (b.length < segs) b.push(0);
  return b.some((v) => v !== 0) ? { points, closed, bulges: b } : { points, closed };
}

/** Evaluate a rational B-spline (weights) at u with de Boor on homogeneous coordinates. */
function rationalPoint(cps: Vec2[], w: number[], knots: number[], p: number, u: number): Vec2 {
  const n = cps.length - 1;
  let k = p;
  while (k < n && knots[k + 1] <= u) k++;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const c = cps[k - p + j];
    const wj = w[k - p + j] ?? 1;
    d.push([c.x * wj, c.y * wj, wj]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = knots[i + p - r + 1] - knots[i];
      const a = den === 0 ? 0 : (u - knots[i]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
  }
  const [x, y, wt] = d[p];
  return wt === 0 ? { x, y } : { x: x / wt, y: y / wt };
}

function convert(item: Item, parent: Xf, inherit: string | null, depth: number, ctx: Ctx): void {
  const { rec } = item;
  if (rec.num(60, 0) === 1) return; // invisible: skipped silently (Common Group Codes, 60)
  if (depth === 0 && rec.num(67, 0) === 1) {
    ctx.warn.add('paper-space', '', (n) => t('{n} entities drawn on paper-space layouts (title blocks, viewports) were skipped; only model space is imported.', { n }));
    return;
  }
  const known = ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT', 'INSERT'];
  if (!known.includes(rec.type)) {
    unsupported(ctx.warn, rec.type);
    return;
  }
  // Entities of a block on layer 0 take the layer of the INSERT (DXF Reference (Autodesk), BLOCKS).
  let layerName = rec.str(8) || '0';
  if (inherit !== null && layerName === '0') layerName = inherit;
  if (rec.type === 'POLYLINE' && (rec.num(70, 0) & (8 | 16 | 64)) !== 0) {
    // POLYLINE 70 flags: 8 3D polyline, 16 3D polygon mesh, 64 polyface mesh.
    ctx.warn.add('polyline-3d', '', (n) => t('{n} 3D polylines or meshes were skipped; only 2D polylines are imported.', { n }));
    return;
  }
  if (has3d(rec)) ctx.z3d = true;
  for (const c of item.children) if (has3d(c)) ctx.z3d = true;
  if (rec.type !== 'INSERT' && hasOverride(rec)) {
    ctx.warn.add('entity-overrides', '', (n) => t('{n} entities had their own colour, line type or line width; MechPilot draws every entity with the settings of its layer, so these were not kept.', { n }));
  }
  const withOcs = (): Xf => {
    const o = ocs(rec, ctx);
    return o ? compose(parent, o) : parent;
  };
  const push = (e: Draft): void => {
    ctx.out.push({ ...e, id: ctx.ids(), layer: ctx.layers.idFor(layerName) } as Entity);
  };

  switch (rec.type) {
    case 'LINE': {
      // LINE: 10/20 start, 11/21 end, in world coordinates.
      const a = { x: rec.num(10, NaN), y: rec.num(20, NaN) };
      const b = { x: rec.num(11, NaN), y: rec.num(21, NaN) };
      if (!finitePts([a, b])) return invalid(ctx, rec.type);
      push({ type: 'line', a: apply(parent, a), b: apply(parent, b) });
      return;
    }
    case 'CIRCLE': {
      // CIRCLE: 10/20 centre (OCS), 40 radius.
      const x = withOcs();
      const c = { x: rec.num(10, NaN), y: rec.num(20, NaN) };
      const r = rec.num(40, NaN);
      if (!finitePts([c]) || !(r > 0)) return invalid(ctx, rec.type);
      push({ type: 'circle', center: apply(x, c), radius: r * x.k });
      return;
    }
    case 'ARC': {
      // ARC: 10/20 centre (OCS), 40 radius, 50/51 start/end angles in degrees, counter-clockwise.
      const x = withOcs();
      const c = { x: rec.num(10, NaN), y: rec.num(20, NaN) };
      const r = rec.num(40, NaN);
      const s = (rec.num(50, 0) * Math.PI) / 180;
      const e = (rec.num(51, 360) * Math.PI) / 180;
      if (!finitePts([c]) || !(r > 0) || !isFiniteAll(s, e)) return invalid(ctx, rec.type);
      let start = mapAngle(x, s);
      let end = mapAngle(x, e);
      if (x.mirror) [start, end] = [end, start];
      push({ type: 'arc', center: apply(x, c), radius: r * x.k, start, end });
      return;
    }
    case 'LWPOLYLINE': {
      // LWPOLYLINE: 70 bit 1 closed; per vertex 10/20 and 42 bulge (OCS).
      const x = withOcs();
      const pts: Vec2[] = [];
      const bulges: number[] = [];
      for (const g of rec.tags) {
        if (g.code === 10) {
          pts.push({ x: Number(g.value), y: 0 });
          bulges.push(0);
        } else if (g.code === 20 && pts.length > 0) pts[pts.length - 1].y = Number(g.value);
        else if (g.code === 42 && bulges.length > 0) bulges[bulges.length - 1] = Number(g.value);
      }
      if (pts.length < 2 || !finitePts(pts)) return invalid(ctx, rec.type);
      const closed = (rec.num(70, 0) & 1) !== 0;
      push({ type: 'polyline', ...polyline(pts.map((p) => apply(x, p)), x.mirror ? bulges.map((b) => -b) : bulges, closed) });
      return;
    }
    case 'POLYLINE': {
      // POLYLINE 70 flags: 1 closed (3D kinds were skipped above). VERTEX: 10/20, 42 bulge,
      // 70 flags (16 = spline frame control point, not on the curve).
      const flags = rec.num(70, 0);
      const x = withOcs();
      const verts = item.children.filter((c) => c.type === 'VERTEX' && (c.num(70, 0) & 16) === 0);
      const pts = verts.map((v) => ({ x: v.num(10, NaN), y: v.num(20, NaN) }));
      const bulges = verts.map((v) => v.num(42, 0));
      if (pts.length < 2 || !finitePts(pts)) return invalid(ctx, rec.type);
      push({ type: 'polyline', ...polyline(pts.map((p) => apply(x, p)), x.mirror ? bulges.map((b) => -b) : bulges, (flags & 1) !== 0) });
      return;
    }
    case 'ELLIPSE': {
      // ELLIPSE (world coordinates): 10/20 centre, 11/21 major axis end relative to the centre,
      // 40 ratio, 41/42 start/end parameters in radians; extrusion (0,0,-1) runs clockwise.
      const c = { x: rec.num(10, NaN), y: rec.num(20, NaN) };
      let major = { x: rec.num(11, NaN), y: rec.num(21, NaN) };
      let ratio = rec.num(40, NaN);
      let start = rec.num(41, 0);
      let end = rec.num(42, Math.PI * 2);
      if (!finitePts([c, major]) || !(ratio > 0) || !isFiniteAll(start, end) || (major.x === 0 && major.y === 0)) return invalid(ctx, rec.type);
      if (ratio > 1) {
        // The minor axis is the longer one: swap so ratio <= 1 (parameters shift by −π/2).
        major = { x: -major.y * ratio, y: major.x * ratio };
        ratio = 1 / ratio;
        start -= Math.PI / 2;
        end -= Math.PI / 2;
      }
      const nz = rec.num(230, 1);
      if (Math.abs(rec.num(210, 0)) > 1e-9 || Math.abs(rec.num(220, 0)) > 1e-9) ctx.z3d = true;
      else if (nz < 0) [start, end] = [-end, -start];
      if (parent.mirror) [start, end] = [-end, -start];
      push({ type: 'ellipse', center: apply(parent, c), major: linear(parent, major), ratio, start, end });
      return;
    }
    case 'SPLINE': {
      // SPLINE (world coordinates): 70 flags (1 closed), 71 degree, 40 knots, 41 weights,
      // 10/20 control points, 11/21 fit points.
      const flags = rec.num(70, 0);
      const closed = (flags & 1) !== 0;
      let degree = Math.trunc(rec.num(71, 3));
      const cps = rec.points(10);
      const fits = rec.points(11);
      const knots = rec.nums(40);
      const weights = rec.nums(41);
      const knotsOk = cps.length >= degree + 1 && degree >= 1 && knots.length === cps.length + degree + 1 && knots.every((k, i) => Number.isFinite(k) && (i === 0 || k >= knots[i - 1])) && finitePts(cps);
      if (knotsOk && weights.length === cps.length && weights.some((w) => w !== 1)) {
        // Rational spline (weights): MechPilot splines have no weights, so it becomes a polyline.
        ctx.warn.add('rational-spline', '', (n) => t('{n} splines with weights (rational splines) were converted to polylines that follow the curve closely; MechPilot splines have no weights.', { n }));
        const u0 = knots[degree];
        const u1 = knots[cps.length];
        const count = Math.min(4000, Math.max(64, (cps.length - degree) * 32));
        const pts: Vec2[] = [];
        for (let i = 0; i <= count; i++) pts.push(rationalPoint(cps, weights, knots, degree, u0 + ((u1 - u0) * i) / count));
        push({ type: 'polyline', points: pts.map((p) => apply(parent, p)), closed: false });
        return;
      }
      let controlPoints = cps;
      let knotVector = knots;
      if (!knotsOk) {
        if (fits.length < 2 || !finitePts(fits)) return invalid(ctx, rec.type);
        const s = interpolateSpline(fits, degree >= 1 ? degree : 3);
        degree = s.degree;
        controlPoints = s.controlPoints;
        knotVector = s.knots;
      }
      const e: Omit<SplineEntity, 'id' | 'layer'> = {
        type: 'spline',
        degree,
        controlPoints: controlPoints.map((p) => apply(parent, p)),
        knots: knotVector.slice(),
        closed,
      };
      if (fits.length > 0 && finitePts(fits)) e.fitPoints = fits.map((p) => apply(parent, p));
      push(e);
      return;
    }
    case 'TEXT': {
      // TEXT: 10/20 first alignment point (OCS), 40 height, 50 rotation in degrees, 1 value.
      const x = withOcs();
      const p = { x: rec.num(10, NaN), y: rec.num(20, NaN) };
      const h = rec.num(40, NaN);
      const rot = (rec.num(50, 0) * Math.PI) / 180;
      const text = decodeDxfText(rec.str(1) ?? '');
      if (text.trim() === '') return;
      if (!finitePts([p]) || !(h > 0) || !Number.isFinite(rot)) return invalid(ctx, rec.type);
      push({ type: 'text', position: apply(x, p), text, height: h * x.k, rotation: mapAngle(x, rot) });
      return;
    }
    case 'MTEXT': {
      // MTEXT (world coordinates): 10/20 insertion, 40 height, 11/21 x-axis direction (wins over
      // 50 rotation, read in degrees as AutoCAD writes it), 71 attachment point (1–3 top,
      // 4–6 middle, 7–9 bottom), text = all 3 codes then 1, with inline formatting codes.
      const p = { x: rec.num(10, NaN), y: rec.num(20, NaN) };
      const h = rec.num(40, NaN);
      const dir = rec.has(11) ? { x: rec.num(11, 1), y: rec.num(21, 0) } : null;
      const rot = dir && (dir.x !== 0 || dir.y !== 0) ? Math.atan2(dir.y, dir.x) : (rec.num(50, 0) * Math.PI) / 180;
      const raw = rec.tags.filter((g) => g.code === 3).map((g) => g.value).join('') + (rec.str(1) ?? '');
      const text = stripMtext(raw);
      if (text === '') return;
      if (!finitePts([p]) || !(h > 0) || !Number.isFinite(rot)) return invalid(ctx, rec.type);
      // Move the attachment point to the baseline: one text height down from the top, half from the middle.
      const attach = rec.num(71, 1);
      const drop = attach <= 3 ? h : attach <= 6 ? h / 2 : 0;
      const base = { x: p.x + Math.sin(rot) * drop, y: p.y - Math.cos(rot) * drop };
      push({ type: 'text', position: apply(parent, base), text, height: h * parent.k, rotation: mapAngle(parent, rot) });
      return;
    }
    case 'INSERT':
      // Attribute values (ATTRIB after the INSERT) are not imported.
      for (const c of item.children) if (c.type === 'ATTRIB' && c.num(60, 0) !== 1) unsupported(ctx.warn, 'ATTRIB');
      insert(item, withOcs(), layerName, depth, ctx);
      return;
  }
}

/**
 * INSERT (ENTITIES section, INSERT): 2 block name, 10/20 insertion point (OCS), 41/42 x/y scale,
 * 50 rotation in degrees, 70/71 column/row counts, 44/45 column/row spacing. A block point p goes
 * to insertion + R·S·(p − base point); array copies are offset along the rotated axes.
 */
function insert(item: Item, parent: Xf, layerName: string, depth: number, ctx: Ctx): void {
  const { rec } = item;
  const name = rec.str(2) ?? '';
  const block = ctx.blocks.get(name.toUpperCase());
  if (!block || block.xref) {
    ctx.warn.add('missing-block', '', (n, names) => t('{n} blocks were inserted but not defined in the file (or are external references) and were skipped: {names}.', { n, names }), name);
    return;
  }
  if (depth >= MAX_BLOCK_DEPTH) {
    ctx.warn.add('block-depth', '', (n) => t('{n} block inserts were nested more than {max} levels deep and were skipped.', { n, max: MAX_BLOCK_DEPTH }));
    return;
  }
  let sx = rec.num(41, 1);
  let sy = rec.num(42, 1);
  if (sx === 0 || sy === 0 || !isFiniteAll(sx, sy)) return invalid(ctx, rec.type);
  if (Math.abs(sx) !== Math.abs(sy)) {
    ctx.warn.add('nonuniform-scale', '', (n) => t('{n} block inserts had different x and y scales; MechPilot used the x scale for both.', { n }));
    sy = Math.sign(sy) * Math.abs(sx);
  }
  const rotDeg = rec.num(50, 0);
  const [c, s] = cosSinDeg(rotDeg);
  // diag(sx, sy) = k · [R(π)] · [flip y], so the linear part is a rotation, a scale and maybe a mirror.
  const k = Math.abs(sx);
  const mirror = sx > 0 !== sy > 0;
  const turn = sx < 0; // sx < 0: rotate by a further 180°
  const cos = turn ? -c : c;
  const sin = turn ? -s : s;
  const lin: Xf = { cos, sin, angle: Math.atan2(sin, cos), k, mirror, tx: 0, ty: 0 };
  const ins = { x: rec.num(10, 0), y: rec.num(20, 0) };
  const cols = Math.max(1, Math.trunc(rec.num(70, 1)));
  const rows = Math.max(1, Math.trunc(rec.num(71, 1)));
  const dc = rec.num(44, 0);
  const dr = rec.num(45, 0);
  const baseMapped = linear(lin, block.base);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = col * dc;
      const oy = row * dr;
      const off = { x: c * ox - s * oy, y: s * ox + c * oy };
      const local: Xf = { ...lin, tx: ins.x + off.x - baseMapped.x, ty: ins.y + off.y - baseMapped.y };
      const full = compose(parent, local);
      for (const child of block.items) convert(child, full, layerName, depth + 1, ctx);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------------------------

function notDxf(): DxfReadResult {
  return {
    ok: false,
    error: {
      code: 'not-dxf',
      message: t('This file is not a DXF drawing.'),
      hint: t('A DXF file is text with SECTION headers and an ENTITIES section. Check that you picked the right file, or export it again as DXF (R12 or 2000) from the program that made it.'),
    },
  };
}

/** Read DXF text into a new document in millimetres, with grouped warnings for what was not kept. */
export function readDxf(text: string, opts: { name?: string; ids?: IdGen } = {}): DxfReadResult {
  if (/^AutoCAD Binary DXF/.test(text)) {
    return {
      ok: false,
      error: {
        code: 'binary-dxf',
        message: t('This is a binary DXF file, which MechPilot cannot read yet.'),
        hint: t('Save the drawing again as an ASCII (text) DXF from the program that made it.'),
      },
    };
  }
  const tags = tokenize(text);
  const { found, map } = sections(tags);
  const entitiesTags = map.get('ENTITIES');
  if (!found || !entitiesTags) return notDxf();

  const warn = new Warnings();

  // ---- HEADER: units ($INSUNITS, code 70) and the current layer ($CLAYER, code 8). ----
  const header = headerVars(map.get('HEADER') ?? []);
  const insunits = header.get('$INSUNITS')?.num(70, 0) ?? 0;
  let factor = 1;
  if (insunits === 0) {
    warn.add('units-assumed', '', () => t('The file does not say which unit it uses, so millimetres were assumed. If the drawing looks 25.4 times too small, it was drawn in inches.'));
  } else if (insunits === 1) {
    factor = 25.4;
    warn.add('units-converted', '', () => t('The drawing was in inches; every length was converted to millimetres (× 25.4).'));
  } else if (insunits !== INSUNITS_MM) {
    const f = INSUNITS_TO_MM[insunits];
    if (f === undefined) {
      warn.add('units-unknown', '', () => t('The file uses an unknown unit code ({code}), so millimetres were assumed.', { code: insunits }));
    } else {
      factor = f;
      warn.add('units-converted', '', () => t('The drawing was in {unit}; every length was converted to millimetres (× {factor}).', { unit: insunitsName(insunits), factor: String(f) }));
    }
  }

  // ---- TABLES: layers. ----
  const tableRecs = records(map.get('TABLES') ?? []);
  const layerEntries = tableRecs.filter((r) => r.type === 'LAYER');
  const book = new LayerBook(warn, layerEntries.length > 0);
  for (const r of layerEntries) {
    const name = r.str(2);
    if (!name || book.find(name)) continue;
    const entry: LayerEntry = { name, flags: r.num(70, 0), color: r.num(62, 7) };
    if (r.has(420)) entry.trueColor = r.num(420, 0) & 0xffffff;
    if (r.has(6)) entry.lineType = r.str(6);
    if (r.has(370)) entry.lineweight = r.num(370, -3);
    book.add(layerFromEntry(entry, warn));
  }
  if (!book.fromTable) for (const l of defaultLayers()) book.add(l);

  // ---- BLOCKS: BLOCK (2 name, 10/20 base point, 70 flags: 4 external reference) … ENDBLK. ----
  const blocks = new Map<string, Block>();
  {
    let cur: { name: string; base: Vec2; xref: boolean; recs: Rec[] } | null = null;
    for (const r of records(map.get('BLOCKS') ?? [])) {
      if (r.type === 'BLOCK') {
        cur = { name: r.str(2) ?? '', base: { x: r.num(10, 0), y: r.num(20, 0) }, xref: (r.num(70, 0) & 4) !== 0, recs: [] };
      } else if (r.type === 'ENDBLK') {
        if (cur && cur.name) blocks.set(cur.name.toUpperCase(), { name: cur.name, base: cur.base, xref: cur.xref, items: items(cur.recs) });
        cur = null;
      } else cur?.recs.push(r);
    }
  }

  // ---- ENTITIES ----
  const ctx: Ctx = { warn, ids: opts.ids ?? randomId, layers: book, blocks, out: [], z3d: false };
  const root = xfScale(factor);
  for (const item of items(records(entitiesTags))) convert(item, root, null, 0, ctx);
  if (ctx.z3d) warn.add('z-dropped', '', () => t('The drawing had 3D coordinates; the z values were dropped and the drawing was read as seen from above.'));

  // ---- The document ----
  if (book.layers.length === 0) for (const l of defaultLayers()) book.add(l);
  const clayer = header.get('$CLAYER')?.str(8);
  const active = (clayer && book.find(clayer)?.id) || book.find('0')?.id || book.layers[0].id;
  const doc: Document = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    unit: 'mm',
    name: opts.name ?? t('Imported DXF'),
    standard: 'iso',
    projection: 'first',
    layers: Object.fromEntries(book.layers.map((l) => [l.id, l])),
    layerOrder: book.layers.map((l) => l.id),
    activeLayer: active,
    entities: Object.fromEntries(ctx.out.map((e) => [e.id, e])),
    entityOrder: ctx.out.map((e) => e.id),
    dimStyle: { ...DEFAULT_DIM_STYLE },
    sheets: {},
    sheetOrder: [],
  };
  return { ok: true, doc, warnings: warn.list() };
}
