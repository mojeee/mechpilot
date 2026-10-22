// Typed request/response protocol between the renderer and its workers (solver, kernel). The UI
// never waits synchronously: every call is a promise with a timeout (product rule 8). The transport
// is abstract (postMessage + onmessage) so the same code runs over a real Worker, a MessageChannel,
// or a pair of fakes in tests.

import type { AppError } from './api';

/** A worker's API: request and response shapes per message kind. */
export type WorkerSpec = Record<string, { request: unknown; response: unknown }>;

export interface WorkerRequest {
  id: number;
  kind: string;
  payload: unknown;
}
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: AppError };

/** The subset of Worker / DedicatedWorkerGlobalScope / MessagePort that the protocol needs. */
export interface Port {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

/** Wrap a real Worker (or MessagePort) as a Port: the DOM types want a full MessageEvent handler. */
export function portOf(target: { postMessage(message: unknown): void }): Port {
  let handler: Port['onmessage'] = null;
  return {
    postMessage: (m) => target.postMessage(m),
    get onmessage() {
      return handler;
    },
    set onmessage(fn) {
      handler = fn;
      (target as unknown as { onmessage: ((ev: { data: unknown }) => void) | null }).onmessage = fn ? (ev) => fn({ data: ev.data }) : null;
    },
  };
}

export type Handlers<S extends WorkerSpec> = { [K in keyof S]: (payload: S[K]['request']) => S[K]['response'] | Promise<S[K]['response']> };

const isRequest = (v: unknown): v is WorkerRequest => typeof v === 'object' && v !== null && typeof (v as WorkerRequest).id === 'number' && typeof (v as WorkerRequest).kind === 'string';
const isResponse = (v: unknown): v is WorkerResponse => typeof v === 'object' && v !== null && typeof (v as WorkerResponse).id === 'number' && typeof (v as WorkerResponse).ok === 'boolean';

/** Worker side: answer every request with the matching handler; errors become AppErrors. */
export function serve<S extends WorkerSpec>(port: Port, handlers: Handlers<S>): void {
  port.onmessage = async (ev) => {
    const msg = ev.data;
    if (!isRequest(msg)) return;
    const handler = handlers[msg.kind as keyof S];
    if (!handler) {
      port.postMessage({ id: msg.id, ok: false, error: { code: 'unknown-request', message: `The worker has no handler for "${msg.kind}".` } } satisfies WorkerResponse);
      return;
    }
    try {
      const result = await handler(msg.payload as S[keyof S]['request']);
      port.postMessage({ id: msg.id, ok: true, result } satisfies WorkerResponse);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      port.postMessage({ id: msg.id, ok: false, error: { code: 'worker-error', message } } satisfies WorkerResponse);
    }
  };
}

export class WorkerTimeout extends Error {
  constructor(
    readonly kind: string,
    readonly ms: number,
  ) {
    super(`The worker did not answer "${kind}" within ${Math.round(ms / 1000)} s.`);
    this.name = 'WorkerTimeout';
  }
}
export class WorkerFailure extends Error {
  constructor(readonly error: AppError) {
    super(error.message);
    this.name = 'WorkerFailure';
  }
}

export const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

/** Renderer side: call(kind, payload) resolves with the typed response or rejects with a WorkerFailure / WorkerTimeout. */
export class WorkerClient<S extends WorkerSpec> {
  private next = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly port: Port) {
    port.onmessage = (ev) => {
      const msg = ev.data;
      if (!isResponse(msg)) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new WorkerFailure(msg.error));
    };
  }

  call<K extends keyof S & string>(kind: K, payload: S[K]['request'], timeoutMs = DEFAULT_WORKER_TIMEOUT_MS): Promise<S[K]['response']> {
    const id = this.next++;
    return new Promise<S[K]['response']>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkerTimeout(kind, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.port.postMessage({ id, kind, payload } satisfies WorkerRequest);
    });
  }

  get inFlight(): number {
    return this.pending.size;
  }

  /** Reject everything still pending (when the worker is terminated). */
  dispose(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new WorkerFailure({ code: 'worker-closed', message: 'The worker was closed.' }));
      this.pending.delete(id);
    }
  }
}

/** The smoke worker (app/workers/smoke): proves the harness builds and runs in the sandboxed renderer. */
export type SmokeSpec = {
  ping: { request: { n: number }; response: { n: number; pong: true } };
  /** Sum a few million doubles: visible proof that work off the UI thread keeps the UI at 60 fps. */
  burn: { request: { ms: number }; response: { iterations: number } };
};
