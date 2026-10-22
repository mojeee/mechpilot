// The document model: pure data, millimetres, double precision (product rule 1). This is also the
// file format (docs/file-format.md): a document serializes as it is, with stable ordering.

import type { Vec2 } from '../geometry/vec2';

export type Id = string;

/** Bumped on every change of shape; shared/doc/file.ts migrates older files. */
export const FORMAT_VERSION = 1;
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
export type Entity = LineEntity | CircleEntity | ArcEntity;
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
