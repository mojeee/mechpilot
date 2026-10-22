// Vector PDF export of sheets: the display primitives of shared/draw/primitives.ts written as PDF
// paths and text, in black, at true scale (product rule 1: 1 mm on paper is 1 mm in the PDF, the
// mm → pt factor is the exact 72/25.4 and coordinates are written with full double precision).
// Pure TypeScript on top of pdf-lib (MIT): no Electron, no DOM, so it runs in the main process,
// the renderer or a worker. Text uses Helvetica, one of the 14 standard PDF fonts, so nothing is
// embedded; its metrics come from pdf-lib's copy of the Adobe AFM files.

import {
  LineCapStyle,
  LineJoinStyle,
  PDFContentStream,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFDict,
  type PDFObject,
  type PDFOperator,
  StandardFontEmbedder,
  StandardFonts,
  appendBezierCurve,
  beginText,
  closePath,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setDashPattern,
  setFillingGrayscaleColor,
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingGrayscaleColor,
  setTextMatrix,
  showText,
  stroke,
} from 'pdf-lib';
import type { Prim } from '../draw/primitives';
import { ellipsePoints } from '../geometry/flatten';
import { normAngle, type Vec2 } from '../geometry/vec2';

/** Points per millimetre: 1 pt = 1/72 in and 1 in = 25.4 mm exactly. Never rounded. */
export const MM_TO_PT = 72 / 25.4;

/**
 * The thinnest line drawn for a primitive of width 0: 0.13 mm, the smallest line width of the
 * ISO 128-2:2020 series, clause 5.1 Line width ("0,13 mm; 0,18 mm; 0,25 mm; 0,35 mm; 0,5 mm;
 * 0,7 mm; 1 mm; 1,4 mm; 2 mm"), verified on the standard's text (docs/to-verify.md).
 */
export const MIN_LINE_WIDTH_MM = 0.13;

/** Maximum distance in mm between a drawn arc or ellipse and the true curve. */
export const CURVE_TOLERANCE_MM = 0.005;

/**
 * Helvetica cap height as a fraction of the em: CapHeight 718 in Adobe's Helvetica AFM
 * (Core14 metrics, as shipped by pdf-lib). A text of cap height h mm is set at h / 0.718 mm.
 */
export const HELVETICA_CAP_HEIGHT = 718 / 1000;

/** CreationDate and ModDate of a deterministic export (so tests and CI can compare bytes). */
export const DETERMINISTIC_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

/** One sheet: paper size in mm, primitives in paper mm with the origin bottom-left and y up. */
export interface PdfPage {
  width: number;
  height: number;
  prims: Prim[];
  /** Shown as the page label in PDF viewers (e.g. "Sheet 1"). */
  title?: string;
}

export interface PdfOptions {
  /** Document title; defaults to the first page's title. */
  title?: string;
  author?: string;
  /** The producing application, e.g. "MechPilot 0.2.0" (the caller knows the version). */
  creator?: string;
  /**
   * Byte-identical output for identical input: fixed dates, no object streams and (unless
   * `compress` says otherwise) uncompressed content streams.
   */
  deterministic?: boolean;
  /** Flate-compress the content streams. Default: true, false in deterministic mode. */
  compress?: boolean;
  /** CreationDate and ModDate when not deterministic (default: now). */
  date?: Date;
}

// ---------------------------------------------------------------------------------------------
// Font metrics and text encoding

type EmbedderFontName = Parameters<typeof StandardFontEmbedder.for>[0];
let helvetica: StandardFontEmbedder | null = null;
/** pdf-lib's Helvetica metrics and WinAnsi encoding, loaded once (synchronous). */
function helv(): StandardFontEmbedder {
  helvetica ??= StandardFontEmbedder.for(StandardFonts.Helvetica as string as EmbedderFontName);
  return helvetica;
}

/** Characters with a WinAnsi equivalent that drawings use; anything else not encodable is "?". */
const SUBSTITUTES: Record<string, string> = {
  '−': '-', // minus sign
  '⌀': 'Ø', // diameter sign ⌀ → Ø (as the DXF writer does with %%c)
  'μ': 'µ', // Greek small mu → micro sign µ
  ' ': ' ', // figure space
  ' ': ' ', // thin space
  ' ': ' ', // narrow no-break space
};

/** The text as Helvetica can show it (WinAnsi): known substitutes, then "?" for the rest. */
export function pdfSafeText(text: string): string {
  const enc = helv().encoding;
  let out = '';
  for (const ch of text) {
    const c = SUBSTITUTES[ch] ?? ch;
    const cp = c.codePointAt(0);
    out += cp !== undefined && enc.canEncodeUnicodeCodePoint(cp) ? c : '?';
  }
  return out;
}

/** WinAnsi codes and the total advance width (1/1000 em) of a text already made safe. */
function encode(safe: string): { hex: string; advance: number } {
  const { font, encoding } = helv();
  let hex = '';
  let advance = 0;
  for (const ch of safe) {
    const g = encoding.encodeUnicodeCodePoint(ch.codePointAt(0) ?? 63);
    hex += g.code.toString(16).padStart(2, '0');
    const w = font.getWidthOfGlyph(g.name);
    advance += typeof w === 'number' ? w : 0;
  }
  return { hex, advance };
}

/** Font size in mm (the em) for a cap height in mm. */
export const fontSizeForCapHeight = (heightMm: number): number => heightMm / HELVETICA_CAP_HEIGHT;

/**
 * Width in mm of a single-line Helvetica text whose cap height is `heightMm`: the sum of the
 * glyph advance widths, without kerning, exactly as the PDF `Tj` operator places them.
 */
export function textWidthMm(text: string, heightMm: number): number {
  return (encode(pdfSafeText(text)).advance / 1000) * fontSizeForCapHeight(heightMm);
}

// ---------------------------------------------------------------------------------------------
// Curves

export interface Cubic {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

/**
 * Largest radial distance between a circular arc of radius r and angle θ and its cubic Bézier
 * with handles k = 4/3·tan(θ/4): r · 2·sin⁶(θ/4) / (27·cos²(θ/4)) (Goldapp 1991, "Approximation
 * of circular arcs by cubic polynomials").
 */
export function bezierArcError(radius: number, theta: number): number {
  const s = Math.sin(theta / 4);
  const c = Math.cos(theta / 4);
  return (radius * 2 * s ** 6) / (27 * c * c);
}

/**
 * Cubic Béziers for the counter-clockwise arc from `start` to `end` (radians; equal angles mean
 * the full circle, as arcPoints does), each at most 90° and within `tol` mm of the circle.
 */
export function arcBeziers(center: Vec2, radius: number, start: number, end: number, tol = CURVE_TOLERANCE_MM): Cubic[] {
  if (!(radius > 0)) return [];
  let span = normAngle(end - start);
  if (span === 0) span = Math.PI * 2;
  let n = Math.max(1, Math.ceil(span / (Math.PI / 2) - 1e-9));
  while (n < 100000 && bezierArcError(radius, span / n) > tol) n++;
  const theta = span / n;
  const k = (4 / 3) * Math.tan(theta / 4) * radius;
  const at = (a: number): Vec2 => ({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = start + theta * i;
    const a1 = i === n - 1 ? start + span : start + theta * (i + 1);
    const p0 = at(a0);
    const p3 = at(a1);
    out.push({
      p0,
      p1: { x: p0.x - k * Math.sin(a0), y: p0.y + k * Math.cos(a0) },
      p2: { x: p3.x + k * Math.sin(a1), y: p3.y - k * Math.cos(a1) },
      p3,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Primitives → content stream operators (coordinates converted mm → pt)

const pt = (mm: number): number => mm * MM_TO_PT;
const FONT_KEY = 'F1';

function strokeStyle(ops: PDFOperator[], width: number, dash: number[] | undefined): void {
  ops.push(setLineWidth(pt(width > 0 ? width : MIN_LINE_WIDTH_MM)));
  // A dash array with a negative or non-finite entry, or only zeros, is drawn solid (as Canvas 2D
  // ignores it); the PDF reference forbids an all-zero array.
  const valid = dash !== undefined && dash.length > 0 && dash.every((d) => Number.isFinite(d) && d >= 0) && dash.some((d) => d > 0);
  ops.push(setDashPattern(valid ? dash.map(pt) : [], 0));
}

function pathOfPoints(ops: PDFOperator[], points: Vec2[], closed: boolean): boolean {
  if (points.length < 2) return false;
  ops.push(moveTo(pt(points[0].x), pt(points[0].y)));
  for (let i = 1; i < points.length; i++) ops.push(lineTo(pt(points[i].x), pt(points[i].y)));
  if (closed) ops.push(closePath());
  return true;
}

function pathOfBeziers(ops: PDFOperator[], curves: Cubic[], closed: boolean): boolean {
  if (curves.length === 0) return false;
  ops.push(moveTo(pt(curves[0].p0.x), pt(curves[0].p0.y)));
  for (const c of curves) ops.push(appendBezierCurve(pt(c.p1.x), pt(c.p1.y), pt(c.p2.x), pt(c.p2.y), pt(c.p3.x), pt(c.p3.y)));
  if (closed) ops.push(closePath());
  return true;
}

function primOps(p: Prim, ops: PDFOperator[]): void {
  switch (p.kind) {
    case 'polyline':
      if (p.points.length < 2) return;
      strokeStyle(ops, p.width, p.dash);
      pathOfPoints(ops, p.points, p.closed);
      ops.push(stroke());
      return;
    case 'arc': {
      const full = normAngle(p.end - p.start) === 0;
      if (!(p.radius > 0)) return;
      strokeStyle(ops, p.width, p.dash);
      pathOfBeziers(ops, arcBeziers(p.center, p.radius, p.start, p.end), full);
      ops.push(stroke());
      return;
    }
    case 'circle':
      if (!(p.radius > 0)) return;
      strokeStyle(ops, p.width, p.dash);
      pathOfBeziers(ops, arcBeziers(p.center, p.radius, 0, 0), true);
      ops.push(stroke());
      return;
    case 'polygon':
      if (p.points.length < 3) return;
      pathOfPoints(ops, p.points, true);
      ops.push(fill());
      return;
    case 'ellipse': {
      if (!(Math.hypot(p.major.x, p.major.y) > 0)) return;
      const full = normAngle(p.end - p.start) === 0;
      const pts = ellipsePoints({ type: 'ellipse', id: '', layer: '', center: p.center, major: p.major, ratio: p.ratio, start: p.start, end: p.end }, CURVE_TOLERANCE_MM);
      strokeStyle(ops, p.width, p.dash);
      pathOfPoints(ops, full ? pts.slice(0, -1) : pts, full);
      ops.push(stroke());
      return;
    }
    case 'text': {
      if (!(p.height > 0)) return;
      const safe = pdfSafeText(p.text);
      if (safe.length === 0) return;
      const sizeMm = fontSizeForCapHeight(p.height);
      const { hex, advance } = encode(safe);
      const widthMm = (advance / 1000) * sizeMm;
      const dx = p.align === 'center' ? -widthMm / 2 : p.align === 'right' ? -widthMm : 0;
      const c = Math.cos(p.rotation);
      const s = Math.sin(p.rotation);
      // The baseline start: `position` moved by dx along the rotated baseline.
      const ox = p.position.x + dx * c;
      const oy = p.position.y + dx * s;
      ops.push(
        beginText(),
        setFontAndSize(FONT_KEY, pt(sizeMm)),
        setTextMatrix(c, s, -s, c, pt(ox), pt(oy)),
        showText(PDFHexString.of(hex)),
        endText(),
      );
      return;
    }
  }
}

/** The content-stream operators of one page (exported for tests and previews). */
export function pageOperators(prims: Prim[]): PDFOperator[] {
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    // Everything black (colours and layers are a screen aid; the printed sheet is black).
    setStrokingGrayscaleColor(0),
    setFillingGrayscaleColor(0),
    // As the Canvas 2D renderer draws: butt caps, round joins.
    setLineCap(LineCapStyle.Butt),
    setLineJoin(LineJoinStyle.Round),
  ];
  for (const p of prims) primOps(p, ops);
  ops.push(popGraphicsState());
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Document

/** A PDF with one page per sheet. Throws only on invalid input (no pages, non-positive size). */
export async function pdfFromPages(pages: PdfPage[], opts: PdfOptions = {}): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('pdfFromPages: no pages to export');
  const deterministic = opts.deterministic === true;
  const compress = opts.compress ?? !deterministic;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;

  const title = opts.title ?? pages[0].title;
  if (title !== undefined) doc.setTitle(title, { showInWindowTitleBar: true });
  if (opts.author !== undefined) doc.setAuthor(opts.author);
  doc.setCreator(opts.creator ?? 'MechPilot');
  doc.setProducer('pdf-lib');
  const date = deterministic ? DETERMINISTIC_DATE : (opts.date ?? new Date());
  doc.setCreationDate(date);
  doc.setModificationDate(date);

  // One font dictionary shared by every page: /Type1 /Helvetica /WinAnsiEncoding, not embedded.
  const fontRef = helv().embedIntoContext(ctx);

  for (const sheet of pages) {
    if (!(sheet.width > 0 && sheet.height > 0)) throw new Error(`pdfFromPages: invalid paper size ${sheet.width} × ${sheet.height} mm`);
    const page = doc.addPage([pt(sheet.width), pt(sheet.height)]);
    page.node.setFontDictionary(PDFName.of(FONT_KEY), fontRef);
    const stream = PDFContentStream.of(ctx.obj({}), pageOperators(sheet.prims), compress);
    page.node.addContentStream(ctx.register(stream));
  }

  // Page labels (PDF 1.7, 12.4.2): a sheet title shows in the viewer's page box.
  if (pages.some((p) => p.title !== undefined)) {
    const nums: (number | PDFObject)[] = [];
    pages.forEach((p, i) => {
      const label: PDFDict = p.title !== undefined ? ctx.obj({ P: PDFHexString.fromText(p.title) }) : ctx.obj({ S: 'D', St: i + 1 });
      nums.push(i, label);
    });
    doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: ctx.obj(nums) }));
  }

  return doc.save({ useObjectStreams: !deterministic, addDefaultPage: false, updateFieldAppearances: false });
}
