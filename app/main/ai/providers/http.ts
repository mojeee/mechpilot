// JSON over HTTPS with the built-in fetch for the providers without an SDK (OpenAI, Gemini).
// Every call has a timeout and can be cancelled; every failure becomes a typed ProviderError
// whose message never contains the key.

import type { AiProviderId } from '@shared/ai/types';
import { DEFAULT_TIMEOUT_MS, ProviderError, scrub, type ProviderErrorKind } from './types';

interface ErrorBody {
  error?: { message?: unknown; code?: unknown; type?: unknown; status?: unknown; details?: unknown };
}

/** Map an HTTP error answer to a ProviderError. Pure, so it is unit-tested with recorded bodies. */
export function httpError(provider: AiProviderId, status: number, body: unknown, key?: string): ProviderError {
  const e = (typeof body === 'object' && body !== null ? (body as ErrorBody).error : undefined) ?? {};
  const message = scrub(typeof e.message === 'string' && e.message ? e.message : `HTTP ${status}`, key);
  const code = typeof e.code === 'string' ? e.code : '';
  const gstatus = typeof e.status === 'string' ? e.status : '';
  const details = JSON.stringify(e.details ?? '');
  let kind: ProviderErrorKind;
  if (status === 401 || code === 'invalid_api_key' || details.includes('API_KEY_INVALID') || /api key not valid|invalid api key|incorrect api key/i.test(message)) kind = 'auth';
  else if (code === 'insufficient_quota' || /billing|credit balance|insufficient.?quota/i.test(message)) kind = 'quota';
  else if (status === 403 || gstatus === 'PERMISSION_DENIED') kind = 'auth';
  else if (status === 429 || gstatus === 'RESOURCE_EXHAUSTED') kind = 'rate';
  else if (status === 404 || code === 'model_not_found' || (/model/i.test(message) && /not found|does not exist|not supported/i.test(message))) kind = 'model';
  else if (status >= 500) kind = 'server';
  else kind = 'bad_request';
  return new ProviderError(kind, provider, message, status);
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Only used to scrub error messages. */
  key?: string;
}

/** For tests: the fetch implementation (replaced to record requests without a network). */
export const transport: { fetch: typeof fetch } = { fetch: (...a) => fetch(...a) };

export async function httpJson<T>(provider: AiProviderId, url: string, opts: HttpOptions): Promise<T> {
  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const fail = (e: unknown): ProviderError => {
    if (opts.signal?.aborted) return new ProviderError('cancelled', provider, 'Cancelled');
    if (timedOut) return new ProviderError('timeout', provider, `No answer within ${Math.round(timeoutMs / 1000)} s`);
    return new ProviderError('offline', provider, scrub(e instanceof Error ? e.message : String(e), opts.key));
  };
  try {
    let res: Response;
    let text: string;
    try {
      res = await transport.fetch(url, {
        method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
        headers: { ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...opts.headers },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (e) {
      throw fail(e);
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) throw httpError(provider, res.status, body ?? { error: { message: text.slice(0, 300) } }, opts.key);
    if (body === null) throw new ProviderError('server', provider, 'The answer was not JSON', res.status);
    return body as T;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
