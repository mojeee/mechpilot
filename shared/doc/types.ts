// The document model: pure data, millimetres, double precision (product rule 1). This is also the
// file format (docs/file-format.md): a document serializes as it is, with stable ordering.

import type { Vec2 } from '../geometry/vec2';

export type Id = string;

/** Bumped on every change of shape; shared/doc/file.ts migrates older files.
 *  1: M0 (line, circle, arc). 2: M1 adds polyline, ellipse, spline, text.
 *  3: M2 adds dimensions, notes, balloons, surface and GD&T symbols, datums, dimStyle and sheets. */
export const FORMAT_VERSION = 3;
export const FORMAT_NAME = 'mechpilot';

export type Standard = 'iso' | 'asme';
/** ISO 5456-2: first-angle projection is the default; third angle as an option (product rule 2). */
export type Projection = 'first' | 'third';

export interface Layer {
  id: Id;
  name: string;
  /** Hex colour, or "auto": the canvas foreground (white on a dark canvas, black on a white one). */
  color: string;
  /** Line type id from library/line-types/iso-128-2.json, e.g. "01.2" (continuous wide). */
  lineType: string;
  /** Line width in mm from the ISO 128-2 series. */
  lineWidth: number;
  visible: boolean;
  locked: boolean;
}

interface EntityBase {
  id: Id;
  layer: Id;
}
export interface LineEntity extends EntityBase {
  type: 'line';
  a: Vec2;
  b: Vec2;
}
export interface CircleEntity extends EntityBase {
  type: 'circle';
  center: Vec2;
  radius: number;
}
/** Arc from `start` to `end` counter-clockwise, angles in radians. */
export interface ArcEntity extends EntityBase {
  type: 'arc';
  center: Vec2;
  radius: number;
  start: number;
  end: number;
}
/**
 * Polyline: straight segments between points, optionally closed. `bulges[i]` (when present) makes
 * segment i (points[i] to points[i+1], or to points[0] for the closing segment) an arc, as in DXF:
 * bulge = tan(θ/4) where θ is the included angle, positive counter-clockwise, 0 = straight.
 * A rectangle is a closed polyline of four points.
 */
export interface PolylineEntity extends EntityBase {
  type: 'polyline';
  points: Vec2[];
  closed: boolean;
  bulges?: number[];
}
/**
 * Ellipse as in DXF: `major` is the vector from the centre to the end of the major axis, `ratio`
 * = minor/major (0 < ratio <= 1), `start`/`end` are parameters in radians (0 and 2π for a full
 * ellipse), counter-clockwise. A point is center + major·cos(t) + minor·sin(t), with minor the
 * major vector rotated +90° and scaled by ratio.
 */
export interface EllipseEntity extends EntityBase {
  type: 'ellipse';
  center: Vec2;
  major: Vec2;
  ratio: number;
  start: number;
  end: number;
}
/**
 * Non-rational B-spline (no weights), as in DXF SPLINE: `degree` (3 by default), control points
 * and a clamped knot vector of length controlPoints.length + degree + 1. `fitPoints` are the points
 * the user picked, kept so the curve can be re-interpolated when edited.
 */
export interface SplineEntity extends EntityBase {
  type: 'spline';
  degree: number;
  controlPoints: Vec2[];
  knots: number[];
  fitPoints?: Vec2[];
  closed: boolean;
}
/** Single-line text: `position` is the baseline-left point, `height` the cap height in mm,
 *  `rotation` in radians counter-clockwise. */
export interface TextEntity extends EntityBase {
  type: 'text';
  position: Vec2;
  text: string;
  height: number;
  rotation: number;
}
/* ---------- M2: dimensions and annotations (ISO 129-1, ISO 286, ISO 1101, ISO 21920-1) ---------- */

/** A size tolerance written after the value (ISO 129-1 / ISO 14405-1). */
export type Tolerance =
  /** Upper and lower deviations in mm, e.g. +0.02 / −0.01. */
  | { kind: 'deviation'; upper: number; lower: number }
  /** Symmetric: ± value. */
  | { kind: 'symmetric'; value: number }
  /** Two limits written one above the other, in mm. */
  | { kind: 'limits'; upper: number; lower: number }
  /** An ISO 286 tolerance class such as "H7" or "g6"; the deviations come from the library. */
  | { kind: 'fit'; cls: string };

export type DimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'ordinate';

/**
 * A dimension measures geometry in model space (mm) and draws itself to ISO 129-1 with the
 * document's dimension style. The text is computed from the measured value unless `text`
 * overrides it ("<>" stands for the measured value).
 * - linear: distance between a and b projected on direction `rotation`; the dimension line passes through `position`.
 * - aligned: distance |a−b|; the dimension line passes through `position`.
 * - angular: `center` is the vertex, a and b lie on the two legs, the arc passes through `position`.
 * - radius / diameter: a is the centre, b a point on the curve; the leader ends at `position` (text).
 * - ordinate: a is the origin, b the measured point; `rotation` 0 gives an x ordinate, π/2 a y one; the leader ends at `position`.
 */
export interface DimensionEntity extends EntityBase {
  type: 'dimension';
  kind: DimensionKind;
  a: Vec2;
  b: Vec2;
  position: Vec2;
  rotation: number;
  center?: Vec2;
  text?: string;
  prefix?: string;
  suffix?: string;
  tolerance?: Tolerance;
  /** Decimal places for the value; the style's default when absent. */
  decimals?: number;
}

/** A note: one or more lines of text with an optional leader from the first point to the text. */
export interface NoteEntity extends EntityBase {
  type: 'note';
  position: Vec2;
  text: string;
  height: number;
  rotation: number;
  /** Leader points from the arrow tip to the text, when present. */
  leader?: Vec2[];
}

/** A balloon (item number) in a circle with a leader to the part. */
export interface BalloonEntity extends EntityBase {
  type: 'balloon';
  position: Vec2;
  text: string;
  /** Arrow tip on the part. */
  leader: Vec2;
}

/** Surface texture symbol (ISO 21920-1): placed on a surface with its tip at `position`. */
export interface SurfaceEntity extends EntityBase {
  type: 'surface';
  position: Vec2;
  rotation: number;
  /** Material removal: any process, required, or prohibited. */
  removal: 'any' | 'required' | 'prohibited';
  /** Ra in µm, written as "Ra 3.2" when present. */
  ra?: number;
  /** Extra requirement text (e.g. a process or lay). */
  text?: string;
  /** Leader from the symbol to `leader` (arrow tip on the surface) when the symbol is placed away from it. */
  leader?: Vec2;
}

/** Geometrical tolerance frame (ISO 1101). */
export interface GdtEntity extends EntityBase {
  type: 'gdt';
  position: Vec2;
  rotation: number;
  /** Characteristic id from library/gdt/iso-1101.json (e.g. "flatness"). */
  characteristic: string;
  /** Tolerance compartment text, e.g. "0.05" or "Ø0.1". */
  tolerance: string;
  /** Datum letters, up to three compartments. */
  datums: string[];
  /** Arrow tip on the toleranced feature. */
  leader?: Vec2;
}

/** Datum indicator (ISO 1101/ISO 5459): a filled triangle on the feature and the letter in a frame. */
export interface DatumEntity extends EntityBase {
  type: 'datum';
  position: Vec2;
  rotation: number;
  label: string;
}

export type Entity =
  | LineEntity
  | CircleEntity
  | ArcEntity
  | PolylineEntity
  | EllipseEntity
  | SplineEntity
  | TextEntity
  | DimensionEntity
  | NoteEntity
  | BalloonEntity
  | SurfaceEntity
  | GdtEntity
  | DatumEntity;
export type EntityType = Entity['type'];
export type AnnotationEntity = DimensionEntity | NoteEntity | BalloonEntity | SurfaceEntity | GdtEntity | DatumEntity;
export const ANNOTATION_TYPES: ReadonlySet<EntityType> = new Set<EntityType>(['dimension', 'note', 'balloon', 'surface', 'gdt', 'datum']);

/**
 * Dimension style (ISO 129-1 / ISO 3098). Sizes are paper mm; in model space they are divided by
 * `annotationScale`, so a drawing meant for a 1:2 view keeps 3.5 mm text on paper.
 */
export interface DimStyle {
  textHeight: number;
  arrowSize: number;
  /** Extension line overshoot beyond the dimension line, and gap from the outline. */
  extensionOvershoot: number;
  extensionGap: number;
  /** Gap between the dimension line and the text above it. */
  textGap: number;
  decimals: number;
  /** Annotation scale as a ratio (0.5 for 1:2). */
  annotationScale: number;
  arrowhead: 'closed-filled' | 'open' | 'oblique' | 'dot';
}

/* ---------- M2: sheets (ISO 5457, ISO 7200, ISO 5455) ---------- */

export type SheetSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

/** A rectangular window onto model space, placed on the sheet at a standard scale. */
export interface SheetView {
  id: Id;
  name: string;
  /** Scale ratio: 0.5 for 1:2, 2 for 2:1. */
  scale: number;
  /** Model point shown at the centre of the viewport. */
  center: Vec2;
  /** Viewport centre and size on the paper, mm. */
  position: Vec2;
  width: number;
  height: number;
  /** Draw the "SCALE 1:2" label and the view name under the viewport. */
  label: boolean;
}

export interface Sheet {
  id: Id;
  name: string;
  size: SheetSize;
  orientation: 'landscape' | 'portrait';
  /** Title block values by ISO 7200 field id (library/title-blocks/iso-7200.json). */
  titleBlock: Record<string, string>;
  views: SheetView[];
}

export interface Document {
  format: typeof FORMAT_NAME;
  version: typeof FORMAT_VERSION;
  /** Always millimetres in files (product rule 1). The UI may display other units later. */
  unit: 'mm';
  name: string;
  description?: string;
  standard: Standard;
  projection: Projection;
  layers: Record<Id, Layer>;
  /** Drawing order of layers (bottom first). */
  layerOrder: Id[];
  activeLayer: Id;
  entities: Record<Id, Entity>;
  /** Drawing order of entities (first drawn first). */
  entityOrder: Id[];
  dimStyle: DimStyle;
  sheets: Record<Id, Sheet>;
  sheetOrder: Id[];
}
