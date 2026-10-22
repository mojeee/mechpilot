// Dimensions and annotation symbols as display primitives, to ISO 129-1 (dimensioning), ISO 3098
// (lettering), ISO 1101 (geometrical tolerances) and ISO 21920-1 (surface texture). The same
// primitives are drawn on screen and in the PDF, so what is printed is what is seen.
//
// Sizes in the dimension style are paper mm; here they are divided by the annotation scale so a
// drawing meant for a 1:2 view keeps 3.5 mm lettering on paper (ISO 129-1 asks for the same
// lettering height on the sheet whatever the scale).

import type { AnnotationEntity, DimensionEntity, DimStyle, Tolerance } from '../doc/types';
import { add, angleOf, dist, dot, fromAngle, normAngle, normalize, perp, scale, sub, type Vec2 } from '../geometry/vec2';
import { textWidth, type Prim } from './primitives';

export interface AnnotationCtx {
  style: DimStyle;
  /** Deviations in mm for an ISO 286 class at a nominal size, from the library; null when unknown. */
  fit?: (cls: string, nominal: number) => { upper: number; lower: number } | null;
  /** ISO drawings write a comma as the decimal marker (ISO 129-1:2018, 4.1.1); ASME a point. */
  standard?: 'iso' | 'asme';
}

/** ISO 129-1:2018, Table 1: the diameter indicator is the DIAMETER SIGN U+2300 (not the letter Ø). */
export const DIAMETER_SIGN = '⌀';

/**
 * Default dimension style (library/dimensioning/iso-129-1.json and library/lettering/iso-3098.json):
 * - lettering 3.5 mm, ISO 3098 type B (ISO 3098-0:1997, 5.3 range of nominal sizes);
 * - closed filled arrowhead, included angle 30°, length h = the lettering height
 *   (ISO 129-1:2004, 5.3.2, Figure 11 and Annex A, Figure A.1);
 * - extension lines overshoot the dimension line by about 8 × the line width: 8 × 0.25 mm = 2 mm
 *   (ISO 129-1:2004, 5.4); the gap between the feature and the extension line is optional in the
 *   same clause, so the default is none;
 * - 2 decimals.
 */
export const DEFAULT_DIM_STYLE: DimStyle = {
  textHeight: 3.5,
  arrowSize: 3.5,
  extensionOvershoot: 2,
  extensionGap: 0,
  textGap: 1,
  decimals: 2,
  annotationScale: 1,
  arrowhead: 'closed-filled',
};

/** ISO 129-1:2004, 5.3.2: the closed filled arrowhead has an included angle of 30°. */
export const ARROW_INCLUDED_ANGLE = (30 * Math.PI) / 180;

/** Scaled style: paper mm → model mm. */
function model(style: DimStyle) {
  const k = 1 / style.annotationScale;
  return { h: style.textHeight * k, arrow: style.arrowSize * k, over: style.extensionOvershoot * k, gap: style.extensionGap * k, tgap: style.textGap * k, line: (0.25 * k) as number };
}

const fmt = (v: number, decimals: number): string => {
  const s = v.toFixed(decimals);
  // Keep the decimals the user asked for (ISO 129-1: tolerances with the same number of decimals),
  // but never show "-0.00".
  return s === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : s;
};
const signed = (v: number, decimals: number): string => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), decimals);

/** Direction of a dimension: exact axes for multiples of 90°, so "80" is not "80.000000000000005". */
function axis(rotation: number): Vec2 {
  const d = fromAngle(rotation);
  return { x: Math.abs(d.x) < 1e-15 ? 0 : d.x, y: Math.abs(d.y) < 1e-15 ? 0 : d.y };
}

/** The measured value: mm, or degrees for angular dimensions. */
export function dimensionValue(e: DimensionEntity): number {
  switch (e.kind) {
    case 'linear': {
      const dir = axis(e.rotation);
      return Math.abs(dot(sub(e.b, e.a), dir));
    }
    case 'aligned':
      return dist(e.a, e.b);
    case 'angular': {
      if (!e.center) return 0;
      const a1 = angleOf(sub(e.a, e.center));
      const a2 = angleOf(sub(e.b, e.center));
      return (normAngle(a2 - a1) * 180) / Math.PI;
    }
    case 'radius':
      return dist(e.a, e.b);
    case 'diameter':
      return 2 * dist(e.a, e.b);
    case 'ordinate': {
      const dir = axis(e.rotation);
      return dot(sub(e.b, e.a), dir);
    }
  }
}

export interface DimText {
  /** The main text, e.g. "Ø20 H7" or "45°". */
  main: string;
  /** Deviations written small, upper above lower, when a tolerance applies. */
  upper?: string;
  lower?: string;
}

/** The dimension text to ISO 129-1: prefix, value with the style's decimals, suffix, tolerance. */
export function dimensionText(e: DimensionEntity, ctx: AnnotationCtx): DimText {
  const decimals = e.decimals ?? ctx.style.decimals;
  const value = dimensionValue(e);
  // ISO 129-1:2018, 4.1.1: a comma is the decimal marker on ISO drawings; ASME uses a point.
  const marker = ctx.standard === 'asme' ? '.' : ',';
  const mark = (s: string) => s.replace('.', marker);
  // Nominal values drop trailing zeros ("80", "12,5"); deviations keep their decimals (below).
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  const number = mark(e.kind === 'angular' ? `${trim(fmt(value, Math.min(decimals, 2)))}°` : trim(fmt(value, decimals)));
  // ISO 129-1:2018, Table 1: ⌀ for a diameter, R for a radius, written before the value.
  const prefix = e.prefix ?? (e.kind === 'diameter' ? DIAMETER_SIGN : e.kind === 'radius' ? 'R' : '');
  let main = prefix + number + (e.suffix ?? '');
  if (e.text) main = e.text.replace('<>', prefix + number);
  const t = e.tolerance;
  if (!t || e.kind === 'angular') return { main };
  return withTolerance(main, t, value, decimals, ctx, mark);
}

function withTolerance(main: string, t: Tolerance, nominal: number, decimals: number, ctx: AnnotationCtx, mark: (s: string) => string): DimText {
  // ISO 129-1: deviations in the same unit as the value, the upper written above the lower, each
  // with its sign; a tolerance class (ISO 286) is written after the value, e.g. "⌀20 H7".
  const d = Math.max(decimals, 2);
  switch (t.kind) {
    case 'deviation':
      return { main, upper: mark(signed(t.upper, d)), lower: mark(signed(t.lower, d)) };
    case 'symmetric':
      return { main: `${main} ±${mark(fmt(t.value, d))}` };
    case 'limits':
      return { main: '', upper: mark(fmt(t.upper, d)), lower: mark(fmt(t.lower, d)) };
    case 'fit': {
      const dev = ctx.fit?.(t.cls, nominal) ?? null;
      if (!dev) return { main: `${main} ${t.cls}` };
      return { main: `${main} ${t.cls}`, upper: mark(signed(dev.upper, 3)), lower: mark(signed(dev.lower, 3)) };
    }
  }
}

/** ISO 129-1:2004, 5.3.2 arrowhead: closed filled, included angle 30°, length `size` (= h). */
function arrowhead(tip: Vec2, dir: Vec2, size: number, kind: DimStyle['arrowhead']): Prim[] {
  const d = normalize(dir);
  const n = perp(d);
  const half = size * Math.tan(ARROW_INCLUDED_ANGLE / 2);
  const base = sub(tip, scale(d, size));
  switch (kind) {
    case 'closed-filled':
      return [{ kind: 'polygon', points: [tip, add(base, scale(n, half)), add(base, scale(n, -half))] }];
    case 'open':
      return [{ kind: 'polyline', points: [add(base, scale(n, half)), tip, add(base, scale(n, -half))], closed: false, width: 0 }];
    case 'oblique': {
      const s = size / 2;
      const o = normalize(add(d, n));
      return [{ kind: 'polyline', points: [sub(tip, scale(o, s)), add(tip, scale(o, s))], closed: false, width: 0 }];
    }
    case 'dot':
      return [{ kind: 'circle', center: tip, radius: size / 4, width: 0 }];
  }
}

/** Text block for a dimension: main text centred on `at` along `dir`, deviations stacked after it. */
function dimTextPrims(txt: DimText, at: Vec2, dir: Vec2, h: number, rotation: number): { prims: Prim[]; width: number } {
  const prims: Prim[] = [];
  const mainW = txt.main ? textWidth(txt.main, h) : 0;
  const small = h * 0.7;
  const devW = txt.upper || txt.lower ? Math.max(textWidth(txt.upper ?? '', small), textWidth(txt.lower ?? '', small)) + h * 0.3 : 0;
  const total = mainW + devW;
  const d = normalize(dir);
  const n = perp(d);
  const start = sub(at, scale(d, total / 2));
  if (txt.main) prims.push({ kind: 'text', position: start, text: txt.main, height: h, rotation, align: 'left' });
  if (devW) {
    const x = add(start, scale(d, mainW + h * 0.3));
    if (txt.upper) prims.push({ kind: 'text', position: add(x, scale(n, h * 0.55)), text: txt.upper, height: small, rotation, align: 'left' });
    if (txt.lower) prims.push({ kind: 'text', position: add(x, scale(n, -h * 0.3)), text: txt.lower, height: small, rotation, align: 'left' });
  }
  return { prims, width: total };
}

/** Reading direction: text reads from the bottom or from the right (ISO 129-1), so flip when needed. */
function readable(angle: number): number {
  let a = normAngle(angle);
  if (a > Math.PI / 2 + 1e-9 && a <= (3 * Math.PI) / 2 + 1e-9) a = normAngle(a + Math.PI);
  return a;
}

function linearPrims(e: DimensionEntity, ctx: AnnotationCtx): Prim[] {
  const m = model(ctx.style);
  const dir = e.kind === 'aligned' ? normalize(sub(e.b, e.a)) : fromAngle(e.rotation);
  const n = perp(dir);
  // Offset of the dimension line from a, measured along the normal.
  const off = dot(sub(e.position, e.a), n);
  const p1 = add(e.a, scale(n, off));
  const p2 = add(e.b, scale(n, off - dot(sub(e.b, e.a), n)));
  const sign = off >= 0 ? 1 : -1;
  const prims: Prim[] = [];
  // Projection (extension) lines: from a gap off the outline to the overshoot past the dimension line.
  for (const [p, q] of [
    [e.a, p1],
    [e.b, p2],
  ] as [Vec2, Vec2][]) {
    const len = dist(p, q);
    if (len <= m.gap) continue;
    const u = normalize(sub(q, p));
    prims.push({ kind: 'polyline', points: [add(p, scale(u, m.gap)), add(q, scale(u, m.over))], closed: false, width: m.line });
  }
  const length = dist(p1, p2);
  const inside = length > 2 * m.arrow + m.h;
  const txt = dimensionText(e, ctx);
  const angle = readable(angleOf(dir));
  const flip = Math.abs(normAngle(angleOf(dir)) - angle) > 1e-9;
  const tdir = flip ? scale(dir, -1) : dir;
  const tn = perp(tdir);
  const mid = scale(add(p1, p2), 0.5);
  if (inside) {
    prims.push({ kind: 'polyline', points: [p1, p2], closed: false, width: m.line });
    prims.push(...arrowhead(p1, sub(p1, p2), m.arrow, ctx.style.arrowhead), ...arrowhead(p2, sub(p2, p1), m.arrow, ctx.style.arrowhead));
    prims.push(...dimTextPrims(txt, add(mid, scale(tn, m.tgap + (txt.upper ? m.h * 0.3 : 0))), tdir, m.h, angle).prims);
  } else {
    // Too short: arrows outside, text beside.
    const ext = m.arrow * 2;
    prims.push({ kind: 'polyline', points: [sub(p1, scale(dir, ext)), add(p2, scale(dir, ext))], closed: false, width: m.line });
    prims.push(...arrowhead(p1, sub(p1, sub(p1, scale(dir, 1))), m.arrow, ctx.style.arrowhead), ...arrowhead(p2, sub(p2, add(p2, scale(dir, 1))), m.arrow, ctx.style.arrowhead));
    const t = dimTextPrims(txt, add(add(p2, scale(dir, ext + m.h)), scale(tn, m.tgap)), tdir, m.h, angle);
    prims.push(...t.prims);
  }
  void sign;
  return prims;
}

function angularPrims(e: DimensionEntity, ctx: AnnotationCtx): Prim[] {
  if (!e.center) return [];
  const m = model(ctx.style);
  const c = e.center;
  const r = dist(e.position, c);
  const a1 = angleOf(sub(e.a, c));
  const a2 = angleOf(sub(e.b, c));
  const span = normAngle(a2 - a1);
  const prims: Prim[] = [];
  // Extension lines along the legs out to the arc (with overshoot) when the arc is beyond the points.
  for (const [p, ang] of [
    [e.a, a1],
    [e.b, a2],
  ] as [Vec2, number][]) {
    const dp = dist(p, c);
    if (r > dp + m.gap) prims.push({ kind: 'polyline', points: [add(c, fromAngle(ang, dp + m.gap)), add(c, fromAngle(ang, r + m.over))], closed: false, width: m.line });
  }
  prims.push({ kind: 'arc', center: c, radius: r, start: a1, end: a2, width: m.line });
  // Arrowheads tangent to the arc at both ends.
  const t1 = add(c, fromAngle(a1, r));
  const t2 = add(c, fromAngle(a2, r));
  const arrowAngle = m.arrow / r;
  prims.push(...arrowhead(t1, sub(t1, add(c, fromAngle(a1 + arrowAngle, r))), m.arrow, ctx.style.arrowhead));
  prims.push(...arrowhead(t2, sub(t2, add(c, fromAngle(a2 - arrowAngle, r))), m.arrow, ctx.style.arrowhead));
  const midAng = a1 + span / 2;
  const tangent = perp(fromAngle(midAng));
  const angle = readable(angleOf(tangent));
  const tdir = fromAngle(angle);
  const tn = perp(tdir);
  const txt = dimensionText(e, ctx);
  prims.push(...dimTextPrims(txt, add(add(c, fromAngle(midAng, r)), scale(tn, m.tgap)), tdir, m.h, angle).prims);
  return prims;
}

function radialPrims(e: DimensionEntity, ctx: AnnotationCtx): Prim[] {
  const m = model(ctx.style);
  const r = dist(e.a, e.b);
  const dir = normalize(sub(e.position, e.a));
  const onCurve = add(e.a, scale(dir, r));
  const prims: Prim[] = [];
  const txt = dimensionText(e, ctx);
  const outside = dist(e.position, e.a) > r;
  // Leader from the curve to the text position, arrow on the curve (ISO 129-1: the dimension line
  // of a radius passes through the centre; of a diameter, through the centre with two arrows).
  if (e.kind === 'diameter' && !outside) {
    const p1 = add(e.a, scale(dir, -r));
    prims.push({ kind: 'polyline', points: [p1, onCurve], closed: false, width: m.line });
    prims.push(...arrowhead(onCurve, dir, m.arrow, ctx.style.arrowhead), ...arrowhead(p1, scale(dir, -1), m.arrow, ctx.style.arrowhead));
  } else {
    const from = e.kind === 'radius' && !outside ? e.a : onCurve;
    prims.push({ kind: 'polyline', points: [from, e.position], closed: false, width: m.line });
    prims.push(...arrowhead(onCurve, outside ? scale(dir, -1) : dir, m.arrow, ctx.style.arrowhead));
  }
  // Text at the position, horizontal, with a short shoulder when outside.
  const side = dir.x >= 0 ? 1 : -1;
  const shoulderEnd = add(e.position, { x: side * m.h * 1.5, y: 0 });
  if (outside) prims.push({ kind: 'polyline', points: [e.position, shoulderEnd], closed: false, width: m.line });
  const at = outside ? add(e.position, { x: (side * (textWidth(txt.main, m.h) + m.h * 1.5)) / 2 + (side > 0 ? 0 : 0), y: m.tgap }) : add(e.position, { x: 0, y: m.tgap });
  prims.push(...dimTextPrims(txt, outside ? add(e.position, { x: side * (m.h * 1.5 + textWidth(txt.main, m.h) / 2), y: m.tgap }) : at, { x: 1, y: 0 }, m.h, 0).prims);
  return prims;
}

function ordinatePrims(e: DimensionEntity, ctx: AnnotationCtx): Prim[] {
  const m = model(ctx.style);
  const dir = fromAngle(e.rotation); // measured direction
  const n = perp(dir); // the leader runs along the normal, away from the feature
  const prims: Prim[] = [];
  const txt = dimensionText(e, ctx);
  // Leader: from the point (after a gap), along n to the position, with a dog-leg when the position is offset.
  const start = add(e.b, scale(n, m.gap * Math.sign(dot(sub(e.position, e.b), n)) || 1));
  const along = dot(sub(e.position, e.b), n);
  const knee = add(e.b, scale(n, along * 0.7));
  prims.push({ kind: 'polyline', points: [start, knee, e.position], closed: false, width: m.line });
  const angle = readable(angleOf(n));
  prims.push(...dimTextPrims(txt, add(e.position, scale(fromAngle(angle), textWidth(txt.main, m.h) / 2 + m.h * 0.3)), fromAngle(angle), m.h, angle).prims);
  return prims;
}

export function dimensionPrims(e: DimensionEntity, ctx: AnnotationCtx): Prim[] {
  switch (e.kind) {
    case 'linear':
    case 'aligned':
      return linearPrims(e, ctx);
    case 'angular':
      return angularPrims(e, ctx);
    case 'radius':
    case 'diameter':
      return radialPrims(e, ctx);
    case 'ordinate':
      return ordinatePrims(e, ctx);
  }
}

/** Multi-line text block primitives, lines stacked downwards from `position` (baseline of line 1). */
function textLines(text: string, position: Vec2, height: number, rotation: number, align: 'left' | 'center' | 'right'): Prim[] {
  const lines = text.split('\n');
  const down = scale(perp(fromAngle(rotation)), -height * 1.6);
  return lines.map((line, i) => ({ kind: 'text', position: add(position, scale(down, i)), text: line, height, rotation, align }));
}

function leaderPrims(points: Vec2[], arrow: number, line: number, kind: DimStyle['arrowhead']): Prim[] {
  if (points.length < 2) return [];
  return [{ kind: 'polyline', points, closed: false, width: line }, ...arrowhead(points[0], sub(points[0], points[1]), arrow, kind)];
}

export function annotationPrims(e: AnnotationEntity, ctx: AnnotationCtx): Prim[] {
  const m = model(ctx.style);
  switch (e.type) {
    case 'dimension':
      return dimensionPrims(e, ctx);
    case 'note': {
      const prims = textLines(e.text, e.position, e.height, e.rotation, 'left');
      if (e.leader && e.leader.length) prims.push(...leaderPrims([...e.leader, add(e.position, { x: -m.h * 0.5, y: e.height * 0.4 })], m.arrow, m.line, ctx.style.arrowhead));
      return prims;
    }
    case 'balloon': {
      // Balloon: a circle of about 2 × lettering height around the item number, leader to the part.
      const r = m.h * 1.1;
      const dir = normalize(sub(e.leader, e.position));
      const edge = add(e.position, scale(dir, r));
      return [{ kind: 'circle', center: e.position, radius: r, width: m.line }, ...leaderPrims([e.leader, edge], m.arrow, m.line, ctx.style.arrowhead), { kind: 'text', position: add(e.position, { x: 0, y: -m.h / 2 }), text: e.text, height: m.h, rotation: 0, align: 'center' }];
    }
    case 'surface': {
      // ISO 21920-1 basic graphical symbol: two legs from the tip, the short one at 60° to the
      // surface, the long one about twice as high; a circle in the vee for "removal prohibited",
      // a bar across the long leg for "removal required". Proportions follow the lettering height h:
      // short leg 1.4 h? The exact ratios are in docs/to-verify.md; MechPilot uses short = 1.4 h,
      // long = 3 h (legs at 60°), which match the usual drawings.
      const h = m.h;
      const u = fromAngle(e.rotation); // along the surface
      const v = perp(u); // away from the surface (into the free side)
      const leg = (len: number, ang: number) => add(e.position, add(scale(u, len * Math.cos(ang)), scale(v, len * Math.sin(ang))));
      const short = 1.4 * h;
      const long = 3 * h;
      const a60 = Math.PI / 3;
      const left = leg(short / Math.sin(a60), Math.PI - a60); // up-left at 60°
      const right = leg(long / Math.sin(a60), a60); // up-right at 60°
      const prims: Prim[] = [{ kind: 'polyline', points: [left, e.position, right], closed: false, width: m.line }];
      if (e.removal === 'prohibited') {
        const cc = leg(short / Math.sin(a60) / 2, Math.PI / 2);
        prims.push({ kind: 'circle', center: add(e.position, scale(v, short / 2)), radius: short / 2.6, width: m.line });
        void cc;
      }
      if (e.removal === 'required') {
        const b = leg(short / Math.sin(a60), Math.PI - a60);
        prims.push({ kind: 'polyline', points: [b, add(b, scale(u, short / Math.tan(a60) * 2))], closed: false, width: m.line });
      }
      // Roughness and extra text go to the right of the long leg's top, on a horizontal extension line.
      const top = right;
      const label = [e.ra !== undefined ? `Ra ${e.ra}` : '', e.text ?? ''].filter(Boolean).join('  ');
      if (label) {
        const ext = add(top, scale(u, textWidth(label, h) + h));
        prims.push({ kind: 'polyline', points: [top, ext], closed: false, width: m.line });
        prims.push({ kind: 'text', position: add(add(top, scale(u, h * 0.5)), scale(v, h * 0.3)), text: label, height: h, rotation: e.rotation, align: 'left' });
      }
      if (e.leader) prims.push(...leaderPrims([e.leader, e.position], m.arrow, m.line, ctx.style.arrowhead));
      return prims;
    }
    case 'gdt': {
      // ISO 1101 frame: height 2 h, compartments: symbol (square), tolerance, datums (square each).
      const h = m.h;
      const H = 2 * h;
      const u = fromAngle(e.rotation);
      const v = perp(u);
      const widths = [H, Math.max(textWidth(e.tolerance, h) + h, H), ...e.datums.map(() => H)];
      const total = widths.reduce((p, q) => p + q, 0);
      const prims: Prim[] = [];
      const box = (x0: number, w: number) => [add(e.position, scale(u, x0)), add(e.position, add(scale(u, x0 + w), scale(v, 0))), add(e.position, add(scale(u, x0 + w), scale(v, H))), add(e.position, add(scale(u, x0), scale(v, H)))];
      let x = 0;
      const texts = ['', e.tolerance, ...e.datums];
      widths.forEach((w, i) => {
        prims.push({ kind: 'polyline', points: box(x, w), closed: true, width: m.line });
        if (i === 0) {
          // The characteristic symbol is drawn as lines, not as a font glyph: fonts rarely have
          // the ISO 1101 symbols, on screen or in PDF readers.
          prims.push(...gdtSymbolPrims(e.characteristic, add(e.position, add(scale(u, w / 2), scale(v, H / 2))), h, e.rotation, m.line));
        } else prims.push({ kind: 'text', position: add(e.position, add(scale(u, x + w / 2), scale(v, H / 2 - h / 2))), text: texts[i], height: h, rotation: e.rotation, align: 'center' });
        x += w;
      });
      void total;
      if (e.leader) prims.push(...leaderPrims([e.leader, add(e.position, scale(v, H / 2))], m.arrow, m.line, ctx.style.arrowhead));
      return prims;
    }
    case 'datum': {
      // Datum indicator: filled triangle on the feature (base on the surface), a stem and the
      // letter in a square frame of side 2 h.
      const h = m.h;
      const u = fromAngle(e.rotation);
      const v = perp(u);
      const tri = [e.position, add(e.position, add(scale(u, h * 0.9), scale(v, h * 1.2))), add(e.position, add(scale(u, -h * 0.9), scale(v, h * 1.2)))];
      const stemTop = add(e.position, scale(v, h * 1.2 + h));
      const side = 2 * h;
      const frame = [add(stemTop, scale(u, -side / 2)), add(stemTop, scale(u, side / 2)), add(stemTop, add(scale(u, side / 2), scale(v, side))), add(stemTop, add(scale(u, -side / 2), scale(v, side)))];
      // The letter always reads upright: the frame turns with the feature, the lettering does not
      // (ISO 1101 shows datum letters upright whatever the direction of the indicator).
      const centre = add(stemTop, scale(v, side / 2));
      return [
        { kind: 'polygon', points: tri },
        { kind: 'polyline', points: [add(e.position, scale(v, h * 1.2)), stemTop], closed: false, width: m.line },
        { kind: 'polyline', points: frame, closed: true, width: m.line },
        { kind: 'text', position: add(centre, { x: 0, y: -h / 2 }), text: e.label, height: h, rotation: 0, align: 'center' },
      ];
    }
  }
}

/** ISO 1101 characteristic symbols (Unicode); the library file carries names and datum rules. */
export const GDT_SYMBOLS: Record<string, string> = {
  straightness: '⏤',
  flatness: '⏥',
  roundness: '○',
  cylindricity: '⌭',
  'line-profile': '⌒',
  'surface-profile': '⌓',
  parallelism: '∥',
  perpendicularity: '⟂',
  angularity: '∠',
  position: '⌖',
  concentricity: '◎',
  symmetry: '⌯',
  'circular-runout': '↗',
  'total-runout': '⌰',
};
/**
 * ISO 1101 Table 2 characteristic symbols as line drawings in a square of side `h` centred at
 * `c`, turned by `rotation`. Local coordinates are fractions of h: x along the frame, y up.
 */
export function gdtSymbolPrims(id: string, c: Vec2, h: number, rotation: number, line: number): Prim[] {
  const u = fromAngle(rotation);
  const v = perp(u);
  const L = (x: number, y: number): Vec2 => add(c, add(scale(u, x * h), scale(v, y * h)));
  const seg = (x0: number, y0: number, x1: number, y1: number): Prim => ({ kind: 'polyline', points: [L(x0, y0), L(x1, y1)], closed: false, width: line });
  const circ = (r: number, cx = 0, cy = 0): Prim => ({ kind: 'circle', center: L(cx, cy), radius: r * h, width: line });
  const arrow = (x0: number, y0: number, x1: number, y1: number): Prim[] => {
    const tip = L(x1, y1);
    const d = normalize(sub(tip, L(x0, y0)));
    const n = perp(d);
    const size = 0.3 * h;
    const base = sub(tip, scale(d, size));
    return [seg(x0, y0, x1, y1), { kind: 'polygon', points: [tip, add(base, scale(n, size * 0.35)), add(base, scale(n, -size * 0.35))] }];
  };
  switch (id) {
    case 'straightness':
      return [seg(-0.45, 0, 0.45, 0)];
    case 'flatness':
      return [{ kind: 'polyline', points: [L(-0.45, -0.25), L(0.25, -0.25), L(0.45, 0.25), L(-0.25, 0.25)], closed: true, width: line }];
    case 'roundness':
      return [circ(0.4)];
    case 'cylindricity':
      return [circ(0.3), seg(-0.3, -0.45, -0.3, 0.45), seg(0.3, -0.45, 0.3, 0.45)];
    case 'line-profile':
      return [{ kind: 'arc', center: L(0, -0.1), radius: 0.4 * h, start: rotation, end: rotation + Math.PI, width: line }];
    case 'surface-profile':
      return [{ kind: 'arc', center: L(0, -0.1), radius: 0.4 * h, start: rotation, end: rotation + Math.PI, width: line }, seg(-0.4, -0.1, 0.4, -0.1)];
    case 'parallelism':
      return [seg(-0.35, -0.4, -0.05, 0.4), seg(0.05, -0.4, 0.35, 0.4)];
    case 'perpendicularity':
      return [seg(-0.45, -0.4, 0.45, -0.4), seg(0, -0.4, 0, 0.4)];
    case 'angularity':
      return [seg(-0.45, -0.4, 0.45, -0.4), seg(-0.45, -0.4, 0.3, 0.35)];
    case 'position':
      return [circ(0.3), seg(-0.45, 0, 0.45, 0), seg(0, -0.45, 0, 0.45)];
    case 'concentricity':
      return [circ(0.2), circ(0.4)];
    case 'symmetry':
      return [seg(-0.45, 0, 0.45, 0), seg(-0.3, 0.3, 0.3, 0.3), seg(-0.3, -0.3, 0.3, -0.3)];
    case 'circular-runout':
      return arrow(-0.35, -0.4, 0.3, 0.35);
    case 'total-runout':
      return [...arrow(-0.4, -0.4, 0.05, 0.35), ...arrow(0, -0.4, 0.45, 0.35), seg(-0.4, -0.4, 0, -0.4)];
    default:
      return [{ kind: 'text', position: L(-0.3, -0.35), text: GDT_SYMBOLS[id] ?? '?', height: h * 0.7, rotation, align: 'left' }];
  }
}
