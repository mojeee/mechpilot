// The document model: pure data, millimetres, double precision (product rule 1). This is also the
// file format (docs/file-format.md): a document serializes as it is, with stable ordering.

import type { Vec2 } from '../geometry/vec2';

export type Id = string;

/** Bumped on every change of shape; shared/doc/file.ts migrates older files.
 *  1: M0 (line, circle, arc). 2: M1 adds polyline, ellipse, spline, text. */
export const FORMAT_VERSION = 2;
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
export type Entity = LineEntity | CircleEntity | ArcEntity | PolylineEntity | EllipseEntity | SplineEntity | TextEntity;
export type EntityType = Entity['type'];

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
}
