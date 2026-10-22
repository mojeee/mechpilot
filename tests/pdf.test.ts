import { describe, expect, it } from 'vitest';
import {
  CURVE_TOLERANCE_MM,
  HELVETICA_CAP_HEIGHT,
  MIN_LINE_WIDTH_MM,
  MM_TO_PT,
  arcBeziers,
  bezierArcError,
  pdfFromPages,
  pdfSafeText,
  textWidthMm,
  type PdfPage,
} from '@shared/pdf';
import { PDFDocument, StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import type { Prim } from '@shared/draw/primitives';
import { vec, type Vec2 } from '@shared/geometry/vec2';

const latin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};
const num = '(-?[0-9.]+)';

/** A4 landscape with one primitive of every kind. */
function samplePage(): PdfPage {
  const prims: Prim[] = [
    { kind: 'polyline', points: [vec(10, 10), vec(110, 10)], closed: false, width: 0.5 },
    { kind: 'polyline', points: [vec(20, 20), vec(60, 20), vec(60, 50)], closed: true, width: 0, dash: [3, 1.5] },
    { kind: 'arc', center: vec(150, 100), radius: 30, start: 0, end: (3 * Math.PI) / 2, width: 0.35 },
    { kind: 'circle', center: vec(200, 100), radius: 12.5, width: 0.25 },
    { kind: 'polygon', points: [vec(100, 150), vec(103, 151), vec(100, 152)] },
    { kind: 'text', position: vec(30, 180), text: 'Ø20 H7 ±0.1 45° −0.02', height: 3.5, rotation: 0, align: 'left' },
    { kind: 'text', position: vec(200, 30), text: 'MechPilot', height: 5, rotation: Math.PI / 2, align: 'center' },
    { kind: 'ellipse', center: vec(250, 150), major: vec(20, 0), ratio: 0.5, start: 0, end: 0, width: 0.25 },
  ];
  return { width: 297, height: 210, prims, title: 'Sheet 1' };
}

async function render(pages: PdfPage[] = [samplePage()]): Promise<string> {
  return latin1(await pdfFromPages(pages, { title: 'Test', author: 'Tester', creator: 'MechPilot test', deterministic: true }));
}

describe('pdf export', () => {
  it('writes a PDF file', async () => {
    const pdf = await render();
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('sizes an A4 landscape page with the exact factor 72/25.4', async () => {
    const pdf = await render();
    const m = new RegExp(`/MediaBox \\[ ?0 0 ${num} ${num} ?\\]`).exec(pdf);
    expect(m).not.toBeNull();
    const [w, h] = [Number(m![1]), Number(m![2])];
    expect(w).toBeCloseTo((297 * 72) / 25.4, 6);
    expect(h).toBeCloseTo((210 * 72) / 25.4, 6);
    expect(w).toBeCloseTo(841.8897637795275, 9);
    expect(h).toBeCloseTo(595.2755905511812, 9);
    expect(MM_TO_PT).toBe(72 / 25.4);
  });

  it('draws a line at true scale in points', async () => {
    const pdf = await render();
    const m = new RegExp(`${num} ${num} m\\s+${num} ${num} l\\s+S`).exec(pdf);
    expect(m).not.toBeNull();
    const [x0, y0, x1, y1] = m!.slice(1, 5).map(Number);
    expect(x0).toBeCloseTo((10 * 72) / 25.4, 9);
    expect(y0).toBeCloseTo((10 * 72) / 25.4, 9);
    expect(x1).toBeCloseTo((110 * 72) / 25.4, 9);
    expect(y1).toBeCloseTo((10 * 72) / 25.4, 9);
    // Its width: 0.5 mm.
    expect(pdf).toMatch(new RegExp(`${String(0.5 * MM_TO_PT).replace('.', '\\.')} w`));
  });

  it('draws width 0 as the ISO 128-2 minimum and writes dashes in points', async () => {
    const pdf = await render();
    expect(pdf).toContain(`${MIN_LINE_WIDTH_MM * MM_TO_PT} w`);
    expect(pdf).toContain(`[${3 * MM_TO_PT} ${1.5 * MM_TO_PT}] 0 d`);
  });

  it('draws in black, with Bézier curves, a filled polygon and Helvetica text', async () => {
    const pdf = await render();
    expect(pdf).toMatch(/\b0 G\b/);
    expect(pdf).toMatch(/\b0 g\b/);
    expect(pdf).toMatch(/ c\n/); // curveto
    expect(pdf).toMatch(/\nf\n/); // fill
    expect(pdf).toMatch(/\/BaseFont \/Helvetica\b/);
    expect(pdf).toMatch(/\/Encoding \/WinAnsiEncoding/);
    expect(pdf).toMatch(/\/Font <<\s*\/F1 \d+ 0 R/);
    expect(pdf).not.toMatch(/\/FontFile/); // not embedded
    expect(pdf).toMatch(/\/F1 [0-9.]+ Tf/);
    expect(pdf).toMatch(/BT[\s\S]*?Tj\s+ET/);
  });

  it('sets the font size so the cap height equals the text height (3.5 mm → 3.5/0.718 mm)', async () => {
    const pdf = await render();
    const sizes = [...pdf.matchAll(/\/F1 ([0-9.]+) Tf/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBe(2);
    expect(sizes[0]).toBeCloseTo((3.5 / 0.718) * (72 / 25.4), 4);
    expect(HELVETICA_CAP_HEIGHT).toBe(0.718);
    // The value comes from pdf-lib's Helvetica metrics.
    const font = StandardFontEmbedder.for(StandardFonts.Helvetica as string as Parameters<typeof StandardFontEmbedder.for>[0]).font;
    expect(font.CapHeight).toBe(718);
  });

  it('writes a minus sign as a hyphen and keeps the WinAnsi drawing symbols', async () => {
    const pdf = await render();
    const hex = /<([0-9a-fA-F]+)> Tj/.exec(pdf);
    expect(hex).not.toBeNull();
    const text = hex![1].match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join('');
    expect(text).toBe('Ø20 H7 ±0.1 45° -0.02');
    expect(pdfSafeText('a−b')).toBe('a-b');
    expect(pdfSafeText('Ø ° ± × µ')).toBe('Ø ° ± × µ');
    expect(pdfSafeText('⌀10 μm')).toBe('Ø10 µm');
    expect(pdfSafeText('Ω中😀')).toBe('???');
  });

  it('does not throw on characters outside WinAnsi', async () => {
    const page: PdfPage = { width: 100, height: 100, prims: [{ kind: 'text', position: vec(5, 5), text: '∅ Ω ≤ 中 😀', height: 2.5, rotation: 0, align: 'right' }] };
    await expect(pdfFromPages([page])).resolves.toBeInstanceOf(Uint8Array);
  });

  it('gives byte-identical output for two deterministic runs', async () => {
    const a = await pdfFromPages([samplePage(), { ...samplePage(), title: 'Sheet 2' }], { title: 'X', deterministic: true });
    const b = await pdfFromPages([samplePage(), { ...samplePage(), title: 'Sheet 2' }], { title: 'X', deterministic: true });
    expect(a.length).toBe(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('writes one page per sheet, metadata and page labels', async () => {
    const pdf = await render([samplePage(), { width: 420, height: 297, prims: [] }]);
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBe(2);
    expect(pdf).toMatch(/\/Count 2/);
    expect(pdf).toMatch(/\/PageLabels/);
    // pdf-lib writes text strings as UTF-16BE hex with a byte-order mark.
    const utf16 = (s: string): string => 'FEFF' + [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
    expect(pdf).toContain(`/Creator <${utf16('MechPilot test')}>`);
    expect(pdf).toContain(`/Author <${utf16('Tester')}>`);
    expect(pdf).toContain(`/Title <${utf16('Test')}>`);
    expect(pdf).toMatch(/\/CreationDate \(D:20000101000000Z\)/);
  });

  it('compresses content streams outside deterministic mode, and the file parses back', async () => {
    const bytes = await pdfFromPages([samplePage(), { width: 420, height: 297, prims: [] }]);
    const pdf = latin1(bytes);
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf).toMatch(/\/FlateDecode/);
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(2);
    expect(back.getPage(1).getWidth()).toBeCloseTo(420 * MM_TO_PT, 9);
    expect(back.getPage(1).getHeight()).toBeCloseTo(297 * MM_TO_PT, 9);
  });

  it('rejects an empty export', async () => {
    await expect(pdfFromPages([])).rejects.toThrow();
  });
});

describe('arc Béziers', () => {
  const maxError = (c: Vec2, r: number, start: number, end: number): { err: number; count: number } => {
    const curves = arcBeziers(c, r, start, end);
    let err = 0;
    for (const b of curves) {
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const u = 1 - t;
        const x = u * u * u * b.p0.x + 3 * u * u * t * b.p1.x + 3 * u * t * t * b.p2.x + t * t * t * b.p3.x;
        const y = u * u * u * b.p0.y + 3 * u * u * t * b.p1.y + 3 * u * t * t * b.p2.y + t * t * t * b.p3.y;
        err = Math.max(err, Math.abs(Math.hypot(x - c.x, y - c.y) - r));
      }
    }
    return { err, count: curves.length };
  };

  it('stays within 0.005 mm for small and large radii, at most 90° per piece', () => {
    for (const r of [0.5, 5, 50, 500, 1189]) {
      const { err, count } = maxError(vec(10, 20), r, 0.3, 0.3 + (5 * Math.PI) / 3);
      expect(err).toBeLessThanOrEqual(CURVE_TOLERANCE_MM);
      expect(count).toBeGreaterThanOrEqual(4); // 300° needs at least four 90° pieces
    }
  });

  it('ends exactly at the arc end points and covers the full circle when start equals end', () => {
    const c = vec(0, 0);
    const curves = arcBeziers(c, 10, Math.PI / 2, Math.PI);
    expect(curves[0].p0.x).toBeCloseTo(0, 12);
    expect(curves[0].p0.y).toBeCloseTo(10, 12);
    expect(curves[curves.length - 1].p3.x).toBeCloseTo(-10, 12);
    expect(curves[curves.length - 1].p3.y).toBeCloseTo(0, 12);
    const full = arcBeziers(c, 10, 0, 0);
    expect(full.length).toBeGreaterThanOrEqual(4);
    expect(full[full.length - 1].p3.x).toBeCloseTo(10, 12);
  });

  it('error formula matches the known value for a quarter circle (2.7e-4·r)', () => {
    expect(bezierArcError(1, Math.PI / 2)).toBeCloseTo(2.725e-4, 6);
  });
});

describe('text metrics', () => {
  it('measures with Helvetica advance widths', () => {
    // Helvetica AFM: "H" 722, "i" 222, space 278 (1/1000 em).
    expect(textWidthMm('H', 0.718)).toBeCloseTo(0.722, 12);
    expect(textWidthMm('Hi H', 0.718)).toBeCloseTo((722 + 222 + 278 + 722) / 1000, 12);
    expect(textWidthMm('', 3.5)).toBe(0);
    // A minus measures like the hyphen it is written as.
    expect(textWidthMm('−1', 2.5)).toBeCloseTo(textWidthMm('-1', 2.5), 12);
  });
});
