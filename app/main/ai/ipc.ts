// IPC handlers of the assistant (the `ai` block of shared/api.ts). Arguments arrive as unknown and
// are checked; nothing throws across the bridge; the key never leaves the main process.
//
// Channels: ai:settings, ai:setSettings, ai:setKey, ai:clearKey, ai:testKey, ai:chat, ai:cancel;
// while ai:chat runs, AssistantProgress events go to the asking window on "ai:progress".

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { Result } from '@shared/api';
import { PROVIDER_INFO, type AiProviderId, type AiSettings, type AssistantProgress, type AssistantReply } from '@shared/ai/types';
import { t } from '@shared/i18n';
import type { SettingsStore } from '../settings';
import { readAssistantRequest, runAssistant } from './assistant';
import { PROVIDERS, type KeyStore } from './keys';
import { createProvider, ProviderError, toAiError, useFake } from './providers';

export const AI_PROGRESS_CHANNEL = 'ai:progress';

export interface AiIpcDeps {
  settings: SettingsStore;
  keys: KeyStore;
  /** Scripted fake provider instead of the real ones (MP_AI_FAKE=1). */
  fake?: boolean;
}

const isProvider = (v: unknown): v is AiProviderId => typeof v === 'string' && (PROVIDERS as string[]).includes(v);
/** Model ids: letters, digits and . _ - : / @ (no spaces), at most 100 characters. */
const isModelId = (v: unknown): v is string => typeof v === 'string' && /^[\w.:/@-]{1,100}$/.test(v.trim());

export function aiSettings(deps: AiIpcDeps): AiSettings {
  const s = deps.settings.get().ai;
  const provider: AiProviderId = s && isProvider(s.provider) ? s.provider : 'anthropic';
  const model = s?.provider === provider && s.model ? s.model : PROVIDER_INFO[provider].defaultModel;
  const fake = deps.fake ?? useFake();
  const hasKey = fake ? { anthropic: true, openai: true, gemini: true } : deps.keys.hasKey();
  // With the fake provider every provider "has a key"; one the user did not store counts as the environment's.
  const keySource = fake ? { anthropic: 'env' as const, openai: 'env' as const, gemini: 'env' as const, ...deps.keys.keySource() } : deps.keys.keySource();
  return { provider, model, hasKey, keySource };
}

export function registerAiIpc(deps: AiIpcDeps): void {
  const fake = deps.fake ?? useFake();
  /** One running request per window, cancellable with ai:cancel. */
  const running = new Map<number, AbortController>();

  ipcMain.handle('ai:settings', (): AiSettings => aiSettings(deps));

  ipcMain.handle('ai:setSettings', (_e, patch: unknown): AiSettings => {
    const cur = aiSettings(deps);
    const p = typeof patch === 'object' && patch !== null ? (patch as { provider?: unknown; model?: unknown }) : {};
    const provider = isProvider(p.provider) ? p.provider : cur.provider;
    let model = isModelId(p.model) ? p.model.trim() : provider === cur.provider ? cur.model : PROVIDER_INFO[provider].defaultModel;
    if (!isModelId(model)) model = PROVIDER_INFO[provider].defaultModel;
    deps.settings.set({ ai: { provider, model } });
    return aiSettings(deps);
  });

  ipcMain.handle('ai:setKey', (_e, provider: unknown, key: unknown): Result<AiSettings> => {
    if (!isProvider(provider)) return { ok: false, error: { code: 'bad-request', message: t('Unknown AI provider.') } };
    if (typeof key !== 'string') return { ok: false, error: { code: 'ai_key_empty', message: t('The key is empty.'), hint: t('Paste the key from your provider account.') } };
    const err = deps.keys.set(provider, key);
    return err ? { ok: false, error: err } : { ok: true, value: aiSettings(deps) };
  });

  ipcMain.handle('ai:clearKey', (_e, provider: unknown): AiSettings => {
    if (isProvider(provider)) deps.keys.clear(provider);
    return aiSettings(deps);
  });

  ipcMain.handle('ai:testKey', async (_e, provider: unknown): Promise<Result<{ model: string }>> => {
    if (!isProvider(provider)) return { ok: false, error: { code: 'bad-request', message: t('Unknown AI provider.') } };
    const cur = aiSettings(deps);
    const model = cur.provider === provider ? cur.model : PROVIDER_INFO[provider].defaultModel;
    const key = deps.keys.get(provider);
    if (!key && !fake) return { ok: false, error: toAiError(new ProviderError('no_key', provider, 'No key'), provider, model) };
    try {
      await createProvider(provider, key ?? '', fake).check(model);
      return { ok: true, value: { model } };
    } catch (e) {
      return { ok: false, error: toAiError(e, provider, model) };
    }
  });

  ipcMain.handle('ai:chat', async (e: IpcMainInvokeEvent, raw: unknown): Promise<Result<AssistantReply>> => {
    const req = readAssistantRequest(raw);
    if (typeof req === 'string') return { ok: false, error: { code: 'bad-request', message: req } };
    const { provider, model } = aiSettings(deps);
    const key = deps.keys.get(provider);
    if (!key && !fake) return { ok: false, error: toAiError(new ProviderError('no_key', provider, 'No key'), provider, model) };
    const id = e.sender.id;
    if (running.has(id)) return { ok: false, error: { code: 'ai_busy', message: t('The assistant is still working on the previous request.'), hint: t('Wait for it, or stop it first.') } };
    const ctrl = new AbortController();
    running.set(id, ctrl);
    const send = (p: AssistantProgress) => {
      if (!e.sender.isDestroyed()) e.sender.send(AI_PROGRESS_CHANNEL, p);
    };
    try {
      return await runAssistant(req, { provider: createProvider(provider, key ?? '', fake), providerId: provider, model, signal: ctrl.signal, onProgress: send });
    } finally {
      running.delete(id);
    }
  });

  ipcMain.handle('ai:cancel', (e: IpcMainInvokeEvent): void => {
    running.get(e.sender.id)?.abort();
  });
}
