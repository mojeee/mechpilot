// The solver worker's API (app/workers/solver), typed for shared/worker-protocol.ts. The renderer
// sends the whole document; the worker answers with the entities to update and a diagnosis.

import type { Document, Entity, Id, PointRef } from '../doc/types';
import type { Vec2 } from '../geometry/vec2';
import type { Lang } from '../i18n';
import type { SketchDiagnosis } from './model';
import type { Freedom, SolverAlgorithm } from './solver';

export type { Freedom, SketchDiagnosis, SolverAlgorithm };

export type SolverSpec = {
  /** Solve the sketch: the changed entities (apply them with one updateEntities command) and the diagnosis.
   *  `temporary` drags a point towards `to`; `lang` sets the language of `diagnosis.message`. */
  solve: {
    request: { doc: Document; temporary?: { ref: PointRef; to: Vec2 }; algorithm?: SolverAlgorithm; lang?: Lang };
    response: { entities: Entity[]; diagnosis: SketchDiagnosis };
  };
  /** DOF colouring: per solver entity, whether it can still move ('unknown' above `maxEntities` or when over-constrained). */
  freedom: {
    request: { doc: Document; maxEntities?: number };
    response: Record<Id, Freedom>;
  };
};
