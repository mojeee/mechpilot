// Kernel worker: B-rep solids, STEP, sections and hidden-line projection through replicad on
// opencascade.js (OpenCascade Technology as WebAssembly, LGPL-2.1-only; see NOTICE.md here). A
// separate, replaceable module: the app talks to it only through KernelSpec
// (shared/cad/protocol.ts). The engine (about 23 MB of WebAssembly) is loaded on the first request.

// The package exports its wasm only as "replicad-opencascadejs/wasm", which does not match the
// `*.wasm?url` declaration in ../env.d.ts; the relative path does, and Vite resolves it to the same
// file without the package's export map.
import wasmUrl from '../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm?url';
import { serve } from '@shared/worker-protocol';
import { setLanguage } from '@shared/i18n';
import type { KernelSpec } from '@shared/cad/protocol';
import { createKernel, type Kernel } from '@shared/cad/kernel';

let kernel: Promise<Kernel> | null = null;

/** The engine, created once and again after an abort (out of memory leaves it unusable). */
async function engine(): Promise<Kernel> {
  if (kernel) {
    const k = await kernel;
    if (k.healthy) return k;
    k.dispose();
  }
  const next = createKernel({ wasmUrl });
  kernel = next;
  next.catch(() => {
    if (kernel === next) kernel = null;
  });
  return next;
}

serve<KernelSpec>(self as unknown as { postMessage(m: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null }, {
  build: async ({ doc, partId, lang }) => {
    if (lang) setLanguage(lang);
    return (await engine()).build(doc, partId);
  },
  exportStep: async ({ doc, partId }) => ({ text: await (await engine()).exportStep(doc, partId) }),
  exportStl: async ({ doc, partId, binary }) => ({ data: await (await engine()).exportStl(doc, partId, binary ?? true) }),
  export3mf: async ({ doc, partId }) => ({ data: await (await engine()).export3mf(doc, partId) }),
  importStep: async ({ text, name }) => (await engine()).importStep(text, name),
  section: async ({ doc, partId, plane, offset }) => (await engine()).section(doc, partId, plane, offset),
  project: async ({ doc, partId, direction }) => (await engine()).project(doc, partId, direction),
});
