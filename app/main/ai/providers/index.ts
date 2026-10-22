// Provider factory and the plain-language error mapping (product rule 5: errors in plain words,
// with a way out). The key is passed to the provider and never appears in an error.

import type { AppError } from '@shared/api';
import { PROVIDER_INFO, type AiProviderId } from '@shared/ai/types';
import { t } from '@shared/i18n';
import { AnthropicProvider } from './anthropic';
import { FakeProvider } from './fake';
import { GeminiProvider } from './gemini';
import { OpenAiProvider } from './openai';
import { ProviderError, scrub, type AiProvider } from './types';

export * from './types';
export { FakeProvider } from './fake';

/** True when the scripted fake provider replaces the real ones (MP_AI_FAKE=1, tests). */
export const useFake = (env: Record<string, string | undefined> = process.env): boolean => !!env.MP_AI_FAKE && env.MP_AI_FAKE !== '0';

export function createProvider(id: AiProviderId, apiKey: string, fake = useFake()): AiProvider {
  if (fake) return new FakeProvider(id);
  if (id === 'openai') return new OpenAiProvider(apiKey);
  if (id === 'gemini') return new GeminiProvider(apiKey);
  return new AnthropicProvider(apiKey);
}

/** Any provider failure as { code, message, hint } for the UI. */
export function toAiError(e: unknown, provider: AiProviderId, model: string): AppError {
  const name = PROVIDER_INFO[provider].name;
  if (!(e instanceof ProviderError)) {
    return { code: 'ai_error', message: t('The assistant failed: {reason}', { reason: scrub(e instanceof Error ? e.message : String(e)).slice(0, 300) }), hint: t('Try again.') };
  }
  switch (e.kind) {
    case 'no_key':
      return { code: 'ai_no_key', message: t('No API key is set for {provider}.', { provider: name }), hint: t('Open the assistant settings and paste your {provider} key.', { provider: name }) };
    case 'auth':
      return { code: 'ai_auth', message: t('{provider} did not accept the API key.', { provider: name }), hint: t('Open the assistant settings, check the key or paste a new one.') };
    case 'quota':
      return { code: 'ai_quota', message: t('Your {provider} account has no credit or quota left.', { provider: name }), hint: t('Check billing on the provider website, or pick another provider in the assistant settings.') };
    case 'rate':
      return { code: 'ai_rate', message: t('{provider} is busy right now.', { provider: name }), hint: t('Wait a minute and ask again.') };
    case 'offline':
      return { code: 'ai_offline', message: t('MechPilot could not reach {provider}.', { provider: name }), hint: t('Check your internet connection. Drawing, measuring and checks still work offline.') };
    case 'timeout':
      return { code: 'ai_timeout', message: t('{provider} took too long to answer.', { provider: name }), hint: t('Try again. A shorter, more specific request can help.') };
    case 'model':
      return { code: 'ai_model', message: t('The model "{model}" is not available with this key.', { model }), hint: t('Pick another model in the assistant settings.') };
    case 'refused':
      return { code: 'ai_refused', message: t('The assistant declined this request.'), hint: t('Rephrase the request about your drawing.') };
    case 'cancelled':
      return { code: 'ai_cancelled', message: t('The request was cancelled.') };
    case 'bad_request':
      return { code: 'ai_bad_request', message: t('{provider} rejected the request: {reason}', { provider: name, reason: scrub(e.message).slice(0, 300) }), hint: t('Try again. If it repeats, pick another model in the assistant settings.') };
    default:
      return { code: 'ai_server', message: t('{provider} returned an error ({status}).', { provider: name, status: e.status ?? '?' }), hint: t('Try again in a moment.') };
  }
}
