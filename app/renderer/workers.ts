// Worker clients for the renderer. Each worker is created once and talks through the typed
// protocol in shared/worker-protocol.ts. The solver (M3) and the kernel (M4) are added here.

import { portOf, WorkerClient, type SmokeSpec } from '@shared/worker-protocol';
import type { SolverSpec } from '@shared/sketch/protocol';

let smoke: WorkerClient<SmokeSpec> | null = null;
let solver: WorkerClient<SolverSpec> | null = null;

/** The sketch constraint solver (planegcs, LGPL, app/workers/solver): created on first use. */
export function solverWorker(): WorkerClient<SolverSpec> {
  if (!solver) {
    const w = new Worker(new URL('../workers/solver/index.ts', import.meta.url), { type: 'module' });
    solver = new WorkerClient<SolverSpec>(portOf(w));
  }
  return solver;
}

export function smokeWorker(): WorkerClient<SmokeSpec> {
  if (!smoke) {
    const w = new Worker(new URL('../workers/smoke/index.ts', import.meta.url), { type: 'module' });
    smoke = new WorkerClient<SmokeSpec>(portOf(w));
  }
  return smoke;
}
