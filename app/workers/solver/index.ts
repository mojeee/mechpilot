// Solver worker: sketch constraints through planegcs (FreeCAD's solver as WebAssembly,
// LGPL-2.0-or-later; see NOTICE.md here). A separate, replaceable module: the app talks to it only
// through SolverSpec (shared/sketch/protocol.ts). The engine is loaded on the first request.

import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { serve } from '@shared/worker-protocol';
import { setLanguage } from '@shared/i18n';
import type { SolverSpec } from '@shared/sketch/protocol';
import { createSolver, type SketchSolver } from '@shared/sketch/solver';

let solver: Promise<SketchSolver> | null = null;

/** The engine, created once and again after an abort (out of memory leaves it unusable). */
async function engine(): Promise<SketchSolver> {
  if (solver) {
    const s = await solver;
    if (s.healthy) return s;
    s.dispose();
  }
  const next = createSolver({ wasmUrl });
  solver = next;
  next.catch(() => {
    if (solver === next) solver = null;
  });
  return next;
}

serve<SolverSpec>(self as unknown as { postMessage(m: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null }, {
  solve: async ({ doc, temporary, algorithm, lang }) => {
    if (lang) setLanguage(lang);
    const s = await engine();
    return s.solve(doc, { temporary, algorithm });
  },
  freedom: async ({ doc, maxEntities }) => {
    const s = await engine();
    return s.freedom(doc, maxEntities);
  },
});
