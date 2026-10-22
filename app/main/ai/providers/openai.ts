// OpenAI through the Responses API with the built-in fetch (no SDK dependency).
// Docs: https://platform.openai.com/docs/api-reference/responses and the function-calling guide.
// store:false, so every turn carries the full input; reasoning items come back with
// encrypted_content and are replayed unchanged within the tool loop.

import { httpJson } from './http';
import { parseArgs, ProviderError, type AiProvider, type ChatMessage, type ChatRequest, type ChatResponse, type ToolCall, type ToolSpec } from './types';

const BASE = 'https://api.openai.com/v1';

export type OpenAiInputItem =
  | { role: 'user' | 'assistant'; content: string | { type: 'input_text'; text: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'reasoning'; [k: string]: unknown };

/** Output items as the API returns them (only the fields read here). */
export interface OpenAiOutputItem {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string; refusal?: string }[];
  [k: string]: unknown;
}

export interface OpenAiResponse {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OpenAiOutputItem[];
  error?: { message?: string } | null;
}

function replayOutput(items: OpenAiOutputItem[]): OpenAiInputItem[] {
  const out: OpenAiInputItem[] = [];
  for (const it of items) {
    if (it.type === 'reasoning') out.push({ ...it, type: 'reasoning' });
    else if (it.type === 'function_call' && it.call_id && it.name) out.push({ type: 'function_call', call_id: it.call_id, name: it.name, arguments: it.arguments ?? '{}' });
    else if (it.type === 'message') {
      const text = (it.content ?? []).map((c) => (c.type === 'output_text' ? (c.text ?? '') : '')).join('');
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

export function toOpenAiInput(messages: ChatMessage[]): OpenAiInputItem[] {
  const out: OpenAiInputItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content.map((text) => ({ type: 'input_text' as const, text })) });
    else if (m.role === 'tool') for (const r of m.results) out.push({ type: 'function_call_output', call_id: r.callId, output: r.isError ? `Error: ${r.content}` : r.content });
    else if (m.raw?.provider === 'openai' && Array.isArray(m.raw.data)) out.push(...replayOutput(m.raw.data as OpenAiOutputItem[]));
    else {
      if (m.text) out.push({ role: 'assistant', content: m.text });
      for (const c of m.toolCalls) out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) });
    }
  }
  return out;
}

export const toOpenAiTools = (tools: ToolSpec[]) => tools.map((t) => ({ type: 'function' as const, name: t.name, description: t.description, parameters: t.parameters, strict: false }));

/** The request body (pure, tested with recorded shapes). */
export function openAiBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, instructions: req.system, input: toOpenAiInput(req.messages), max_output_tokens: req.maxTokens, store: false };
  if (req.tools.length) body.tools = toOpenAiTools(req.tools);
  return body;
}

export function parseOpenAiResponse(res: OpenAiResponse): ChatResponse {
  const output = res.output ?? [];
  let text = '';
  let refused = false;
  const toolCalls: ToolCall[] = [];
  for (const it of output) {
    if (it.type === 'message') {
      for (const c of it.content ?? []) {
        if (c.type === 'output_text') text += c.text ?? '';
        else if (c.type === 'refusal') refused = true;
      }
    } else if (it.type === 'function_call' && it.name) toolCalls.push({ id: it.call_id ?? it.id ?? `call_${toolCalls.length}`, name: it.name, input: parseArgs(it.arguments) });
  }
  const reason = res.status === 'incomplete' ? res.incomplete_details?.reason : undefined;
  const stop = refused && !text ? 'refusal' : toolCalls.length ? 'tool_use' : reason === 'max_output_tokens' ? 'max_tokens' : reason === 'content_filter' ? 'refusal' : 'end';
  return { text, toolCalls, stop, raw: { provider: 'openai', data: output } };
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  constructor(private readonly apiKey: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await httpJson<OpenAiResponse>('openai', `${BASE}/responses`, { headers: this.headers(), body: openAiBody(req), timeoutMs: req.timeoutMs, signal: req.signal, key: this.apiKey });
    if (res.status === 'failed') throw new ProviderError('server', 'openai', res.error?.message ?? 'The response failed');
    return parseOpenAiResponse(res);
  }

  async check(model: string, timeoutMs = 20_000): Promise<void> {
    await httpJson('openai', `${BASE}/models/${encodeURIComponent(model)}`, { headers: this.headers(), timeoutMs, key: this.apiKey });
  }
}
