// The worker harness over a pair of fake ports: typed calls, errors, timeouts, disposal.

import { describe, expect, it } from 'vitest';
import { serve, WorkerClient, WorkerFailure, WorkerTimeout, type Port, type WorkerSpec } from '@shared/worker-protocol';

type Spec = {
  double: { request: { n: number }; response: { n: number } };
  slow: { request: { ms: number }; response: 'done' };
  boom: { request: undefined; response: never };
};

/** Two ports wired to each other, delivering asynchronously like a real MessagePort. */
function pair(): [Port, Port] {
  const a: Port = { postMessage: (m) => queueMicrotask(() => b.onmessage?.({ data: m })), onmessage: null };
  const b: Port = { postMessage: (m) => queueMicrotask(() => a.onmessage?.({ data: m })), onmessage: null };
  return [a, b];
}

function setup() {
  const [client, worker] = pair();
  serve<Spec>(worker, {
    double: ({ n }) => ({ n: n * 2 }),
    slow: ({ ms }) => new Promise((r) => setTimeout(() => r('done'), ms)),
    boom: () => {
      throw new Error('kernel exploded');
    },
  });
  return new WorkerClient<Spec>(client);
}

describe('worker protocol', () => {
  it('answers typed calls and matches responses by id', async () => {
    const c = setup();
    const [a, b] = await Promise.all([c.call('double', { n: 2 }), c.call('double', { n: 21 })]);
    expect(a).toEqual({ n: 4 });
    expect(b).toEqual({ n: 42 });
    expect(c.inFlight).toBe(0);
  });
  it('turns thrown errors into WorkerFailure with the message', async () => {
    const c = setup();
    await expect(c.call('boom', undefined)).rejects.toBeInstanceOf(WorkerFailure);
    await expect(c.call('boom', undefined)).rejects.toThrow('kernel exploded');
  });
  it('rejects unknown kinds', async () => {
    const c = setup();
    await expect((c as unknown as WorkerClient<WorkerSpec>).call('nope', {})).rejects.toThrow(/no handler/);
  });
  it('times out and says so in plain words', async () => {
    const c = setup();
    await expect(c.call('slow', { ms: 50 }, 10)).rejects.toBeInstanceOf(WorkerTimeout);
    await expect(c.call('slow', { ms: 50 }, 10)).rejects.toThrow(/did not answer "slow"/);
  });
  it('dispose rejects everything pending', async () => {
    const c = setup();
    const p = c.call('slow', { ms: 1000 });
    c.dispose();
    await expect(p).rejects.toThrow(/closed/);
  });
  it('ignores messages that are not responses', async () => {
    const [client, worker] = pair();
    const c = new WorkerClient<Spec>(client);
    worker.postMessage('noise');
    serve<Spec>(worker, { double: ({ n }) => ({ n: n * 2 }), slow: () => 'done', boom: () => undefined as never });
    expect(await c.call('double', { n: 1 })).toEqual({ n: 2 });
  });
});
