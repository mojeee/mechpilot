// The 3D kernel: OpenCascade (opencascade.js custom build `replicad-opencascadejs`, LGPL-2.1-only)
// driven through replicad (MIT). A separate, replaceable module (CLAUDE.md, Licences; notice in
// app/workers/kernel/NOTICE.md): it runs in the kernel worker (app/workers/kernel) and in Node
// tests; the rest of the app talks to it only through KernelSpec (shared/cad/protocol.ts).
//
// The engine is loaded once per kernel. After an abort (out of memory, a crash in the WebAssembly
// module) `healthy` turns false and the owner creates a new kernel.

import opencascade from 'replicad-opencascadejs';
import type { OpenCascadeInstance } from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { Document, Id, SketchPlane } from '../doc/types';
import { t } from '../i18n';
import type { BuildResult, KernelSpec, SectionResult } from './protocol';
import { buildPart, clearBuildCache, EngineAbort, export3mf, exportStep, exportStl, importStepText, isAbort, project, section, type ViewDirection } from './build';

export interface Kernel {
  build(doc: Document, partId: Id): Promise<BuildResult>;
  exportStep(doc: Document, partId: Id): Promise<string>;
  exportStl(doc: Document, partId: Id, binary?: boolean): Promise<Uint8Array>;
  export3mf(doc: Document, partId: Id): Promise<Uint8Array>;
  importStep(text: string, name: string): Promise<KernelSpec['importStep']['response']>;
  section(doc: Document, partId: Id, plane: SketchPlane, offset: number): Promise<SectionResult>;
  project(doc: Document, partId: Id, direction: ViewDirection): Promise<KernelSpec['project']['response']>;
  /** False after the engine aborted: create a new kernel. */
  readonly healthy: boolean;
  /** Drop the cached bodies; the kernel is not used afterwards. */
  dispose(): void;
}

export interface CreateKernelOptions {
  /** URL of replicad_single.wasm (Vite: `import wasmUrl from '…/replicad_single.wasm?url'`). */
  wasmUrl?: string;
  /** File path of replicad_single.wasm (Node). Without either, the module finds its own file. */
  wasmPath?: string;
}

type Init = (config?: Record<string, unknown>) => Promise<OpenCascadeInstance>;

export async function createKernel(opts: CreateKernelOptions = {}): Promise<Kernel> {
  let healthy = true;
  let disposed = false;
  const config: Record<string, unknown> = {
    // Emscripten calls this when the module aborts; its state cannot be trusted afterwards.
    onAbort: () => {
      healthy = false;
    },
    // OpenCascade prints transfer statistics on every STEP read and write: keep the console quiet.
    print: () => undefined,
  };
  const location = opts.wasmUrl ?? opts.wasmPath;
  if (location) config.locateFile = (path: string) => (path.endsWith('.wasm') ? location : path);
  const oc = await (opencascade as Init)(config);

  /** Run one operation on this engine; an abort marks the kernel unhealthy. */
  const run = async <T>(fn: () => T): Promise<T> => {
    if (disposed) throw new Error(t('The 3D kernel was closed.'));
    if (!healthy) throw new EngineAbort(t('The 3D kernel stopped after an error; it is being restarted.'));
    setOC(oc);
    try {
      return fn();
    } catch (e) {
      if (isAbort(e)) healthy = false;
      throw e;
    }
  };

  return {
    build: (doc, partId) => run(() => buildPart(doc, partId)),
    exportStep: (doc, partId) => run(() => exportStep(doc, partId)),
    exportStl: (doc, partId, binary = true) => run(() => exportStl(doc, partId, binary)),
    export3mf: (doc, partId) => run(() => export3mf(doc, partId)),
    importStep: (text, name) => run(() => importStepText(text, name)),
    section: (doc, partId, plane, offset) => run(() => section(doc, partId, plane, offset)),
    project: (doc, partId, direction) => run(() => project(doc, partId, direction)),
    get healthy() {
      return healthy && !disposed;
    },
    dispose() {
      disposed = true;
      clearBuildCache();
    },
  };
}
