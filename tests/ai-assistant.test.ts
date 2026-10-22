// The assistant loop (app/main/ai/assistant.ts) end to end with the scripted fake provider: the
// same tool loop, validation and progress events a real model goes through, with no network.

import { describe, expect, it } from 'vitest';
import { buildMessages, MAX_TOOL_ROUNDS, readAssistantRequest, runAssistant } from '../app/main/ai/assistant';
import { FakeProvider } from '../app/main/ai/providers/fake';
import type { AiProvider, ChatRequest, ChatResponse } from '../app/main/ai/providers/types';
import { ProviderError } from '../app/main/ai/providers/types';
import type { AssistantProgress } from '@shared/ai/types';
import { apply, type Command } from '@shared/commands';
import { validate } from '@shared/doc/file';
import type { Document } from '@shared/doc/types';
import { blank, context, ids, request, sample } from './ai-helpers';

const fake = new FakeProvider('anthropic');
const run = (text: string, doc: Document, over: Parameters<typeof context>[1] = {}, refs?: Parameters<typeof request>[2]) => {
  const events: AssistantProgress[] = [];
  return runAssistant(request(text, context(doc, over), refs), { provider: fake, providerId: 'anthropic', model: 'fake', onProgress: (e) => events.push(e), newId: ids() }).then((r) => ({ r, events }));
};

function accept(doc: Document, commands: Command[]): Document {
  const r = apply(doc, { kind: 'batch', label: 'AI', commands });
  if (!r.ok) throw new Error(r.error.message);
  const v = validate(JSON.parse(JSON.stringify(r.doc)));
  if (typeof v === 'string') throw new Error(v);
  return v;
}

describe('assistant loop with the fake provider', () => {
  it('plate prompt: reads the model, looks up M6, proposes one valid plate with four circles', async () => {
    const { r, events } = await run('Draw a plate with four M6 holes', blank());
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    if (!r.ok) return;
    const reply = r.value;
    expect(reply.toolLog.map((l) => l.name)).toEqual(['read_model', 'library', 'propose']);
    expect(reply.proposals).toHaveLength(1);
    const p = reply.proposals[0];
    const after = accept(blank(), p.commands);
    const circles = after.entityOrder.map((id) => after.entities[id]).filter((e) => e.type === 'circle');
    expect(circles).toHaveLength(4);
    expect(circles.every((c) => c.type === 'circle' && c.radius === 3.3)).toBe(true);
    expect(after.entityOrder.map((id) => after.entities[id]).filter((e) => e.type === 'polyline')).toHaveLength(1);
    expect(p.touches.entities).toHaveLength(5);
    expect(reply.claims.some((c) => c.source.kind === 'library')).toBe(true);
    expect(reply.text).toMatch(/proposed/);
    expect(reply.model).toEqual({ provider: 'anthropic', model: 'fake' });
    expect(events.filter((e) => e.kind === 'tool').map((e) => (e as { name: string }).name)).toEqual(['read_model', 'library', 'propose']);
    expect(events[events.length - 1]).toEqual({ kind: 'done' });
  });

  it('answers in Italian when the context is Italian', async () => {
    const { r } = await run('Disegna una piastra', blank(), { lang: 'it' });
    expect(r.ok && r.value.text).toMatch(/Ho proposto/);
  });

  it('thicker prompt with a part reference: proposes the extrude distance + 5 mm', async () => {
    const doc = sample('sheet-metal-cover');
    const { r } = await run('Make this thicker', doc, {}, [{ kind: 'part', partId: 'cover', label: 'Cover' }]);
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    if (!r.ok) return;
    const [p] = r.value.proposals;
    expect(p.touches.parts).toEqual(['cover']);
    const after = accept(doc, p.commands);
    expect(after.parts.cover.features.find((f) => f.id === 'ex1')).toMatchObject({ distance: 30 });
    expect(after.parts.cover.features).toHaveLength(doc.parts.cover.features.length);
  });

  it('pdf prompt: proposes a sheet and dimensions, then exportPdf', async () => {
    const doc = sample('mounting-bracket');
    const { r } = await run('Make a PDF of this', doc);
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    if (!r.ok) return;
    const [p] = r.value.proposals;
    expect(p.then).toEqual({ kind: 'exportPdf' });
    expect(p.commands.map((c) => c.kind)).toEqual(['addEntities', 'addSheet']);
    const after = accept(doc, p.commands);
    expect(after.sheetOrder).toHaveLength(doc.sheetOrder.length + 1);
  });

  it('unclear prompt ("add holes"): reads the model, then asks one question with numbered options and a default', async () => {
    const doc = sample('sheet-metal-cover');
    const { r } = await run('Add holes', doc);
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    if (!r.ok) return;
    expect(r.value.proposals).toEqual([]);
    expect(r.value.toolLog.map((l) => l.name)).toEqual(['read_model']);
    expect(r.value.text).toMatch(/\?/);
    expect(r.value.text).toMatch(/^1\. .*\n2\. .*\n3\. /m);
    expect(r.value.text).toMatch(/Default/);
    const it = await run('aggiungi dei fori', doc, { lang: 'it' });
    expect(it.r.ok && it.r.value.text).toMatch(/Predefinito/);
    // With a size it is clear enough to propose: the plate script, not a question.
    const clear = await run('Add a plate with M6 holes', blank());
    expect(clear.r.ok && clear.r.value.proposals).toHaveLength(1);
  });

  it('fail prompt: a plain-language error', async () => {
    const { r, events } = await run('please fail', blank());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ai_server');
      expect(r.error.message).toContain('Claude');
    }
    expect(events[events.length - 1]).toEqual({ kind: 'done' });
  });

  it('can be cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await runAssistant(request('plate', context(blank())), { provider: fake, providerId: 'anthropic', model: 'fake', signal: ctrl.signal });
    expect(!r.ok && r.error.code).toBe('ai_cancelled');
  });
});

/** A provider that never stops calling read_model. */
class Looper implements AiProvider {
  readonly id = 'anthropic' as const;
  calls = 0;
  async chat(): Promise<ChatResponse> {
    this.calls++;
    return { text: '', toolCalls: [{ id: `c${this.calls}`, name: 'read_model', input: {} }], stop: 'tool_use', raw: { provider: 'anthropic', data: null } };
  }
  async check(): Promise<void> {}
}

/** A provider that hangs until it is aborted. */
class Hanger implements AiProvider {
  readonly id = 'openai' as const;
  chat(req: ChatRequest): Promise<ChatResponse> {
    return new Promise((_res, rej) => req.signal?.addEventListener('abort', () => rej(new ProviderError('cancelled', 'openai', 'Cancelled'))));
  }
  async check(): Promise<void> {}
}

describe('loop limits', () => {
  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds and says so`, async () => {
    const p = new Looper();
    const r = await runAssistant(request('loop', context(blank())), { provider: p, providerId: 'anthropic', model: 'x' });
    expect(r.ok).toBe(true);
    expect(p.calls).toBe(MAX_TOOL_ROUNDS + 1);
    if (r.ok) {
      expect(r.value.toolLog).toHaveLength(MAX_TOOL_ROUNDS);
      expect(r.value.text).toMatch(/stopped after 12 steps/);
    }
  });
  it('times out with a plain-language error', async () => {
    const r = await runAssistant(request('hang', context(blank())), { provider: new Hanger(), providerId: 'openai', model: 'x', timeoutMs: 50 });
    expect(!r.ok && r.error.code).toBe('ai_timeout');
  });
  it('lets the model fix a proposal that failed validation', async () => {
    let n = 0;
    const fixer: AiProvider = {
      id: 'gemini',
      async chat(req): Promise<ChatResponse> {
        n++;
        const last = req.messages[req.messages.length - 1];
        if (n === 1) return { text: '', toolCalls: [{ id: 'a', name: 'propose', input: { title: 'x', summary: '', commands: [{ kind: 'deleteEntities', ids: ['nope'] }] } }], stop: 'tool_use', raw: { provider: 'gemini', data: null } };
        if (n === 2) {
          expect(last.role === 'tool' && last.results[0].isError && last.results[0].content).toContain('nope');
          return { text: '', toolCalls: [{ id: 'b', name: 'propose', input: { title: 'Line', summary: '', commands: [{ kind: 'addEntities', entities: [{ id: '', type: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] }] } }], stop: 'tool_use', raw: { provider: 'gemini', data: null } };
        }
        return { text: 'Done.', toolCalls: [], stop: 'end', raw: { provider: 'gemini', data: null } };
      },
      async check() {},
    };
    const r = await runAssistant(request('x', context(blank())), { provider: fixer, providerId: 'gemini', model: 'x' });
    expect(r.ok && r.value.proposals.map((p) => p.title)).toEqual(['Line']);
  });
});

describe('request checks (IPC arguments)', () => {
  it('accepts a well-formed request and builds the messages with the snapshot first', () => {
    const req = readAssistantRequest(JSON.parse(JSON.stringify(request('hello', context(sample('mounting-bracket'))))));
    expect(typeof req).not.toBe('string');
    if (typeof req === 'string') return;
    const msgs = buildMessages(req);
    expect(msgs[0].role === 'user' && msgs[0].content[0]).toContain('<drawing>');
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: ['hello'] });
  });
  it('refuses malformed requests in plain words', () => {
    expect(typeof readAssistantRequest(null)).toBe('string');
    expect(typeof readAssistantRequest({ turns: [], context: {} })).toBe('string');
    const bad = JSON.parse(JSON.stringify(request('hi', context(blank()))));
    bad.context.doc.unit = 'inch';
    expect(readAssistantRequest(bad)).toMatch(/could not be read/);
  });
});
