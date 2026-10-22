// Request and response mapping of the real providers with recorded shapes (no network): Anthropic
// through the SDK with a recording fetch, OpenAI and Gemini through the fetch helper. Errors become
// typed ProviderErrors in plain words and never contain the key.

import { afterEach, describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { anthropicParams, AnthropicProvider, mapAnthropicError, parseAnthropicResponse, toAnthropicMessages } from '../app/main/ai/providers/anthropic';
import { openAiBody, OpenAiProvider, parseOpenAiResponse } from '../app/main/ai/providers/openai';
import { geminiBody, GeminiProvider, parseGeminiResponse, toGeminiContents } from '../app/main/ai/providers/gemini';
import { httpError, httpJson, transport } from '../app/main/ai/providers/http';
import { ProviderError, scrub, type ChatMessage, type ChatRequest } from '../app/main/ai/providers/types';
import { toAiError } from '../app/main/ai/providers';
import { TOOL_SPECS } from '@shared/ai/tools';

const KEY = 'sk-ant-test-0123456789abcdef';

const messages: ChatMessage[] = [
  { role: 'user', content: ['<drawing>{}</drawing>'] },
  { role: 'user', content: ['Draw a plate'] },
  { role: 'assistant', text: 'Reading.', toolCalls: [{ id: 't1', name: 'read_model', input: {} }] },
  { role: 'tool', results: [{ callId: 't1', name: 'read_model', content: '{"entityCount":0}', isError: false }] },
];
const req = (model: string): ChatRequest => ({ model, system: 'SYSTEM', messages, tools: TOOL_SPECS, maxTokens: 1000, cacheSystem: true });

describe('anthropic mapping', () => {
  it('caches the system prompt and the tools, merges user turns, maps tool results', () => {
    const p = anthropicParams(req('claude-opus-5-5'));
    expect(p.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(p.tools?.[p.tools.length - 1]).toMatchObject({ name: 'propose', cache_control: { type: 'ephemeral' } });
    expect(p.tools?.[0]).not.toHaveProperty('cache_control');
    expect(p.messages).toHaveLength(3);
    expect(p.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '<drawing>{}</drawing>' }, { type: 'text', text: 'Draw a plate' }] });
    expect(p.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 't1', name: 'read_model', input: {} }] });
    expect(p.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"entityCount":0}', is_error: false }] });
    expect(p.output_config).toEqual({ effort: 'medium' });
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    const old = anthropicParams(req('claude-haiku-4-5-20251001'));
    expect(old.output_config).toBeUndefined();
    expect(old.fallbacks).toBeUndefined();
    expect(anthropicParams(req('claude-haiku-5-5')).fallbacks).toBeUndefined();
  });

  it('replays its own content blocks unchanged (thinking included)', () => {
    const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'x', name: 'measure', input: { entity: 'a' } }];
    const out = toAnthropicMessages([{ role: 'user', content: ['q'] }, { role: 'assistant', text: '', toolCalls: [], raw: { provider: 'anthropic', data: raw } }]);
    expect(out[1]).toEqual({ role: 'assistant', content: raw });
  });

  it('parses a recorded response', () => {
    const r = parseAnthropicResponse({
      content: [
        { type: 'thinking', thinking: '', signature: 'abc' },
        { type: 'text', text: 'Let me look.', citations: null },
        { type: 'tool_use', id: 'toolu_1', name: 'read_model', input: { offset: 0 }, caller: { type: 'direct' } },
      ] as unknown as Anthropic.Beta.Messages.BetaContentBlock[],
      stop_reason: 'tool_use',
    });
    expect(r.text).toBe('Let me look.');
    expect(r.toolCalls).toEqual([{ id: 'toolu_1', name: 'read_model', input: { offset: 0 } }]);
    expect(r.stop).toBe('tool_use');
    expect(parseAnthropicResponse({ content: [], stop_reason: 'refusal' }).stop).toBe('refusal');
  });

  it('maps SDK errors to plain kinds without the key', () => {
    const auth = mapAnthropicError(Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, undefined, new Headers()), KEY) as ProviderError;
    expect(auth.kind).toBe('auth');
    expect(auth.message).not.toContain(KEY);
    expect((mapAnthropicError(Anthropic.APIError.generate(429, { error: { message: 'slow down' } }, undefined, new Headers())) as ProviderError).kind).toBe('rate');
    expect((mapAnthropicError(Anthropic.APIError.generate(404, { error: { message: 'model: nope' } }, undefined, new Headers())) as ProviderError).kind).toBe('model');
    expect((mapAnthropicError(Anthropic.APIError.generate(400, { error: { message: 'Your credit balance is too low' } }, undefined, new Headers())) as ProviderError).kind).toBe('quota');
    expect((mapAnthropicError(Anthropic.APIError.generate(529, { error: { message: 'Overloaded' } }, undefined, new Headers())) as ProviderError).kind).toBe('rate');
    expect((mapAnthropicError(new Anthropic.APIConnectionError({ message: 'down' })) as ProviderError).kind).toBe('offline');
    expect((mapAnthropicError(new Anthropic.APIUserAbortError()) as ProviderError).kind).toBe('cancelled');
  });

  it('sends the request through the SDK and reads the answer (recording fetch)', async () => {
    const seen: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      const body = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Hello.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const p = new AnthropicProvider(KEY, { fetch, maxRetries: 0 });
    const r = await p.chat(req('claude-haiku-5-5'));
    expect(r).toMatchObject({ text: 'Hello.', stop: 'end', toolCalls: [] });
    expect(seen[0].url).toMatch(/\/v1\/messages/);
    // SDK 1.x sends the key as a bearer token, to api.anthropic.com whatever ANTHROPIC_BASE_URL says.
    expect(seen[0].headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(seen[0].url.startsWith('https://api.anthropic.com/v1/messages')).toBe(true);
    expect(seen[0].body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1000 });
  });
});

describe('openai mapping', () => {
  it('builds a Responses API body and parses a recorded answer', () => {
    const b = openAiBody(req('gpt-5.1'));
    expect(b).toMatchObject({ model: 'gpt-5.1', instructions: 'SYSTEM', store: false, max_output_tokens: 1000 });
    expect(b.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: '<drawing>{}</drawing>' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Draw a plate' }] },
      { role: 'assistant', content: 'Reading.' },
      { type: 'function_call', call_id: 't1', name: 'read_model', arguments: '{}' },
      { type: 'function_call_output', call_id: 't1', output: '{"entityCount":0}' },
    ]);
    expect((b.tools as { type: string; name: string }[])[0]).toMatchObject({ type: 'function', name: 'read_model' });
    const r = parseOpenAiResponse({
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'xyz', summary: [] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'measure', arguments: '{"entity":"h1"}' },
      ],
    });
    expect(r.toolCalls).toEqual([{ id: 'call_1', name: 'measure', input: { entity: 'h1' } }]);
    expect(r.stop).toBe('tool_use');
    expect(parseOpenAiResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }] })).toMatchObject({ text: 'Hi', stop: 'end' });
    expect(parseOpenAiResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }).stop).toBe('max_tokens');
  });
});

describe('gemini mapping', () => {
  it('builds a generateContent body and parses a recorded answer', () => {
    const b = geminiBody(req('gemini-3.1-pro'));
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'SYSTEM' }] });
    const contents = b.contents as { role: string; parts: unknown[] }[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[0].parts).toEqual([{ text: '<drawing>{}</drawing>' }, { text: 'Draw a plate' }]);
    expect(contents[2].parts).toEqual([{ functionResponse: { id: 't1', name: 'read_model', response: { output: { entityCount: 0 } } } }]);
    const decl = (b.tools as { functionDeclarations: { name: string; parametersJsonSchema: unknown }[] }[])[0].functionDeclarations;
    expect(decl.map((d) => d.name)).toEqual(TOOL_SPECS.map((t) => t.name));
    const r = parseGeminiResponse({ candidates: [{ content: { role: 'model', parts: [{ text: 'thinking', thought: true }, { functionCall: { name: 'read_model', args: {} }, thoughtSignature: 'sig' }] }, finishReason: 'STOP' }] });
    expect(r.toolCalls).toEqual([{ id: 'local-0', name: 'read_model', input: {} }]);
    expect(r.text).toBe('');
    // A made-up id is never sent back.
    const back = toGeminiContents([{ role: 'assistant', text: '', toolCalls: r.toolCalls }, { role: 'tool', results: [{ callId: 'local-0', name: 'read_model', content: '{}', isError: false }] }]);
    expect(back[1].parts[0].functionResponse).toEqual({ name: 'read_model', response: { output: {} } });
    expect(parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }).stop).toBe('refusal');
  });
});

describe('http errors, timeouts and cancel', () => {
  const realFetch = transport.fetch;
  afterEach(() => {
    transport.fetch = realFetch;
  });

  it('maps recorded error bodies', () => {
    expect(httpError('openai', 401, { error: { message: 'Incorrect API key provided: sk-abcdefghijklmnopqrstu', code: 'invalid_api_key' } }).kind).toBe('auth');
    expect(httpError('openai', 401, { error: { message: 'Incorrect API key provided: sk-abcdefghijklmnopqrstu' } }).message).not.toContain('sk-abcdefghijklmnopqrstu');
    expect(httpError('openai', 429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }).kind).toBe('quota');
    expect(httpError('openai', 429, { error: { message: 'Rate limit' } }).kind).toBe('rate');
    expect(httpError('gemini', 400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }).kind).toBe('auth');
    expect(httpError('gemini', 404, { error: { message: 'models/x is not found', status: 'NOT_FOUND' } }).kind).toBe('model');
    expect(httpError('gemini', 503, { error: { message: 'overloaded' } }).kind).toBe('server');
  });

  it('sends the key in a header, never in the URL', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    transport.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }), { status: 200 });
    }) as typeof fetch;
    const r = await new GeminiProvider('AIzaTESTKEY_0123456789abcdefgh').chat(req('gemini-3.1-pro'));
    expect(r.text).toBe('ok');
    expect(seen[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent');
    expect(seen[0].headers['x-goog-api-key']).toBe('AIzaTESTKEY_0123456789abcdefgh');
    transport.fetch = (async () => new Response(JSON.stringify({ output: [] }), { status: 200 })) as typeof fetch;
    await new OpenAiProvider('sk-test').check('gpt-5.1');
  });

  it('times out and cancels as typed errors', async () => {
    transport.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
    await expect(httpJson('openai', 'https://x.invalid', { headers: {}, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
    const ctrl = new AbortController();
    const p = httpJson('openai', 'https://x.invalid', { headers: {}, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
    transport.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as typeof fetch;
    await expect(httpJson('gemini', 'https://x.invalid', { headers: {} })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('turns every error into plain words with a hint, never with the key', () => {
    for (const kind of ['auth', 'quota', 'rate', 'offline', 'timeout', 'model', 'server', 'bad_request', 'refused', 'cancelled', 'no_key'] as const) {
      const e = toAiError(new ProviderError(kind, 'anthropic', `boom ${KEY}`, 500), 'anthropic', 'claude-opus-5-5');
      expect(e.code).toMatch(/^ai_/);
      expect(e.message.length).toBeGreaterThan(5);
      expect(JSON.stringify(e)).not.toContain(KEY);
    }
    expect(toAiError(new Error(`weird ${KEY}`), 'openai', 'gpt-5.1').message).not.toContain(KEY);
    expect(scrub(`key ${KEY} here`)).toBe('key [key] here');
  });
});
