// Provider-neutral shapes for a chat with tool use. Each provider (anthropic.ts, openai.ts,
// gemini.ts, and the scripted fake.ts) converts these to and from its own API, so the assistant
// loop (../assistant.ts) is the same for all of them.

import type { AiProviderId } from '@shared/ai/types';
import type { AiToolSpec } from '@shared/ai/tools';

export type ToolSpec = AiToolSpec;

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}

/** The provider's own record of an assistant turn, replayed unchanged to the same provider within
 *  one request (keeps Anthropic thinking blocks, Gemini thought signatures, OpenAI reasoning items). */
export interface RawTurn {
  provider: AiProviderId;
  data: unknown;
}

export type ChatMessage =
  /** A user turn: one or more text parts (the drawing snapshot, then what the user wrote). */
  | { role: 'user'; content: string[] }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: RawTurn }
  | { role: 'tool'; results: ToolResult[] };

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  /** Mark the system prompt (and tools) for caching where the provider needs it (Anthropic). */
  cacheSystem?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  raw: RawTurn;
}

export interface AiProvider {
  readonly id: AiProviderId;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** One cheap call that proves the key works and the model exists (no tokens spent where possible). */
  check(model: string, timeoutMs?: number): Promise<void>;
}

export type ProviderErrorKind = 'auth' | 'quota' | 'rate' | 'offline' | 'timeout' | 'model' | 'server' | 'bad_request' | 'refused' | 'cancelled' | 'no_key';

/** Typed error thrown by providers; mapped to plain words in index.ts (toAiError). Never carries the key. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: AiProviderId,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const DEFAULT_TIMEOUT_MS = 120_000;

/** Parse tool arguments that may arrive as a JSON string; anything that is not an object becomes {}. */
export function parseArgs(raw: unknown): Record<string, unknown> {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Remove anything that looks like an API key from a message before it is shown or logged. */
export function scrub(message: string, key?: string): string {
  let m = message;
  if (key && key.length >= 8) m = m.split(key).join('[key]');
  return m.replace(/\b(sk-ant-[\w-]{6,}|sk-[\w-]{16,}|AIza[\w-]{20,})/g, '[key]');
}
