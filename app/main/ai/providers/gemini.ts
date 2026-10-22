// Google Gemini through generateContent with the built-in fetch (no SDK dependency).
// Docs: https://ai.google.dev/api/generate-content and https://ai.google.dev/gemini-api/docs/function-calling.
// The model's own content (with thought signatures) is replayed unchanged within the tool loop.

import { httpJson } from './http';
import { parseArgs, type AiProvider, type ChatMessage, type ChatRequest, type ChatResponse, type StopReason, type ToolCall, type ToolSpec } from './types';

type JsonLike = unknown;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Prefix for call ids made up because the model sent none; never sent back to Gemini. */
const LOCAL_ID = 'local-';

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function toolResponse(content: string, isError: boolean): Record<string, unknown> {
  let value: unknown = content;
  try {
    value = JSON.parse(content);
  } catch {
    // plain text result
  }
  return isError ? { error: value } : { output: value };
}

export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  const pushUser = (parts: GeminiPart[]) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user') last.parts.push(...parts);
    else out.push({ role: 'user', parts });
  };
  for (const m of messages) {
    if (m.role === 'user') pushUser(m.content.map((text) => ({ text })));
    else if (m.role === 'tool') pushUser(m.results.map((r) => ({ functionResponse: { ...(r.callId.startsWith(LOCAL_ID) ? {} : { id: r.callId }), name: r.name, response: toolResponse(r.content, r.isError) } })));
    else if (m.raw?.provider === 'gemini' && typeof m.raw.data === 'object' && m.raw.data !== null) out.push({ role: 'model', parts: (m.raw.data as GeminiContent).parts ?? [] });
    else {
      const parts: GeminiPart[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls) parts.push({ functionCall: { ...(c.id.startsWith(LOCAL_ID) ? {} : { id: c.id }), name: c.name, args: c.input } });
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
    }
  }
  return out;
}

/** Gemini's schema dialect (parametersJsonSchema): drop the keys it rejects. */
export function sanitizeForGemini(schema: JsonLike): JsonLike {
  if (Array.isArray(schema)) return schema.map(sanitizeForGemini);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, JsonLike> = {};
  for (const [k, v] of Object.entries(schema as Record<string, JsonLike>)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = sanitizeForGemini(v);
  }
  return out;
}

export const toGeminiTools = (tools: ToolSpec[]) => [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: sanitizeForGemini(t.parameters as JsonLike) })) }];

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** The request body (pure, tested with recorded shapes). */
export function geminiBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { contents: toGeminiContents(req.messages), generationConfig: { maxOutputTokens: req.maxTokens }, systemInstruction: { parts: [{ text: req.system }] } };
  if (req.tools.length) body.tools = toGeminiTools(req.tools);
  return body;
}

export function parseGeminiResponse(res: GeminiResponse): ChatResponse {
  const cand = res.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const p of parts) {
    if (p.functionCall?.name) toolCalls.push({ id: p.functionCall.id || `${LOCAL_ID}${toolCalls.length}`, name: p.functionCall.name, input: parseArgs(p.functionCall.args ?? {}) });
    else if (typeof p.text === 'string' && !p.thought) text += p.text;
  }
  const reason = cand?.finishReason ?? '';
  let stop: StopReason = 'end';
  if (toolCalls.length) stop = 'tool_use';
  else if (res.promptFeedback?.blockReason || !cand || BLOCKED.has(reason)) stop = 'refusal';
  else if (reason === 'MAX_TOKENS') stop = 'max_tokens';
  return { text, toolCalls, stop, raw: { provider: 'gemini', data: { role: 'model', parts } satisfies GeminiContent } };
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return { 'x-goog-api-key': this.apiKey };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await httpJson<GeminiResponse>('gemini', `${BASE}/models/${encodeURIComponent(req.model)}:generateContent`, { headers: this.headers(), body: geminiBody(req), timeoutMs: req.timeoutMs, signal: req.signal, key: this.apiKey });
    return parseGeminiResponse(res);
  }

  async check(model: string, timeoutMs = 20_000): Promise<void> {
    await httpJson('gemini', `${BASE}/models/${encodeURIComponent(model)}`, { headers: this.headers(), timeoutMs, key: this.apiKey });
  }
}
