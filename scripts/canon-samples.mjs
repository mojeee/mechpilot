#!/usr/bin/env node
// Rewrites every samples/*.mechpilot.json in the canonical form that shared/doc/file.ts writes
// (fixed top-level key order, maps in their order arrays, id/type/kind/layer first then
// alphabetical keys, 2-space indent). tests/samples.test.ts checks the result with the real
// serializer, so this script only needs to agree with it. Run after editing a sample by hand:
//   node scripts/canon-samples.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOP_ORDER = ['format', 'version', 'unit', 'name', 'description', 'standard', 'projection', 'dimStyle', 'layerOrder', 'activeLayer', 'layers', 'entityOrder', 'entities', 'sheetOrder', 'sheets'];
const FIRST_KEYS = ['id', 'type', 'kind', 'layer'];

function canonical(value, firstKeys = []) {
  if (Array.isArray(value)) return value.map((v) => canonical(v));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => {
      const ia = firstKeys.indexOf(a);
      const ib = firstKeys.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const out = {};
    for (const k of keys) if (value[k] !== undefined) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

function serialize(doc) {
  const out = {};
  for (const k of TOP_ORDER) {
    const v = doc[k];
    if (v === undefined) continue;
    if (k === 'layers' || k === 'entities' || k === 'sheets') {
      const order = doc[k === 'layers' ? 'layerOrder' : k === 'entities' ? 'entityOrder' : 'sheetOrder'] ?? Object.keys(v);
      const m = {};
      for (const id of order) if (v[id]) m[id] = canonical(v[id], FIRST_KEYS);
      out[k] = m;
    } else out[k] = canonical(v);
  }
  return JSON.stringify(out, null, 2) + '\n';
}

const dir = join(root, 'samples');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.mechpilot.json'))) {
  const p = join(dir, f);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  // Derive the order arrays from the maps when a hand-edited file left them out.
  doc.layerOrder ??= Object.keys(doc.layers);
  doc.entityOrder ??= Object.keys(doc.entities);
  doc.sheetOrder ??= Object.keys(doc.sheets ?? {});
  doc.sheets ??= {};
  for (const [id, e] of Object.entries(doc.entities)) e.id ??= id;
  for (const [id, l] of Object.entries(doc.layers)) l.id ??= id;
  for (const [id, s] of Object.entries(doc.sheets)) s.id ??= id;
  writeFileSync(p, serialize(doc));
  console.log(`${f}: ${doc.entityOrder.length} entities, ${doc.sheetOrder.length} sheets`);
}
