// The typed protocol between the renderer and the 3D kernel worker (replicad on opencascade.js,
// LGPL, app/workers/kernel). The UI depends on these shapes only, never on the engine.

import type { Lang } from '../api';
import type { Document, Id, Part, SketchPlane } from '../doc/types';

/** A triangle mesh plus the sharp edges, ready for three.js (flat arrays, structured-clonable). */
export interface PartMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Edge segments as pairs of points: [x0,y0,z0, x1,y1,z1, ...]. */
  edges: Float32Array;
  /** For every triangle, the index of the face it belongs to (for picking). */
  faceIds: Uint32Array;
}

export interface MassProperties {
  /** mm³ */
  volume: number;
  /** mm² */
  area: number;
  /** mm */
  centerOfMass: [number, number, number];
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export interface FeatureError {
  feature: Id;
  /** Plain words (product rule 5): what happened and a way out. Translated by the caller with t(). */
  message: string;
  hint?: string;
}

export interface BuildResult {
  /** The mesh of the body after the last feature that built; null when nothing built at all. */
  mesh: PartMesh | null;
  properties: MassProperties | null;
  /** ok = built; failed = this feature could not be built (the body continues without it); skipped = suppressed or depends on a failed feature. */
  status: Record<Id, 'ok' | 'failed' | 'skipped'>;
  errors: FeatureError[];
  /** Build time in ms (product rule 8). */
  ms: number;
}

export interface SectionResult {
  /** Closed polylines of the section outline, in the plane's 2D coordinates (mm), plus 3D for display. */
  loops: { x: number; y: number }[][];
  loops3d: [number, number, number][][];
}

export type KernelSpec = {
  /** Build a part's feature tree. `doc` carries the entities the sketches refer to. */
  build: { request: { doc: Document; partId: Id; lang?: Lang }; response: BuildResult };
  /** Export the built body. */
  exportStep: { request: { doc: Document; partId: Id }; response: { text: string } };
  exportStl: { request: { doc: Document; partId: Id; binary?: boolean }; response: { data: Uint8Array } };
  export3mf: { request: { doc: Document; partId: Id }; response: { data: Uint8Array } };
  /** Read a STEP file (text) and return its mesh and properties; the caller stores it as an `import` feature. */
  importStep: { request: { text: string; name: string }; response: { ok: true; mesh: PartMesh; properties: MassProperties } | { ok: false; message: string } };
  /** Cut the built body with a principal plane at an offset. */
  section: { request: { doc: Document; partId: Id; plane: SketchPlane; offset: number }; response: SectionResult };
  /** Project the built body for a drawing view (M5): visible and hidden edges in the view plane. */
  project: { request: { doc: Document; partId: Id; direction: 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom' | 'iso' }; response: { visible: { x: number; y: number }[][]; hidden: { x: number; y: number }[][] } };
};

/** Shortcut for the UI: the part as its feature list with a cheap structural hash for cache keys. */
export const partKey = (part: Part): string => JSON.stringify(part.features);
