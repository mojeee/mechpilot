// DXF export: a MechPilot document as DXF text, R12 (AC1009) or 2000 (AC1015).
// Every length is written in mm with String(n), the shortest text that reads back to the same
// double, so nothing is rounded (product rule 1). Angles of ARC and TEXT are degrees in DXF and
// radians in MechPilot; ellipse parameters and everything else are written as they are.
// Group codes: DXF Reference (Autodesk), sections HEADER, TABLES, BLOCKS, ENTITIES, OBJECTS.

import { documentBox, entitiesInOrder, layersInOrder } from '../doc/document';
import type { Document, EllipseEntity, Entity, Layer, SplineEntity } from '../doc/types';
import { ellipsePoints, splinePoints } from '../geometry/flatten';
import { eq, normAngle, type Vec2 } from '../geometry/vec2';
import { t } from '../i18n';
import {
  DXF_LINETYPES,
  DXF_VERSIONS,
  INSUNITS_MM,
  dxfLineTypeFor,
  encodeDxfText,
  hexToRgb,
  lineweightOf,
  nearestAci,
  type DxfVersion,
  type DxfWarning,
} from './codes';

/** Tolerance in mm for curves that R12 cannot hold (ellipses, splines) and that become polylines. */
export const R12_FLATTEN_TOLERANCE = 0.01;

const num = (n: number): string => String(n);
const deg = (rad: number): number => (rad * 180) / Math.PI;

/** Characters AutoCAD does not accept in symbol table names (layers): < > / \ " : ; ? * | = ` */
const BAD_NAME_CHARS = /[<>/\\":;?*|=`\u0000-\u001f]/g;

/** DXF layer names for the document's layers: valid characters, unique without regard to case
 *  (DXF names are case-insensitive). */
function dxfLayerNames(doc: Document): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const l of layersInOrder(doc)) {
    const base = l.name.replace(BAD_NAME_CHARS, '_').trim() || 'LAYER';
    let name = base;
    for (let n = 2; used.has(name.toUpperCase()); n++) name = `${base}_${n}`;
    used.add(name.toUpperCase());
    out.set(l.id, name);
  }
  return out;
}

/** ACI colour (code 62) of a layer: "auto" is 7 (white/black against the background). */
function layerAci(l: Layer): number {
  const rgb = hexToRgb(l.color);
  return rgb === null ? 7 : nearestAci(rgb);
}

class Out {
  lines: string[] = [];
  private handle = 0x20;
  pair(code: number, value: string | number): void {
    this.lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? num(value) : value);
  }
  point(code: number, p: Vec2): void {
    this.pair(code, p.x);
    this.pair(code + 10, p.y);
    this.pair(code + 20, 0);
  }
  /** A new entity handle (code 5), hexadecimal. */
  next(): string {
    return (this.handle++).toString(16).toUpperCase();
  }
  get seed(): string {
    return this.handle.toString(16).toUpperCase();
  }
}

/** An ellipse or spline as polyline points for R12, and whether the polyline is closed. */
function flattenForR12(e: EllipseEntity | SplineEntity): { points: Vec2[]; closed: boolean } {
  if (e.type === 'ellipse') {
    const pts = ellipsePoints(e, R12_FLATTEN_TOLERANCE);
    const full = normAngle(e.end - e.start) === 0;
    if (full && pts.length > 2) pts.pop();
    return { points: pts, closed: full };
  }
  const pts = splinePoints(e, R12_FLATTEN_TOLERANCE);
  if (e.closed && pts.length > 2 && eq(pts[0], pts[pts.length - 1])) pts.pop();
  return { points: pts, closed: e.closed };
}

/** Export the document as DXF text ("\r\n" line endings). */
export function writeDxf(doc: Document, opts: { version: DxfVersion }): string {
  const v2000 = opts.version === '2000';
  const acadver = DXF_VERSIONS.find((v) => v.id === opts.version)?.acadver ?? 'AC1015';
  const names = dxfLayerNames(doc);
  const layerName = (id: string): string => names.get(id) ?? '0';
  const o = new Out();

  // ---- CLASSES (2000: required, empty) ----
  if (v2000) {
    o.pair(0, 'SECTION');
    o.pair(2, 'CLASSES');
    o.pair(0, 'ENDSEC');
  }

  // ---- TABLES ----
  o.pair(0, 'SECTION');
  o.pair(2, 'TABLES');
  const table = (name: string, count: number, subclass = 'AcDbSymbolTable'): string => {
    o.pair(0, 'TABLE');
    o.pair(2, name);
    const h = v2000 ? o.next() : '';
    if (v2000) {
      o.pair(5, h);
      o.pair(330, '0');
      o.pair(100, subclass);
    }
    o.pair(70, count);
    return h;
  };
  /** Table record header: handle, owner and subclass markers (2000 only). */
  const record = (type: string, owner: string, subclass: string, handleCode = 5): string => {
    o.pair(0, type);
    if (!v2000) return '0';
    const h = o.next();
    o.pair(handleCode, h);
    o.pair(330, owner);
    o.pair(100, 'AcDbSymbolTableRecord');
    o.pair(100, subclass);
    return h;
  };

  if (v2000) {
    // VPORT: the active viewport, centred on the drawing (TABLES section, VPORT).
    const box = documentBox(doc, false);
    const cx = box ? (box.min.x + box.max.x) / 2 : 0;
    const cy = box ? (box.min.y + box.max.y) / 2 : 0;
    const height = box ? Math.max(box.max.y - box.min.y, (box.max.x - box.min.x) / 1.5, 1) * 1.1 : 297;
    const h = table('VPORT', 1);
    record('VPORT', h, 'AcDbViewportTableRecord');
    o.pair(2, '*ACTIVE');
    o.pair(70, 0);
    o.pair(10, 0);
    o.pair(20, 0);
    o.pair(11, 1);
    o.pair(21, 1);
    o.pair(12, cx);
    o.pair(22, cy);
    o.pair(13, 0);
    o.pair(23, 0);
    o.pair(14, 10);
    o.pair(24, 10);
    o.pair(15, 10);
    o.pair(25, 10);
    o.pair(16, 0);
    o.pair(26, 0);
    o.pair(36, 1);
    o.pair(17, 0);
    o.pair(27, 0);
    o.pair(37, 0);
    o.pair(40, height);
    o.pair(41, 1.5);
    o.pair(42, 50);
    o.pair(43, 0);
    o.pair(44, 0);
    o.pair(50, 0);
    o.pair(51, 0);
    o.pair(71, 0);
    o.pair(72, 100);
    o.pair(73, 1);
    o.pair(74, 3);
    o.pair(75, 0);
    o.pair(76, 0);
    o.pair(77, 0);
    o.pair(78, 0);
    o.pair(0, 'ENDTAB');
  }

  // LTYPE (TABLES section, LTYPE). 2000 also needs ByBlock and ByLayer.
  {
    const extra = v2000 ? ['ByBlock', 'ByLayer'] : [];
    const h = table('LTYPE', DXF_LINETYPES.length + extra.length);
    for (const name of extra) {
      record('LTYPE', h, 'AcDbLinetypeTableRecord');
      o.pair(2, name);
      o.pair(70, 0);
      o.pair(3, '');
      o.pair(72, 65);
      o.pair(73, 0);
      o.pair(40, 0);
    }
    for (const lt of DXF_LINETYPES) {
      record('LTYPE', h, 'AcDbLinetypeTableRecord');
      o.pair(2, lt.name);
      o.pair(70, 0);
      o.pair(3, lt.description);
      o.pair(72, 65);
      o.pair(73, lt.pattern.length);
      o.pair(40, lt.pattern.reduce((s, x) => s + Math.abs(x), 0));
      for (const el of lt.pattern) {
        o.pair(49, el);
        if (v2000) o.pair(74, 0);
      }
    }
    o.pair(0, 'ENDTAB');
  }

  // LAYER (TABLES section, LAYER): 2 name, 70 flags (1 frozen, 4 locked), 62 ACI, 420 true colour
  // (2000), 6 line type, 370 lineweight in 1/100 mm (2000).
  {
    const layers = layersInOrder(doc);
    const h = table('LAYER', layers.length);
    for (const l of layers) {
      record('LAYER', h, 'AcDbLayerTableRecord');
      o.pair(2, layerName(l.id));
      o.pair(70, (l.visible ? 0 : 1) | (l.locked ? 4 : 0));
      o.pair(62, layerAci(l));
      const rgb = hexToRgb(l.color);
      if (v2000 && rgb !== null) o.pair(420, rgb);
      o.pair(6, dxfLineTypeFor(l.lineType));
      if (v2000) o.pair(370, lineweightOf(l.lineWidth));
    }
    o.pair(0, 'ENDTAB');
  }

  // STYLE (TABLES section, STYLE): the text style TEXT entities refer to (code 7).
  const styleName = v2000 ? 'Standard' : 'STANDARD';
  {
    const h = table('STYLE', 1);
    record('STYLE', h, 'AcDbTextStyleTableRecord');
    o.pair(2, styleName);
    o.pair(70, 0);
    o.pair(40, 0);
    o.pair(41, 1);
    o.pair(50, 0);
    o.pair(71, 0);
    o.pair(42, 2.5);
    o.pair(3, 'txt');
    o.pair(4, '');
    o.pair(0, 'ENDTAB');
  }

  let modelSpace = '0';
  let paperSpace = '0';
  if (v2000) {
    table('VIEW', 0);
    o.pair(0, 'ENDTAB');
    table('UCS', 0);
    o.pair(0, 'ENDTAB');
    {
      const h = table('APPID', 1);
      record('APPID', h, 'AcDbRegAppTableRecord');
      o.pair(2, 'ACAD');
      o.pair(70, 0);
      o.pair(0, 'ENDTAB');
    }
    {
      // DIMSTYLE records carry their handle in code 105 (TABLES section, DIMSTYLE).
      const h = table('DIMSTYLE', 1);
      o.pair(100, 'AcDbDimStyleTable');
      record('DIMSTYLE', h, 'AcDbDimStyleTableRecord', 105);
      o.pair(2, 'Standard');
      o.pair(70, 0);
      o.pair(0, 'ENDTAB');
    }
    {
      const h = table('BLOCK_RECORD', 2);
      modelSpace = record('BLOCK_RECORD', h, 'AcDbBlockTableRecord');
      o.pair(2, '*Model_Space');
      paperSpace = record('BLOCK_RECORD', h, 'AcDbBlockTableRecord');
      o.pair(2, '*Paper_Space');
      o.pair(0, 'ENDTAB');
    }
  }
  o.pair(0, 'ENDSEC');

  // ---- BLOCKS: R12 needs none; 2000 needs *Model_Space and *Paper_Space. ----
  o.pair(0, 'SECTION');
  o.pair(2, 'BLOCKS');
  if (v2000) {
    for (const [name, owner] of [
      ['*Model_Space', modelSpace],
      ['*Paper_Space', paperSpace],
    ] as const) {
      o.pair(0, 'BLOCK');
      o.pair(5, o.next());
      o.pair(330, owner);
      o.pair(100, 'AcDbEntity');
      if (name === '*Paper_Space') o.pair(67, 1);
      o.pair(8, '0');
      o.pair(100, 'AcDbBlockBegin');
      o.pair(2, name);
      o.pair(70, 0);
      o.point(10, { x: 0, y: 0 });
      o.pair(3, name);
      o.pair(1, '');
      o.pair(0, 'ENDBLK');
      o.pair(5, o.next());
      o.pair(330, owner);
      o.pair(100, 'AcDbEntity');
      if (name === '*Paper_Space') o.pair(67, 1);
      o.pair(8, '0');
      o.pair(100, 'AcDbBlockEnd');
    }
  }
  o.pair(0, 'ENDSEC');

  // ---- ENTITIES ----
  o.pair(0, 'SECTION');
  o.pair(2, 'ENTITIES');
  /** Entity header: type, handle and owner (2000), layer (8), subclass markers (2000). */
  const begin = (type: string, layer: string, ...subclasses: string[]): void => {
    o.pair(0, type);
    if (v2000) {
      o.pair(5, o.next());
      o.pair(330, modelSpace);
      o.pair(100, 'AcDbEntity');
    }
    o.pair(8, layer);
    if (v2000) for (const s of subclasses) o.pair(100, s);
  };
  /** R12 POLYLINE / VERTEX / SEQEND (ENTITIES section, POLYLINE and VERTEX): 66 1 = vertices follow,
   *  70 bit 1 = closed, 42 = bulge of the segment that starts at the vertex. */
  const r12Polyline = (layer: string, points: Vec2[], closed: boolean, bulges?: number[]): void => {
    o.pair(0, 'POLYLINE');
    o.pair(8, layer);
    o.pair(66, 1);
    o.point(10, { x: 0, y: 0 });
    o.pair(70, closed ? 1 : 0);
    points.forEach((p, i) => {
      o.pair(0, 'VERTEX');
      o.pair(8, layer);
      o.point(10, p);
      const b = bulges?.[i] ?? 0;
      if (b !== 0) o.pair(42, b);
      o.pair(70, 0);
    });
    o.pair(0, 'SEQEND');
    o.pair(8, layer);
  };

  for (const e of entitiesInOrder(doc)) writeEntity(e);

  function writeEntity(e: Entity): void {
    const layer = layerName(e.layer);
    switch (e.type) {
      case 'line':
        begin('LINE', layer, 'AcDbLine');
        o.point(10, e.a);
        o.point(11, e.b);
        return;
      case 'circle':
        begin('CIRCLE', layer, 'AcDbCircle');
        o.point(10, e.center);
        o.pair(40, e.radius);
        return;
      case 'arc':
        // ARC: 50/51 start and end angles in degrees, counter-clockwise.
        begin('ARC', layer, 'AcDbCircle');
        o.point(10, e.center);
        o.pair(40, e.radius);
        if (v2000) o.pair(100, 'AcDbArc');
        o.pair(50, deg(e.start));
        o.pair(51, deg(e.end));
        return;
      case 'polyline':
        if (!v2000) {
          r12Polyline(layer, e.points, e.closed, e.bulges);
          return;
        }
        // LWPOLYLINE: 90 vertex count, 70 bit 1 closed, per vertex 10/20 and 42 bulge.
        begin('LWPOLYLINE', layer, 'AcDbPolyline');
        o.pair(90, e.points.length);
        o.pair(70, e.closed ? 1 : 0);
        o.pair(43, 0);
        e.points.forEach((p, i) => {
          o.pair(10, p.x);
          o.pair(20, p.y);
          const b = e.bulges?.[i] ?? 0;
          if (b !== 0) o.pair(42, b);
        });
        return;
      case 'ellipse':
        if (!v2000) {
          const f = flattenForR12(e);
          r12Polyline(layer, f.points, f.closed);
          return;
        }
        // ELLIPSE: 10 centre, 11 major axis end relative to the centre, 40 ratio, 41/42 start and
        // end parameters in radians.
        begin('ELLIPSE', layer, 'AcDbEllipse');
        o.point(10, e.center);
        o.point(11, e.major);
        o.pair(40, e.ratio);
        o.pair(41, e.start);
        o.pair(42, e.end);
        return;
      case 'spline': {
        if (!v2000) {
          const f = flattenForR12(e);
          r12Polyline(layer, f.points, f.closed);
          return;
        }
        // SPLINE: 210 normal, 70 flags (1 closed, 8 planar), 71 degree, 72/73/74 counts of knots,
        // control points and fit points, 42/43/44 tolerances, 40 knots, 10 control points, 11 fit points.
        const fit = e.fitPoints ?? [];
        begin('SPLINE', layer, 'AcDbSpline');
        o.pair(210, 0);
        o.pair(220, 0);
        o.pair(230, 1);
        o.pair(70, 8 | (e.closed ? 1 : 0));
        o.pair(71, e.degree);
        o.pair(72, e.knots.length);
        o.pair(73, e.controlPoints.length);
        o.pair(74, fit.length);
        o.pair(42, 1e-10);
        o.pair(43, 1e-10);
        if (fit.length > 0) o.pair(44, 1e-10);
        for (const k of e.knots) o.pair(40, k);
        for (const p of e.controlPoints) o.point(10, p);
        for (const p of fit) o.point(11, p);
        return;
      }
      case 'text':
        // TEXT: 10 first alignment point (baseline left), 40 height, 1 value, 50 rotation in degrees.
        begin('TEXT', layer, 'AcDbText');
        o.point(10, e.position);
        o.pair(40, e.height);
        o.pair(1, encodeDxfText(e.text));
        o.pair(50, deg(e.rotation));
        o.pair(7, styleName);
        if (v2000) o.pair(100, 'AcDbText');
        return;
    }
  }
  o.pair(0, 'ENDSEC');

  // ---- OBJECTS (2000): the root dictionary with an empty ACAD_GROUP dictionary. ----
  if (v2000) {
    const root = o.next();
    const group = o.next();
    o.pair(0, 'SECTION');
    o.pair(2, 'OBJECTS');
    o.pair(0, 'DICTIONARY');
    o.pair(5, root);
    o.pair(330, '0');
    o.pair(100, 'AcDbDictionary');
    o.pair(281, 1);
    o.pair(3, 'ACAD_GROUP');
    o.pair(350, group);
    o.pair(0, 'DICTIONARY');
    o.pair(5, group);
    o.pair(330, root);
    o.pair(100, 'AcDbDictionary');
    o.pair(281, 1);
    o.pair(0, 'ENDSEC');
  }
  o.pair(0, 'EOF');

  // ---- HEADER, written last because $HANDSEED must exceed every handle used. ----
  const hd = new Out();
  hd.pair(0, 'SECTION');
  hd.pair(2, 'HEADER');
  const variable = (name: string): void => hd.pair(9, name);
  variable('$ACADVER');
  hd.pair(1, acadver);
  if (v2000) {
    variable('$DWGCODEPAGE');
    hd.pair(3, 'ANSI_1252');
  }
  variable('$INSBASE');
  hd.point(10, { x: 0, y: 0 });
  const box = documentBox(doc, false);
  variable('$EXTMIN');
  hd.point(10, box?.min ?? { x: 0, y: 0 });
  variable('$EXTMAX');
  hd.point(10, box?.max ?? { x: 0, y: 0 });
  variable('$CLAYER');
  hd.pair(8, layerName(doc.activeLayer));
  // $INSUNITS 4 = millimetres. R12 predates the variable; R12 readers ignore it, newer ones use it.
  variable('$INSUNITS');
  hd.pair(70, INSUNITS_MM);
  if (v2000) {
    variable('$MEASUREMENT'); // 1 = metric
    hd.pair(70, 1);
    variable('$HANDSEED');
    hd.pair(5, o.seed);
  }
  hd.pair(0, 'ENDSEC');

  return [...hd.lines, ...o.lines].join('\r\n') + '\r\n';
}

/**
 * What an export will change, for the export dialog: curves R12 cannot hold, renamed layers, text
 * joined into one line. Empty when the file will hold the drawing as it is.
 */
export function dxfExportNotes(doc: Document, version: DxfVersion): DxfWarning[] {
  const notes: DxfWarning[] = [];
  const entities = entitiesInOrder(doc);
  if (version === 'R12') {
    const ellipses = entities.filter((e) => e.type === 'ellipse').length;
    if (ellipses > 0) {
      notes.push({
        code: 'ellipse-flattened',
        count: ellipses,
        message: t('{n} ellipses will be written as polylines that follow the curve within {tol} mm, because DXF R12 has no ellipse entity. Choose DXF 2000 to keep them exact.', { n: ellipses, tol: R12_FLATTEN_TOLERANCE }),
      });
    }
    const splines = entities.filter((e) => e.type === 'spline').length;
    if (splines > 0) {
      notes.push({
        code: 'spline-flattened',
        count: splines,
        message: t('{n} splines will be written as polylines that follow the curve within {tol} mm, because DXF R12 has no spline entity. Choose DXF 2000 to keep them exact.', { n: splines, tol: R12_FLATTEN_TOLERANCE }),
      });
    }
    const strict = layersInOrder(doc).filter((l) => !/^[A-Za-z0-9_$-]{1,31}$/.test(l.name));
    if (strict.length > 0) {
      notes.push({
        code: 'r12-layer-names',
        count: strict.length,
        message: t('{n} layer names have spaces, special characters or more than 31 characters; programs that read DXF R12 strictly may change them: {names}.', { n: strict.length, names: strict.map((l) => l.name).join(', ') }),
      });
    }
  }
  const names = dxfLayerNames(doc);
  const renamed = layersInOrder(doc).filter((l) => names.get(l.id) !== l.name);
  if (renamed.length > 0) {
    notes.push({
      code: 'layer-renamed',
      count: renamed.length,
      message: t('{n} layers will get a different name in the DXF file, because DXF does not allow some characters or two names that differ only in capitals: {names}.', { n: renamed.length, names: renamed.map((l) => `${l.name} → ${names.get(l.id) ?? ''}`).join(', ') }),
    });
  }
  const multiline = entities.filter((e) => e.type === 'text' && /[\r\n]/.test(e.text)).length;
  if (multiline > 0) {
    notes.push({
      code: 'text-joined',
      count: multiline,
      message: t('{n} texts have line breaks; DXF TEXT holds one line, so the lines will be joined with spaces.', { n: multiline }),
    });
  }
  return notes;
}
