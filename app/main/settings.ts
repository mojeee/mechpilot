// App settings as one JSON file in the app's data folder. API keys (M7) will be stored here too,
// encrypted with Electron safeStorage; they never reach the renderer.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@shared/api';

export class SettingsStore {
  private data: Settings;

  constructor(private readonly path: string) {
    this.data = { ...DEFAULT_SETTINGS };
    try {
      if (existsSync(path)) this.data = sanitize(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      // A damaged settings file is replaced by the defaults on the next save.
    }
  }

  get(): Settings {
    return { ...this.data, recent: [...this.data.recent] };
  }

  set(patch: Partial<Settings>): Settings {
    this.data = sanitize({ ...this.data, ...patch });
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n');
    return this.get();
  }

  addRecent(path: string): Settings {
    const recent = [path, ...this.data.recent.filter((p) => p !== path)].slice(0, 10);
    return this.set({ recent });
  }
}

function sanitize(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;
  return {
    theme: r.theme === 'light' ? 'light' : 'dark',
    canvas: r.canvas === 'white' ? 'white' : 'dark',
    lang: r.lang === 'it' ? 'it' : 'en',
    recent: Array.isArray(r.recent) ? r.recent.filter((p): p is string => typeof p === 'string').slice(0, 10) : [],
  };
}
