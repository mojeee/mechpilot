// Smoke worker: proves the worker harness (shared/worker-protocol.ts) builds with electron-vite and
// runs inside the sandboxed renderer. The solver (M3) and the kernel (M4) follow the same shape.

import { serve, type SmokeSpec } from '@shared/worker-protocol';

serve<SmokeSpec>(self as unknown as { postMessage(m: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null }, {
  ping: ({ n }) => ({ n, pong: true }),
  burn: ({ ms }) => {
    const until = Date.now() + ms;
    let iterations = 0;
    let acc = 0;
    while (Date.now() < until) {
      for (let i = 0; i < 100_000; i++) acc += Math.sqrt(i);
      iterations += 100_000;
    }
    return { iterations: acc > -1 ? iterations : 0 };
  },
});
