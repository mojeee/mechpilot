#!/usr/bin/env node
// Validates every data file under library/: valid JSON, an `id` equal to the file name, a `source`
// (standard and clause, or catalogue) and the fields its kind requires (library/README.md).
// Run: npm run check:library
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libDir = join(root, 'library');

function* jsonFiles(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* jsonFiles(p);
    else if (f.endsWith('.json')) yield p;
  }
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Per-kind field rules. The kind is the folder directly under library/. */
const RULES = {
  'line-types': (d, err) => {
    if (!Array.isArray(d.widths) || !d.widths.every(isNum)) err('widths: array of numbers (mm)');
    if (!Array.isArray(d.types)) return err('types: array');
    for (const t of d.types) {
      if (!isStr(t.id)) err(`type without id`);
      if (!isStr(t.name)) err(`type ${t.id}: name`);
      if (!['narrow', 'wide'].includes(t.width)) err(`type ${t.id}: width must be narrow or wide`);
      if (!isStr(t.use)) err(`type ${t.id}: use`);
      if (!isStr(t.source)) err(`type ${t.id}: source`);
      if (t.pattern !== undefined && !(Array.isArray(t.pattern) && t.pattern.every(isNum))) err(`type ${t.id}: pattern must be numbers`);
    }
  },
};

let errors = 0;
let count = 0;
for (const file of jsonFiles(libDir)) {
  count++;
  const rel = relative(root, file).replaceAll('\\', '/');
  const err = (msg) => {
    errors++;
    console.error(`${rel}: ${msg}`);
  };
  let d;
  try {
    d = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    err(`not valid JSON: ${e.message}`);
    continue;
  }
  if (d.id !== basename(file, '.json')) err(`id "${d.id}" must equal the file name`);
  if (!isStr(d.source)) err('source is required (standard and clause, or catalogue)');
  if (d.unit !== undefined && d.unit !== 'mm') err('unit must be "mm" when present (product rule 1)');
  const kind = rel.split('/')[1];
  const rule = RULES[kind];
  if (!rule) err(`unknown library kind "${kind}" (add its rules to scripts/check-library.mjs)`);
  else rule(d, err);
}
console.log(`${count} library files checked, ${errors} problem${errors === 1 ? '' : 's'}`);
process.exit(errors ? 1 : 0);
