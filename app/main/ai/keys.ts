// API keys for the assistant (CLAUDE.md, Security: keys never reach the renderer). A key the user
// enters is encrypted with Electron safeStorage (the OS keychain / DPAPI / libsecret) and kept as
// base64 in <dataDir>/ai-keys.json. Without OS encryption the key is not stored at all: a plain
// file would not be safe.
//
// Development fallback, only when the app is not packaged: with no stored key, the key comes from
// the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY) or from a .env.local file in
// the repository root (KEY=value lines; .env.local is git-ignored). The key is never logged and
// never put in an error message.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppError } from '@shared/api';
import type { AiProviderId } from '@shared/ai/types';
import { t } from '@shared/i18n';

export const PROVIDERS: AiProviderId[] = ['anthropic', 'openai', 'gemini'];
export const ENV_NAMES: Record<AiProviderId, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
export const KEYS_FILE = 'ai-keys.json';

/** The part of Electron's safeStorage the store needs (a fake in tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** KEY=value lines; # comments, blank lines, "export " prefixes and matching quotes are handled. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** Read KEY=value pairs from a file; missing or unreadable files give nothing. */
export function readDotEnv(path: string): Record<string, string> {
  try {
    return existsSync(path) ? parseDotEnv(readFileSync(path, 'utf8')) : {};
  } catch {
    return {};
  }
}

export interface KeyStoreOptions {
  dataDir: string;
  safeStorage: SafeStorageLike;
  /** Development only (app not packaged): environment variables to fall back on. */
  env?: Record<string, string | undefined>;
  /** Development only: the .env.local file to fall back on. */
  devEnvFile?: string | null;
}

interface KeysFile {
  version: 1;
  keys: Partial<Record<AiProviderId, string>>;
}

const keyError = (code: string, message: string, hint?: string): AppError => ({ code, message, ...(hint ? { hint } : {}) });

export class KeyStore {
  private readonly path: string;

  constructor(private readonly opts: KeyStoreOptions) {
    this.path = join(opts.dataDir, KEYS_FILE);
  }

  private read(): KeysFile {
    try {
      if (!existsSync(this.path)) return { version: 1, keys: {} };
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { keys?: unknown };
      const keys: KeysFile['keys'] = {};
      if (raw.keys && typeof raw.keys === 'object') for (const p of PROVIDERS) {
        const v = (raw.keys as Record<string, unknown>)[p];
        if (typeof v === 'string' && v) keys[p] = v;
      }
      return { version: 1, keys };
    } catch {
      return { version: 1, keys: {} };
    }
  }

  private write(f: KeysFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    if (Object.keys(f.keys).length === 0) rmSync(this.path, { force: true });
    else writeFileSync(this.path, JSON.stringify(f, null, 2) + '\n', { mode: 0o600 });
  }

  /** The stored key, decrypted; null when none or when it cannot be decrypted (another user or machine). */
  private stored(provider: AiProviderId): string | null {
    const b64 = this.read().keys[provider];
    if (!b64 || !this.opts.safeStorage.isEncryptionAvailable()) return null;
    try {
      return this.opts.safeStorage.decryptString(Buffer.from(b64, 'base64')) || null;
    } catch {
      return null;
    }
  }

  /** Development fallback: the environment first, then .env.local. */
  private devKey(provider: AiProviderId): string | null {
    const name = ENV_NAMES[provider];
    const fromEnv = this.opts.env?.[name]?.trim();
    if (fromEnv) return fromEnv;
    if (!this.opts.devEnvFile) return null;
    return readDotEnv(this.opts.devEnvFile)[name]?.trim() || null;
  }

  /** The key to call the provider with. Main process only. */
  get(provider: AiProviderId): string | null {
    return this.stored(provider) ?? this.devKey(provider);
  }

  has(provider: AiProviderId): boolean {
    return this.get(provider) !== null;
  }

  hasKey(): Record<AiProviderId, boolean> {
    return { anthropic: this.has('anthropic'), openai: this.has('openai'), gemini: this.has('gemini') };
  }

  /** Where the key in use comes from: stored by the user (safeStorage), or the development environment. */
  source(provider: AiProviderId): 'stored' | 'env' | null {
    if (this.stored(provider) !== null) return 'stored';
    return this.devKey(provider) !== null ? 'env' : null;
  }

  /** The source of every available key (providers without a key are left out). */
  keySource(): Partial<Record<AiProviderId, 'stored' | 'env'>> {
    const out: Partial<Record<AiProviderId, 'stored' | 'env'>> = {};
    for (const p of PROVIDERS) {
      const s = this.source(p);
      if (s) out[p] = s;
    }
    return out;
  }

  /** Store a key encrypted. Returns an error (without the key) when it cannot be stored safely. */
  set(provider: AiProviderId, key: string): AppError | null {
    const k = key.trim();
    if (!k) return keyError('ai_key_empty', t('The key is empty.'), t('Paste the key from your provider account.'));
    if (k.length > 400 || /\s/.test(k)) return keyError('ai_key_invalid', t('That does not look like an API key.'), t('Paste only the key, without spaces or line breaks.'));
    if (!this.opts.safeStorage.isEncryptionAvailable())
      return keyError('ai_key_unsafe', t('This computer offers no secure storage for the key, so MechPilot did not save it.'), t('On Linux, install and unlock a keyring (GNOME Keyring or KWallet), then try again.'));
    let encrypted: Buffer;
    try {
      encrypted = this.opts.safeStorage.encryptString(k);
    } catch {
      return keyError('ai_key_unsafe', t('The key could not be encrypted, so MechPilot did not save it.'), t('Try again; if it repeats, restart the computer to unlock the system keychain.'));
    }
    const f = this.read();
    f.keys[provider] = encrypted.toString('base64');
    try {
      this.write(f);
    } catch {
      return keyError('ai_key_write', t('The key could not be saved in the app data folder.'), t('Check that the folder is not read-only.'));
    }
    return null;
  }

  clear(provider: AiProviderId): void {
    const f = this.read();
    delete f.keys[provider];
    try {
      this.write(f);
    } catch {
      // Nothing to clear, or the folder is read-only: the next set reports it.
    }
  }
}
