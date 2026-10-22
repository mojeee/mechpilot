// The .mechpilot.json file format (docs/file-format.md): versioned JSON with migrations and stable
// ordering so files diff well in Git (product rule 3). Numbers are written by JSON.stringify, which
// round-trips every double exactly, so nothing is rounded on save or load (product rule 1).

import { FORMAT_NAME, FORMAT_VERSION, type Document, type Entity, type Layer } from './types';

export interface FileError {
  code: 'not-json' | 'not-mechpilot' | 'newer-version' | 'invalid';
  message: string;
  hint?: string;
}
export type ParseResult = { ok: true; doc: Document; migratedFrom?: number } | { ok: false; error: FileError };

export const FILE_EXTENSION = '.mechpilot.json';

/** Fixed key order for the top level; other objects get their keys sorted. */
const TOP_ORDER: (keyof Document)[] = ['format', 'version', 'unit', 'name', 'description', 'standard', 'projection', 'layerOrder', 'activeLayer', 'layers', 'entityOrder', 'entities'];
/** Entities and layers: id and type first, then the rest alphabetically, so a diff reads naturally. */
const FIRST_KEYS = ['id', 'type', 'layer'];

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
    } else out[k] = canonical(v);
  }
  return JSON.stringify(out, null, 2) + '\n';
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
/** migrations[n] upgrades a version-n file to version n+1. Empty until the format changes. */
const migrations: Record<number, Migration> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isVec = (v: unknown): v is { x: number; y: number } => isObj(v) && isNum(v.x) && isNum(v.y);

function validateLayer(v: unknown, id: string): Layer | string {
  if (!isObj(v)) return `layer ${id} is not an object`;
  if (v.id !== id) return `layer ${id} has id "${String(v.id)}"`;
  if (!isStr(v.name)) return `layer ${id}: name`;
  if (!isStr(v.color)) return `layer ${id}: color`;
  if (!isStr(v.lineType)) return `layer ${id}: lineType`;
  if (!isNum(v.lineWidth) || v.lineWidth <= 0) return `layer ${id}: lineWidth`;
  return { id, name: v.name, color: v.color, lineType: v.lineType, lineWidth: v.lineWidth, visible: v.visible !== false, locked: v.locked === true };
}

function validateEntity(v: unknown, id: string, layers: Record<string, Layer>): Entity | string {
  if (!isObj(v)) return `entity ${id} is not an object`;
  if (v.id !== id) return `entity ${id} has id "${String(v.id)}"`;
  if (!isStr(v.layer) || !layers[v.layer]) return `entity ${id}: layer "${String(v.layer)}" does not exist`;
  const base = { id, layer: v.layer };
  switch (v.type) {
    case 'line':
      if (!isVec(v.a) || !isVec(v.b)) return `entity ${id}: line needs points a and b`;
      return { ...base, type: 'line', a: { x: v.a.x, y: v.a.y }, b: { x: v.b.x, y: v.b.y } };
    case 'circle':
      if (!isVec(v.center) || !isNum(v.radius) || v.radius <= 0) return `entity ${id}: circle needs center and radius > 0`;
      return { ...base, type: 'circle', center: { x: v.center.x, y: v.center.y }, radius: v.radius };
    case 'arc':
      if (!isVec(v.center) || !isNum(v.radius) || v.radius <= 0 || !isNum(v.start) || !isNum(v.end)) return `entity ${id}: arc needs center, radius > 0, start, end`;
      return { ...base, type: 'arc', center: { x: v.center.x, y: v.center.y }, radius: v.radius, start: v.start, end: v.end };
    default:
      return `entity ${id}: unknown type "${String(v.type)}"`;
  }
}

/** Validate a raw object of the current version into a Document, or say what is wrong. */
export function validate(raw: Record<string, unknown>): Document | string {
  if (raw.unit !== 'mm') return `unit must be "mm", found ${JSON.stringify(raw.unit)}`;
  if (!isStr(raw.name)) return 'name is missing';
  if (raw.standard !== 'iso' && raw.standard !== 'asme') return 'standard must be "iso" or "asme"';
  if (raw.projection !== 'first' && raw.projection !== 'third') return 'projection must be "first" or "third"';
  if (!isObj(raw.layers) || !Array.isArray(raw.layerOrder)) return 'layers and layerOrder are missing';
  if (!isObj(raw.entities) || !Array.isArray(raw.entityOrder)) return 'entities and entityOrder are missing';
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
