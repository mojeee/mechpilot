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
const isPos = (v) => isNum(v) && v > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
/** "a/b" -> a/b, or NaN */
const fraction = (s) => {
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(s));
  return m ? Number(m[1]) / Number(m[2]) : NaN;
};

/** Standards data files (M2 on) say how they were verified: "primary" = the standard's own text was
 *  seen, "secondary" = two independent secondary sources agree (and docs/to-verify.md lists it). */
function checkVerification(d, err) {
  if (!['primary', 'secondary'].includes(d.verification)) err('verification must be "primary" or "secondary"');
  if (!Array.isArray(d.verifiedFrom) || d.verifiedFrom.length === 0 || !d.verifiedFrom.every(isStr)) {
    err('verifiedFrom: non-empty array of strings (URLs or document references)');
  }
}

/** ISO 216 A-series trimmed sizes, short x long side, mm (ISO 216; ISO 5457:1999 Table 1). */
const ISO216 = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };

/** increasing (strictly by default), ignoring nulls */
function increasing(values, strict = true) {
  let prev = -Infinity;
  for (const v of values) {
    if (v === null) continue;
    if (strict ? !(v > prev) : !(v >= prev)) return false;
    prev = v;
  }
  return true;
}

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

  sheets: (d, err) => {
    checkVerification(d, err);
    if (d.unit !== 'mm') err('unit must be "mm"');
    if (!Array.isArray(d.sizes) || d.sizes.length === 0) return err('sizes: non-empty array');
    for (const s of d.sizes) {
      const tag = `size ${s.id}`;
      const ref = ISO216[s.id];
      if (!ref) {
        err(`${tag}: unknown size (expected one of ${Object.keys(ISO216).join(', ')})`);
        continue;
      }
      if (!isPos(s.width) || !isPos(s.height)) err(`${tag}: width and height (mm)`);
      const short = Math.min(s.width, s.height);
      const long = Math.max(s.width, s.height);
      if (short !== ref[0] || long !== ref[1]) err(`${tag}: ${s.width} x ${s.height} does not match ISO 216 ${ref[0]} x ${ref[1]}`);
      if (!['landscape', 'portrait'].includes(s.orientation)) err(`${tag}: orientation must be landscape or portrait`);
      else if ((s.orientation === 'landscape') !== (s.width > s.height)) err(`${tag}: width/height disagree with orientation`);
      const m = s.frameMargins;
      if (!isObj(m) || !['left', 'top', 'right', 'bottom'].every((k) => isNum(m[k]) && m[k] >= 0)) {
        err(`${tag}: frameMargins { left, top, right, bottom } (mm)`);
      } else if (s.drawingSpace) {
        // ISO 5457 Table 1: drawing space a2 x b2 = trimmed sheet minus the borders
        const w = s.width - m.left - m.right;
        const h = s.height - m.top - m.bottom;
        const ds = [s.drawingSpace.a2, s.drawingSpace.b2].sort((a, b) => a - b);
        if (Math.min(w, h) !== ds[0] || Math.max(w, h) !== ds[1]) err(`${tag}: drawing space ${w} x ${h} disagrees with drawingSpace`);
      }
      if (!Number.isInteger(s.zonesX) || s.zonesX <= 0 || !Number.isInteger(s.zonesY) || s.zonesY <= 0) err(`${tag}: zonesX/zonesY positive integers`);
      else if ((s.zonesX >= s.zonesY) !== (s.width >= s.height)) err(`${tag}: more zones must run along the long side`);
    }
    if (!isObj(d.zoneField) || !isPos(d.zoneField.length)) err('zoneField.length (mm)');
    if (!isPos(d.frameLineWidth)) err('frameLineWidth (mm)');
  },

  'title-blocks': (d, err) => {
    checkVerification(d, err);
    if (!isPos(d.maxWidth)) err('maxWidth (mm)');
    if (!Array.isArray(d.fields) || d.fields.length === 0) return err('fields: non-empty array');
    const ids = new Set();
    for (const f of d.fields) {
      if (!isStr(f.id)) {
        err('field without id');
        continue;
      }
      if (ids.has(f.id)) err(`field ${f.id}: duplicate id`);
      ids.add(f.id);
      if (!isStr(f.name)) err(`field ${f.id}: name`);
      if (!isStr(f.nameIt)) err(`field ${f.id}: nameIt (Italian name)`);
      if (typeof f.mandatory !== 'boolean') err(`field ${f.id}: mandatory must be true or false`);
      if (f.maxChars !== null && f.maxChars !== undefined && !(Number.isInteger(f.maxChars) && f.maxChars > 0)) err(`field ${f.id}: maxChars positive integer or null`);
    }
    const L = d.layout;
    if (L !== undefined) {
      if (!isStr(L.origin) || !/MechPilot/.test(L.origin)) err("layout.origin must say the layout is MechPilot's own");
      if (!isPos(L.width) || !isPos(L.height)) err('layout.width/height (mm)');
      if (L.width > d.maxWidth) err(`layout.width ${L.width} exceeds maxWidth ${d.maxWidth}`);
      if (!Array.isArray(L.cells)) err('layout.cells: array');
      else {
        let area = 0;
        for (const c of L.cells) {
          if (!ids.has(c.field)) err(`layout cell: unknown field "${c.field}"`);
          if (![c.x, c.y].every((v) => isNum(v) && v >= 0) || !isPos(c.w) || !isPos(c.h)) err(`layout cell ${c.field}: x, y, w, h (mm)`);
          else if (c.x + c.w > L.width + 1e-9 || c.y + c.h > L.height + 1e-9) err(`layout cell ${c.field}: outside the block`);
          area += c.w * c.h;
        }
        if (!close(area, L.width * L.height, 1e-6)) err(`layout cells cover ${area} mm2, the block is ${L.width * L.height} mm2 (gaps or overlaps)`);
        for (const f of d.fields) {
          if (f.mandatory && !L.cells.some((c) => c.field === f.id || c.alsoShows === f.id)) err(`layout: mandatory field ${f.id} has no cell`);
        }
      }
    }
  },

  scales: (d, err) => {
    checkVerification(d, err);
    if (!Array.isArray(d.scales) || d.scales.length === 0) return err('scales: non-empty array');
    for (const s of d.scales) {
      const m = /^(\d+):(\d+)$/.exec(s.id ?? '');
      if (!m) {
        err(`scale "${s.id}": id must be "a:b"`);
        continue;
      }
      const ratio = Number(m[1]) / Number(m[2]);
      if (!isNum(s.ratio) || !close(s.ratio, ratio, 1e-12)) err(`scale ${s.id}: ratio ${s.ratio} must be ${ratio}`);
      const kind = ratio > 1 ? 'enlargement' : ratio < 1 ? 'reduction' : 'full';
      if (s.kind !== kind) err(`scale ${s.id}: kind must be ${kind}`);
      if (m[1] !== '1' && m[2] !== '1') err(`scale ${s.id}: one side of the ratio must be 1 (ISO 5455, clause 3)`);
    }
    if (!increasing([...d.scales].reverse().map((s) => s.ratio))) err('scales: list them from the largest ratio to the smallest, without duplicates');
    if (!isObj(d.designation) || !isStr(d.designation.format)) err('designation.format');
  },

  lettering: (d, err) => {
    checkVerification(d, err);
    if (d.unit !== 'mm') err('unit must be "mm"');
    if (!Array.isArray(d.heights) || !d.heights.every(isPos) || !increasing(d.heights)) err('heights: increasing positive numbers (mm)');
    if (!isObj(d.types)) return err('types: object');
    for (const [k, t] of Object.entries(d.types)) {
      const lw = fraction(t.lineWidth);
      if (!(lw > 0 && lw < 1)) err(`type ${k}: lineWidth must be a fraction of h like "1/10"`);
      for (const key of ['lowercaseHeight', 'tail', 'stem', 'diacriticalArea', 'characterSpacing', 'wordSpacing']) {
        if (!(fraction(t[key]) > 0)) err(`type ${k}: ${key} must be a fraction of h like "7/10"`);
      }
      const b = t.minBaselineSpacing;
      if (!isObj(b) || !['b1', 'b2', 'b3'].every((x) => fraction(b[x]) > 1)) err(`type ${k}: minBaselineSpacing b1, b2, b3 fractions > 1`);
      if (!(fraction(t.lowercaseHeight) < 1)) err(`type ${k}: lowercaseHeight must be below h`);
      // ISO 3098-0:1997, 4.1: character spacing = twice the line width
      if (!close(fraction(t.characterSpacing), 2 * lw, 1e-12)) err(`type ${k}: characterSpacing must be 2 x lineWidth`);
    }
    const def = d.default;
    if (!isObj(def) || !isStr(def.origin)) err('default: object with origin');
    else {
      if (!d.types[def.type]) err(`default.type "${def.type}" is not in types`);
      for (const k of ['dimensions', 'titleBlockLabels', 'titleBlockValues']) {
        if (!d.heights.includes(def[k])) err(`default.${k} must be one of heights`);
      }
    }
  },

  dimensioning: (d, err) => {
    checkVerification(d, err);
    if (d.unit !== 'mm') err('unit must be "mm"');
    if (!isObj(d.arrowhead) || !Array.isArray(d.arrowhead.forms) || d.arrowhead.forms.length === 0) err('arrowhead.forms: non-empty array');
    else {
      for (const f of d.arrowhead.forms) {
        if (!isStr(f.id)) err('arrowhead form without id');
        if (f.includedAngle !== undefined && !(isPos(f.includedAngle) && f.includedAngle <= 90)) err(`arrowhead ${f.id}: includedAngle in (0, 90]`);
        for (const k of ['lengthInH', 'depthInH', 'diameterInH']) if (f[k] !== undefined && !isPos(f[k])) err(`arrowhead ${f.id}: ${k} > 0`);
      }
    }
    for (const k of ['extensionLineOvershoot', 'extensionLineGap']) {
      if (d[k] !== undefined && !(isObj(d[k]) && isPos(d[k].lineWidths) && isStr(d[k].source))) err(`${k}: { lineWidths, source }`);
    }
    if (typeof d.textAboveLine !== 'boolean') err('textAboveLine: boolean');
    if (!isObj(d.symbols) || !isStr(d.symbols.source)) err('symbols: object with source');
    else if (!isObj(d.symbols.diameter) || !isObj(d.symbols.radius)) err('symbols: diameter and radius are required');
  },

  gdt: (d, err) => {
    checkVerification(d, err);
    if (!Array.isArray(d.characteristics) || d.characteristics.length === 0) return err('characteristics: non-empty array');
    const groups = ['form', 'orientation', 'location', 'run-out'];
    const ids = new Set();
    for (const c of d.characteristics) {
      if (!isStr(c.id)) {
        err('characteristic without id');
        continue;
      }
      if (ids.has(c.id)) err(`characteristic ${c.id}: duplicate`);
      ids.add(c.id);
      if (!isStr(c.name) || !isStr(c.nameIt)) err(`characteristic ${c.id}: name and nameIt`);
      if (!isStr(c.symbol)) err(`characteristic ${c.id}: symbol`);
      if (!['required', 'optional', 'none'].includes(c.datum)) err(`characteristic ${c.id}: datum must be required, optional or none`);
      if (!Array.isArray(c.groups) || c.groups.length === 0 || !c.groups.every((g) => groups.includes(g))) {
        err(`characteristic ${c.id}: groups from ${groups.join(', ')}`);
        continue;
      }
      // ISO 1101:2017 Table 2: form-only characteristics need no datum; orientation and run-out always do
      if (c.groups.length === 1 && c.groups[0] === 'form' && c.datum !== 'none') err(`characteristic ${c.id}: a form-only characteristic has no datum`);
      if (c.groups.length === 1 && ['orientation', 'run-out'].includes(c.groups[0]) && c.datum !== 'required') err(`characteristic ${c.id}: datum required`);
    }
    const f = d.frame;
    if (!isObj(f) || !isPos(f.heightInH) || !isPos(f.lineWidthInH)) err('frame: heightInH and lineWidthInH');
  },

  surface: (d, err) => {
    checkVerification(d, err);
    if (d.unit !== 'mm') err('unit must be "mm"');
    if (!isObj(d.symbol) || !Array.isArray(d.symbol.forms) || d.symbol.forms.length !== 3) err('symbol.forms: the three graphical symbols');
    const lp = d.symbol?.legacyProportions;
    if (lp !== undefined) {
      if (!Array.isArray(lp.table)) err('symbol.legacyProportions.table: array');
      else {
        for (const r of lp.table) {
          if (![r.h, r.lineWidth, r.H1, r.H2].every(isPos)) err(`legacyProportions h=${r.h}: positive numbers`);
          else {
            if (!close(r.lineWidth, r.h * lp.lineWidthInH, 1e-9)) err(`legacyProportions h=${r.h}: lineWidth must be h x ${lp.lineWidthInH}`);
            if (!(r.H2 > r.H1 && r.H1 > r.h)) err(`legacyProportions h=${r.h}: expected h < H1 < H2`);
          }
        }
      }
    }
    if (d.raSeriesUnit !== 'µm') err('raSeriesUnit must be "µm" (Ra is given in micrometres)');
    if (!Array.isArray(d.raSeries) || !d.raSeries.every(isPos) || !increasing(d.raSeries)) err('raSeries: increasing positive numbers');
    else {
      // each step about doubles (ISO 1302:1978 Table 1)
      for (let i = 1; i < d.raSeries.length; i++) {
        const q = d.raSeries[i] / d.raSeries[i - 1];
        if (q < 1.9 || q > 2.1) err(`raSeries: ${d.raSeries[i - 1]} -> ${d.raSeries[i]} is not a doubling step`);
      }
    }
  },

  fits: (d, err) => {
    checkVerification(d, err);
    if (d.unit !== 'mm') err('unit must be "mm"');
    const steps = d.sizeSteps;
    if (!Array.isArray(steps) || steps.length === 0) return err('sizeSteps: non-empty array');
    steps.forEach((s, i) => {
      if (!isNum(s.over) || !isPos(s.upTo) || !(s.upTo > s.over)) err(`sizeSteps[${i}]: over < upTo`);
      if (i > 0 && s.over !== steps[i - 1].upTo) err(`sizeSteps[${i}]: must start where the previous step ends`);
    });
    if (steps[0]?.over !== 0) err('sizeSteps: the first step starts at 0');
    const n = steps.length;
    const len = (arr, tag) => {
      if (!Array.isArray(arr) || arr.length !== n || !arr.every((v) => v === null || isNum(v))) {
        err(`${tag}: array of ${n} numbers or nulls (one per size step)`);
        return false;
      }
      return true;
    };

    // IT grades: strictly increasing with the grade, never decreasing with the size step
    const it = d.itGrades;
    if (!isObj(it)) return err('itGrades: object');
    const order = ['IT01', 'IT0', ...Array.from({ length: 18 }, (_, k) => `IT${k + 1}`)];
    const present = order.filter((g) => it[g] !== undefined);
    if (present.length !== Object.keys(it).length) err(`itGrades: unknown grade names (expected ${order.join(', ')})`);
    const okGrades = present.filter((g) => len(it[g], `itGrades.${g}`));
    for (const g of okGrades) {
      if (it[g].some((v) => v !== null && !(v > 0))) err(`itGrades.${g}: values must be > 0`);
      if (!increasing(it[g], false)) err(`itGrades.${g}: must not decrease with the size step`);
    }
    for (let i = 0; i < n; i++) {
      const row = okGrades.map((g) => it[g][i]);
      if (!increasing(row)) err(`itGrades at step ${steps[i].over}-${steps[i].upTo}: must increase strictly with the grade`);
    }
    // ISO 286-1:1988 Annex A: IT5..IT18 = k * i up to 500 mm. The tables are rounded and the
    // standard departs from the formula for small values, so only gross errors (> 20 %) are caught.
    const mult = d.formula?.multipliers;
    if (isObj(mult)) {
      steps.forEach((s, i) => {
        if (s.upTo > 500) return;
        const D = Math.sqrt((s.over || 1) * s.upTo);
        const iu = 0.45 * Math.cbrt(D) + 0.001 * D; // micrometres
        for (const [g, k] of Object.entries(mult)) {
          const v = it[g]?.[i];
          if (!isNum(v)) continue;
          const calc = (k * iu) / 1000;
          if (Math.abs(v - calc) / calc > 0.2) err(`itGrades.${g} at ${s.over}-${s.upTo}: ${v} is far from the formula value ${calc.toFixed(4)}`);
        }
      });
    }

    const fd = d.fundamentalDeviations;
    if (!isObj(fd) || !isObj(fd.shaft) || !isObj(fd.hole)) return err('fundamentalDeviations: { shaft, hole }');
    const arrays = (v) => (Array.isArray(v) ? [v] : isObj(v) ? Object.values(v).filter(Array.isArray) : []);
    for (const side of ['shaft', 'hole']) {
      for (const [L, v] of Object.entries(fd[side])) {
        const tag = `fundamentalDeviations.${side}.${L}`;
        const lists = arrays(v);
        if (lists.length === 0) err(`${tag}: array, or object of arrays`);
        lists.forEach((a) => len(a, tag));
      }
    }
    const sh = fd.shaft;
    const ho = fd.hole;
    const arr = (v) => Array.isArray(v) && v.length === n;
    // signs, ISO 286-1:1988 9.1: shafts a..h es <= 0, m..zc ei >= 0
    for (const L of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) if (arr(sh[L]) && sh[L].some((v) => v !== null && v > 0)) err(`shaft ${L}: es must be <= 0`);
    for (const L of ['m', 'n', 'p', 'r', 's', 't', 'u', 'v', 'x', 'y', 'z', 'za', 'zb', 'zc']) if (arr(sh[L]) && sh[L].some((v) => v !== null && v < 0)) err(`shaft ${L}: ei must be >= 0`);
    // within one size step the deviations move away from zero in letter order: a < b < ... < h, m < n < ... < zc
    const chain = (letters) => {
      for (let i = 0; i < n; i++) {
        const row = letters.map((L) => (arr(sh[L]) ? sh[L][i] : null));
        if (!increasing(row)) {
          err(`shaft deviations at step ${steps[i].over}-${steps[i].upTo}: ${letters.join(', ')} must increase in letter order`);
          return;
        }
      }
    };
    chain(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    chain(['m', 'n', 'p', 'r', 's', 't', 'u', 'v', 'x', 'y', 'z', 'za', 'zb', 'zc']);
    // ISO 286-1:1988 Table 3: holes A..H mirror shafts a..h (EI = -es), P..ZC above IT7 mirror p..zc (ES = -ei)
    const mirror = (holeArr, shaftArr, label) => {
      if (!arr(holeArr) || !arr(shaftArr)) return;
      for (let i = 0; i < n; i++) {
        const a = holeArr[i];
        const b = shaftArr[i];
        if ((a === null) !== (b === null) || (a !== null && !close(a, -b))) {
          err(`hole ${label} at ${steps[i].over}-${steps[i].upTo}: must be the mirror of the shaft value`);
          return;
        }
      }
    };
    for (const L of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) mirror(ho[L.toUpperCase()], sh[L], L.toUpperCase());
    for (const L of ['p', 'r', 's', 't', 'u', 'v', 'x', 'y', 'z', 'za', 'zb', 'zc']) mirror(ho[L.toUpperCase()]?.aboveIT7, sh[L], `${L.toUpperCase()} (above IT7)`);
    // ISO 286-1:1988 Table 3: Delta = IT(n) - IT(n-1), except the first step (up to 3 mm) where Delta = 0
    if (isObj(fd.delta)) {
      for (const [g, a] of Object.entries(fd.delta)) {
        if (!len(a, `fundamentalDeviations.delta.${g}`)) continue;
        const k = order.indexOf(g);
        if (k < 1 || !arr(it[g]) || !arr(it[order[k - 1]])) {
          err(`delta.${g}: unknown grade or missing IT values`);
          continue;
        }
        for (let i = 0; i < n; i++) {
          if (a[i] === null) continue;
          const expect = i === 0 ? 0 : it[g][i] - it[order[k - 1]][i];
          if (!close(a[i], expect, 1e-9)) err(`delta.${g} at ${steps[i].over}-${steps[i].upTo}: ${a[i]} but the IT difference is ${Number(expect.toFixed(4))}`);
        }
      }
    }
    if (!isObj(d.rules) || !Object.values(d.rules).every(isStr)) err('rules: object of strings, each citing its clause');
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
