// Anthropic Claude through the official SDK (@anthropic-ai/sdk). The system prompt and the tool
// list are marked for prompt caching (they are frozen per language), the tool loop replays the
// model's own content blocks unchanged (thinking blocks included), and every SDK error becomes a
// typed ProviderError without the key.
//
// Current Claude models think adaptively by default; effort is set explicitly ("medium") on the
// models that take it. For the models that support it, the server-side refusal fallback is
// requested ("default"), so a declined request is retried on a fallback model in the same call.

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_TIMEOUT_MS, parseArgs, ProviderError, scrub, type AiProvider, type ChatMessage, type ChatRequest, type ChatResponse, type StopReason, type ToolSpec } from './types';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type Block = Anthropic.Beta.Messages.BetaContentBlock;
type Tool = Anthropic.Beta.Messages.BetaTool;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Neutral messages to Anthropic messages. Consecutive user-side turns are merged. */
export function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  const pushUser = (blocks: BlockParam[]) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as BlockParam[]).push(...blocks);
    else out.push({ role: 'user', content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') pushUser(m.content.map((text): BlockParam => ({ type: 'text', text })));
    else if (m.role === 'tool') pushUser(m.results.map((r): BlockParam => ({ type: 'tool_result', tool_use_id: r.callId, content: r.content, is_error: r.isError })));
    else if (m.raw?.provider === 'anthropic' && Array.isArray(m.raw.data)) out.push({ role: 'assistant', content: m.raw.data as BlockParam[] });
    else {
      const blocks: BlockParam[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
    }
  }
  return out;
}

/** Tools; the last one carries the cache breakpoint so tools + system are cached together. */
export function toAnthropicTools(tools: ToolSpec[], cache = false): Tool[] {
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Tool['input_schema'],
    ...(cache && i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
}

/** Models that take output_config.effort (the Claude 5 generation). */
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable)-5/;
/** Models with the server-side refusal fallback in "default" mode. */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;

/** The request body (pure, tested with recorded shapes). */
export function anthropicParams(req: ChatRequest): CreateParams {
  const params: CreateParams = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: toAnthropicMessages(req.messages),
    system: [{ type: 'text', text: req.system, ...(req.cacheSystem ? { cache_control: { type: 'ephemeral' as const } } : {}) }],
  };
  if (req.tools.length) params.tools = toAnthropicTools(req.tools, req.cacheSystem);
  if (EFFORT_MODELS.test(req.model)) params.output_config = { effort: 'medium' };
  if (FALLBACK_MODELS.test(req.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

/** The parts of a Message the app needs. */
export interface AnthropicLikeMessage {
  content: Block[];
  stop_reason: string | null;
}

export function parseAnthropicResponse(msg: AnthropicLikeMessage): ChatResponse {
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const toolCalls = msg.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: parseArgs(b.input) }] : []));
  const stop: StopReason = msg.stop_reason === 'refusal' ? 'refusal' : msg.stop_reason === 'tool_use' || toolCalls.length ? 'tool_use' : msg.stop_reason === 'max_tokens' ? 'max_tokens' : 'end';
  return { text, toolCalls, stop, raw: { provider: 'anthropic', data: msg.content } };
}

export function mapAnthropicError(e: unknown, key?: string): unknown {
  if (e instanceof ProviderError) return e;
  const msg = scrub(e instanceof Error ? e.message : String(e), key);
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError('cancelled', 'anthropic', 'Cancelled');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError('auth', 'anthropic', msg, e.status);
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('rate', 'anthropic', msg, 429);
  if (e instanceof Anthropic.NotFoundError) return new ProviderError('model', 'anthropic', msg, 404);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', 'anthropic', msg);
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError('offline', 'anthropic', msg);
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    if (/credit balance|billing/i.test(msg)) return new ProviderError('quota', 'anthropic', msg, status);
    if (/model/i.test(msg) && /not found|invalid|does not exist/i.test(msg)) return new ProviderError('model', 'anthropic', msg, status);
    if (status === 529) return new ProviderError('rate', 'anthropic', msg, status);
    return new ProviderError(status >= 500 || status === 0 ? 'server' : 'bad_request', 'anthropic', msg, status);
  }
  return new ProviderError('server', 'anthropic', msg);
}

export const API_URL = 'https://api.anthropic.com';

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  /** `options` lets tests pass a recording fetch; the app passes none. */
  constructor(
    private readonly apiKey: string,
    options: Omit<NonNullable<ConstructorParameters<typeof Anthropic>[0]>, 'apiKey'> = {},
  ) {
    // The base URL and auth are explicit: an ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN or SDK profile in
    // the environment must never redirect the user's key or replace it.
    this.client = new Anthropic({ maxRetries: 2, baseURL: API_URL, authToken: null, ...options, apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    try {
      const msg = await this.client.beta.messages.create(anthropicParams(req), { timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal: req.signal });
      return parseAnthropicResponse(msg);
    } catch (e) {
      throw mapAnthropicError(e, this.apiKey);
    }
  }

  /** The Models API: proves the key and the model id without spending tokens. */
  async check(model: string, timeoutMs = 20_000): Promise<void> {
    try {
      await this.client.models.retrieve(model, {}, { timeout: timeoutMs });
    } catch (e) {
      throw mapAnthropicError(e, this.apiKey);
    }
  }
}
