// Drawing sheets as display primitives (paper mm, origin at the bottom-left corner, y up):
// the frame and borders (ISO 5457), the grid reference zones, centring marks, the ISO 7200 title
// block, and the view labels (ISO 5455 "SCALE 1:2"). The data comes from /library with its sources.

import sheetsLib from '@library/sheets/iso-5457.json';
import titleLib from '@library/title-blocks/iso-7200.json';
import scalesLib from '@library/scales/iso-5455.json';
import type { Sheet, SheetSize, SheetView } from '../doc/types';
import type { Vec2 } from '../geometry/vec2';
import { textWidth, type Prim } from './primitives';

interface SizeDef {
  id: SheetSize;
  width: number;
  height: number;
  frameMargins: { left: number; top: number; right: number; bottom: number };
  zonesX: number;
  zonesY: number;
  orientation: 'landscape' | 'portrait';
  gridLabelsOnlyTopAndRight?: boolean;
}
interface SheetsLib {
  sizes: SizeDef[];
  frameLineWidth: number;
  zoneField: { length: number; labelHeight: number; gridLineWidth: number };
  centringMarks: { recommendedLineWidth: number; recommendedExtentBeyondFrame: number };
}
interface TitleField {
  id: string;
  name: string;
  nameIt: string;
  mandatory: boolean;
}
interface TitleCell {
  field: string;
  x: number;
  y: number;
  w: number;
  h: number;
  alsoShows?: string;
  valueHeight?: number;
  format?: string;
}
interface TitleLib {
  fields: TitleField[];
  layout: { width: number; height: number; labelHeight: number; valueHeight: number; cells: TitleCell[] };
}
interface ScalesLib {
  scales: { id: string; ratio: number; kind: string }[];
}

export const SHEETS: SheetsLib = sheetsLib as unknown as SheetsLib;
export const TITLE_BLOCK: TitleLib = titleLib as unknown as TitleLib;
export const SCALES: ScalesLib = scalesLib as unknown as ScalesLib;

/** Paper size in mm for a sheet, honouring its orientation. */
export function sheetPaper(sheet: Pick<Sheet, 'size' | 'orientation'>): { width: number; height: number } {
  const def = SHEETS.sizes.find((s) => s.id === sheet.size) ?? SHEETS.sizes[SHEETS.sizes.length - 1];
  const long = Math.max(def.width, def.height);
  const short = Math.min(def.width, def.height);
  return sheet.orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

/** The drawing space (inside the frame), paper mm. */
export function drawingSpace(sheet: Pick<Sheet, 'size' | 'orientation'>): { x: number; y: number; width: number; height: number } {
  const def = SHEETS.sizes.find((s) => s.id === sheet.size) ?? SHEETS.sizes[SHEETS.sizes.length - 1];
  const paper = sheetPaper(sheet);
  const m = def.frameMargins;
  // ISO 5457:1999, 4.2: the binding margin (20 mm) is on the left; 10 mm on the other sides.
  return { x: m.left, y: m.bottom, width: paper.width - m.left - m.right, height: paper.height - m.top - m.bottom };
}

/** "1:2" for 0.5, "2:1" for 2, "1:1" for 1 (ISO 5455 designation). */
export function scaleLabel(ratio: number): string {
  const known = SCALES.scales.find((s) => Math.abs(s.ratio - ratio) < 1e-12);
  if (known) return known.id;
  if (ratio >= 1) return `${trimNum(ratio)}:1`;
  return `1:${trimNum(1 / ratio)}`;
}
const trimNum = (v: number) => String(Number(v.toPrecision(6)));

/** Zone letters top to bottom, skipping I and O (ISO 5457:1999, 4.4). */
export function zoneLetters(n: number): string[] {
  const out: string[] = [];
  for (let c = 65; out.length < n && c < 91; c++) {
    const ch = String.fromCharCode(c);
    if (ch === 'I' || ch === 'O') continue;
    out.push(ch);
  }
  return out;
}

/** Frame, grid reference border, centring marks and trimming marks of a sheet. */
export function sheetFramePrims(sheet: Pick<Sheet, 'size' | 'orientation'>): Prim[] {
  const def = SHEETS.sizes.find((s) => s.id === sheet.size) ?? SHEETS.sizes[SHEETS.sizes.length - 1];
  const paper = sheetPaper(sheet);
  const ds = drawingSpace(sheet);
  const prims: Prim[] = [];
  const frameW = SHEETS.frameLineWidth; // 0.7 mm (ISO 5457:1999, 4.2)
  const gridW = SHEETS.zoneField.gridLineWidth; // 0.35 mm (ISO 5457:1999, 4.4)
  const field = SHEETS.zoneField.length; // 50 mm
  const labelH = SHEETS.zoneField.labelHeight; // 3.5 mm
  const border = 5; // the grid reference border strip (docs/to-verify.md: Figure 4 suggests 5 mm)
  // Frame of the drawing space.
  prims.push({ kind: 'polyline', points: rect(ds.x, ds.y, ds.width, ds.height), closed: true, width: frameW });
  // Grid reference border: a second line `border` outside the frame on the sides that carry labels.
  const nx = sheet.orientation === 'landscape' ? Math.max(def.zonesX, def.zonesY) : Math.min(def.zonesX, def.zonesY);
  const ny = sheet.orientation === 'landscape' ? Math.min(def.zonesX, def.zonesY) : Math.max(def.zonesX, def.zonesY);
  const onlyTopRight = def.gridLabelsOnlyTopAndRight === true;
  const cx = ds.x + ds.width / 2;
  const cy = ds.y + ds.height / 2;
  // Zone divisions are counted from the centring axes outwards (ISO 5457:1999, 4.4).
  const xs = divisions(cx, ds.x, ds.x + ds.width, field, nx);
  const ys = divisions(cy, ds.y, ds.y + ds.height, field, ny);
  const sides = onlyTopRight ? ['top', 'right'] : ['top', 'bottom', 'left', 'right'];
  for (const side of sides) {
    if (side === 'top' || side === 'bottom') {
      const y0 = side === 'top' ? ds.y + ds.height : ds.y - border;
      prims.push({ kind: 'polyline', points: [{ x: ds.x - (onlyTopRight ? 0 : border), y: y0 + (side === 'top' ? border : 0) }, { x: ds.x + ds.width + border, y: y0 + (side === 'top' ? border : 0) }], closed: false, width: gridW });
      for (let i = 1; i < xs.length - 1; i++) prims.push({ kind: 'polyline', points: [{ x: xs[i], y: y0 }, { x: xs[i], y: y0 + border }], closed: false, width: gridW });
      for (let i = 0; i < xs.length - 1; i++) {
        const label = String(i + 1);
        prims.push({ kind: 'text', position: { x: (xs[i] + xs[i + 1]) / 2 - textWidth(label, labelH) / 2, y: y0 + (border - labelH) / 2 }, text: label, height: labelH, rotation: 0, align: 'left' });
      }
    } else {
      const x0 = side === 'right' ? ds.x + ds.width : ds.x - border;
      prims.push({ kind: 'polyline', points: [{ x: x0 + (side === 'right' ? border : 0), y: ds.y - (onlyTopRight ? 0 : border) }, { x: x0 + (side === 'right' ? border : 0), y: ds.y + ds.height + border }], closed: false, width: gridW });
      for (let i = 1; i < ys.length - 1; i++) prims.push({ kind: 'polyline', points: [{ x: x0, y: ys[i] }, { x: x0 + border, y: ys[i] }], closed: false, width: gridW });
      const letters = zoneLetters(ys.length - 1);
      for (let i = 0; i < ys.length - 1; i++) {
        // Letters run from the top downwards.
        const label = letters[ys.length - 2 - i];
        prims.push({ kind: 'text', position: { x: x0 + (border - textWidth(label, labelH)) / 2, y: (ys[i] + ys[i + 1]) / 2 - labelH / 2 }, text: label, height: labelH, rotation: 0, align: 'left' });
      }
    }
  }
  // Centring marks: from the grid border 10 mm into the drawing space, 0.7 mm (ISO 5457:1999, 4.3).
  const ext = SHEETS.centringMarks.recommendedExtentBeyondFrame;
  const cw = SHEETS.centringMarks.recommendedLineWidth;
  prims.push({ kind: 'polyline', points: [{ x: cx, y: 0 }, { x: cx, y: ds.y + ext }], closed: false, width: cw });
  prims.push({ kind: 'polyline', points: [{ x: cx, y: paper.height }, { x: cx, y: ds.y + ds.height - ext }], closed: false, width: cw });
  prims.push({ kind: 'polyline', points: [{ x: 0, y: cy }, { x: ds.x + ext, y: cy }], closed: false, width: cw });
  prims.push({ kind: 'polyline', points: [{ x: paper.width, y: cy }, { x: ds.x + ds.width - ext, y: cy }], closed: false, width: cw });
  // Trimming marks: 10 × 5 mm overlapping rectangles at the corners (ISO 5457:1999, 4.5).
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const ox = sx > 0 ? 0 : paper.width;
    const oy = sy > 0 ? 0 : paper.height;
    prims.push({ kind: 'polygon', points: [{ x: ox, y: oy }, { x: ox + sx * 10, y: oy }, { x: ox + sx * 10, y: oy + sy * 5 }, { x: ox, y: oy + sy * 5 }] });
    prims.push({ kind: 'polygon', points: [{ x: ox, y: oy }, { x: ox + sx * 5, y: oy }, { x: ox + sx * 5, y: oy + sy * 10 }, { x: ox, y: oy + sy * 10 }] });
  }
  return prims;
}

function divisions(center: number, from: number, to: number, field: number, count: number): number[] {
  // Fields of `field` mm from the centre outwards; the remainder goes to the corner fields.
  const out = new Set<number>([from, to]);
  for (let k = 1; k < count; k++) {
    const a = center + (k - count / 2) * field;
    if (a > from + 1e-9 && a < to - 1e-9) out.add(a);
  }
  return [...out].sort((p, q) => p - q);
}

function rect(x: number, y: number, w: number, h: number): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Where the title block sits: bottom-right corner of the drawing space (ISO 5457:1999, 4.1). */
export function titleBlockOrigin(sheet: Pick<Sheet, 'size' | 'orientation'>): Vec2 {
  const ds = drawingSpace(sheet);
  const L = TITLE_BLOCK.layout;
  return { x: ds.x + ds.width - L.width, y: ds.y };
}

/** Field label in English or Italian. */
export function titleFieldName(id: string, lang: 'en' | 'it'): string {
  const f = TITLE_BLOCK.fields.find((x) => x.id === id);
  return f ? (lang === 'it' ? f.nameIt : f.name) : id;
}

/** The ISO 7200 title block: cell borders, small labels, values. */
export function titleBlockPrims(sheet: Sheet, lang: 'en' | 'it' = 'en'): Prim[] {
  const o = titleBlockOrigin(sheet);
  const L = TITLE_BLOCK.layout;
  const line = 0.35;
  const prims: Prim[] = [{ kind: 'polyline', points: rect(o.x, o.y, L.width, L.height), closed: true, width: 0.7 }];
  for (const c of L.cells) {
    // Cell coordinates are from the top-left of the block, y down.
    const x = o.x + c.x;
    const yTop = o.y + L.height - c.y;
    const yBot = yTop - c.h;
    prims.push({ kind: 'polyline', points: rect(x, yBot, c.w, c.h), closed: true, width: line });
    const label = titleFieldName(c.field, lang);
    // Labels shrink to fit narrow cells (the width estimate is generous by 20% for real fonts).
    let lh = L.labelHeight;
    while (lh > 1.4 && textWidth(label, lh) * 1.2 > c.w - 1.5) lh *= 0.9;
    prims.push({ kind: 'text', position: { x: x + 1, y: yTop - lh - 0.8 }, text: label, height: lh, rotation: 0, align: 'left' });
    let value = sheet.titleBlock[c.field] ?? '';
    if (c.format) value = c.format.replace(/\{(\w+)\}/g, (_m, k: string) => sheet.titleBlock[k] ?? '');
    if (c.alsoShows && sheet.titleBlock[c.alsoShows]) value = value ? `${value}\n${sheet.titleBlock[c.alsoShows]}` : sheet.titleBlock[c.alsoShows];
    const vh = c.valueHeight ?? L.valueHeight;
    const lines = value.split('\n').filter(Boolean);
    lines.forEach((text, i) => {
      // Fit long values by shrinking the lettering (ISO 7200 limits characters, not widths).
      let h = vh;
      while (h > 1.8 && textWidth(text, h) * 1.2 > c.w - 2) h *= 0.9;
      prims.push({ kind: 'text', position: { x: x + 1, y: yTop - lh - 1.6 - (i + 1) * (h * 1.4) + h * 0.3 }, text, height: h, rotation: 0, align: 'left' });
    });
  }
  return prims;
}

/** The label under a view: its name and "SCALE 1:2" (ISO 5455, clause 3). */
export function viewLabelPrims(view: SheetView): Prim[] {
  if (!view.label) return [];
  const h = 3.5;
  const text = `${view.name}  SCALE ${scaleLabel(view.scale)}`;
  return [{ kind: 'text', position: { x: view.position.x - textWidth(text, h) / 2, y: view.position.y - view.height / 2 - h * 1.8 }, text, height: h, rotation: 0, align: 'left' }];
}

/** A viewport's rectangle on the paper. */
export function viewRect(view: SheetView): { x: number; y: number; width: number; height: number } {
  return { x: view.position.x - view.width / 2, y: view.position.y - view.height / 2, width: view.width, height: view.height };
}

/** Everything of a sheet except the model views: frame, zones, marks, title block, view labels. */
export function sheetPrims(sheet: Sheet, lang: 'en' | 'it' = 'en'): Prim[] {
  return [...sheetFramePrims(sheet), ...titleBlockPrims(sheet, lang), ...sheet.views.flatMap(viewLabelPrims)];
}

/** A new sheet with sensible defaults: A3 landscape, one 1:1 view centred on `center`. */
export function newSheet(id: string, viewId: string, name: string, center: Vec2, size: SheetSize = 'A3'): Sheet {
  const def = SHEETS.sizes.find((s) => s.id === size) ?? SHEETS.sizes[0];
  const sheet: Sheet = { id, name, size, orientation: def.orientation, titleBlock: {}, views: [] };
  const ds = drawingSpace(sheet);
  const L = TITLE_BLOCK.layout;
  const w = ds.width - 20;
  const h = ds.height - L.height - 30;
  sheet.views.push({ id: viewId, name: 'Front', scale: 1, center, position: { x: ds.x + ds.width / 2, y: ds.y + L.height + 12 + h / 2 }, width: w, height: h, label: true });
  return sheet;
}
