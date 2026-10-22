// The key store (app/main/ai/keys.ts): keys are kept only encrypted, refused when the OS offers no
// encryption, and in development fall back to the environment and .env.local.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyStore, KEYS_FILE, parseDotEnv, type SafeStorageLike } from '../app/main/ai/keys';

/** A reversible stand-in for Electron safeStorage (the real one needs the OS keychain). */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC:' + [...s].reverse().join(''), 'utf8'),
    decryptString: (b) => {
      const s = b.toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('not ours');
      return [...s.slice(4)].reverse().join('');
    },
  };
}

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mp-keys-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KEY = 'sk-ant-api03-ABCDEFGHIJKLMNOP';

describe('key store', () => {
  it('round-trips an encrypted key and never writes it in plain text', () => {
    const dir = tmp();
    const store = new KeyStore({ dataDir: dir, safeStorage: fakeSafeStorage() });
    expect(store.hasKey()).toEqual({ anthropic: false, openai: false, gemini: false });
    expect(store.set('anthropic', `  ${KEY}\n`)).toBeNull();
    expect(store.get('anthropic')).toBe(KEY);
    expect(store.hasKey()).toEqual({ anthropic: true, openai: false, gemini: false });
    const file = readFileSync(join(dir, KEYS_FILE), 'utf8');
    expect(file).not.toContain(KEY);
    expect(JSON.parse(file).keys.anthropic).toBe(Buffer.from('ENC:' + [...KEY].reverse().join('')).toString('base64'));
    // A second store on the same folder reads it back.
    expect(new KeyStore({ dataDir: dir, safeStorage: fakeSafeStorage() }).get('anthropic')).toBe(KEY);
    store.clear('anthropic');
    expect(store.get('anthropic')).toBeNull();
    expect(existsSync(join(dir, KEYS_FILE))).toBe(false);
  });

  it('refuses to store a key without OS encryption, and says so without the key', () => {
    const dir = tmp();
    const store = new KeyStore({ dataDir: dir, safeStorage: fakeSafeStorage(false) });
    const err = store.set('openai', KEY);
    expect(err?.code).toBe('ai_key_unsafe');
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(existsSync(join(dir, KEYS_FILE))).toBe(false);
    expect(store.get('openai')).toBeNull();
  });

  it('rejects empty and malformed keys', () => {
    const store = new KeyStore({ dataDir: tmp(), safeStorage: fakeSafeStorage() });
    expect(store.set('gemini', '   ')?.code).toBe('ai_key_empty');
    expect(store.set('gemini', 'two words')?.code).toBe('ai_key_invalid');
  });

  it('ignores a stored key it cannot decrypt (another machine)', () => {
    const dir = tmp();
    writeFileSync(join(dir, KEYS_FILE), JSON.stringify({ version: 1, keys: { anthropic: Buffer.from('garbage').toString('base64') } }));
    expect(new KeyStore({ dataDir: dir, safeStorage: fakeSafeStorage() }).get('anthropic')).toBeNull();
  });

  it('falls back to the environment, then .env.local, in development only', () => {
    const dir = tmp();
    const envFile = join(dir, '.env.local');
    writeFileSync(envFile, '# local keys\nOPENAI_API_KEY="sk-from-file"\nexport GEMINI_API_KEY=AIza-from-file # comment\n');
    const dev = new KeyStore({ dataDir: dir, safeStorage: fakeSafeStorage(), env: { ANTHROPIC_API_KEY: 'sk-ant-from-env', OPENAI_API_KEY: '' }, devEnvFile: envFile });
    expect(dev.get('anthropic')).toBe('sk-ant-from-env');
    expect(dev.get('openai')).toBe('sk-from-file');
    expect(dev.get('gemini')).toBe('AIza-from-file');
    expect(dev.hasKey()).toEqual({ anthropic: true, openai: true, gemini: true });
    expect(dev.keySource()).toEqual({ anthropic: 'env', openai: 'env', gemini: 'env' });
    // A stored key wins over the fallback.
    dev.set('anthropic', KEY);
    expect(dev.get('anthropic')).toBe(KEY);
    expect(dev.keySource()).toEqual({ anthropic: 'stored', openai: 'env', gemini: 'env' });
    // Packaged: no environment, no .env.local.
    const packaged = new KeyStore({ dataDir: tmp(), safeStorage: fakeSafeStorage(), devEnvFile: null });
    expect(packaged.hasKey()).toEqual({ anthropic: false, openai: false, gemini: false });
    expect(packaged.keySource()).toEqual({});
  });
});

describe('.env.local parsing', () => {
  it('reads KEY=value lines', () => {
    expect(
      parseDotEnv(['# comment', '', 'A=1', 'B = two ', "C='quoted # not a comment'", 'D="double"', 'export E=e', 'F=value # trailing', 'not a line', 'G=', 'H=a=b'].join('\r\n')),
    ).toEqual({ A: '1', B: 'two', C: 'quoted # not a comment', D: 'double', E: 'e', F: 'value', G: '', H: 'a=b' });
  });
});
