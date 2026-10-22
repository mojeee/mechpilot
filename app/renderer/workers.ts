// Worker clients for the renderer. Each worker is created once and talks through the typed
// protocol in shared/worker-protocol.ts. The solver (M3) and the kernel (M4) are added here.

import { portOf, WorkerClient, type SmokeSpec } from '@shared/worker-protocol';

let smoke: WorkerClient<SmokeSpec> | null = null;

export function smokeWorker(): WorkerClient<SmokeSpec> {
  if (!smoke) {
    const w = new Worker(new URL('../workers/smoke/index.ts', import.meta.url), { type: 'module' });
    smoke = new WorkerClient<SmokeSpec>(portOf(w));
  }
  return smoke;
}
