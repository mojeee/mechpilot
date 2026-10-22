// Typed IPC handlers: the main-process side of shared/api.ts. Every handler returns a Result or a
// plain value; nothing throws across the bridge. Messages go through t() like everything the user
// can read (CLAUDE.md, Conventions).

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AutosaveInfo, OpenedFile, Result, SampleInfo, Settings } from '@shared/api';
import { FILE_EXTENSION } from '@shared/doc/file';
import { setLanguage, t } from '@shared/i18n';
import type { SettingsStore } from './settings';

const SAMPLE_SUFFIX = FILE_EXTENSION;

export interface IpcDeps {
  settings: SettingsStore;
  /** The app's data folder (autosave lives here). */
  dataDir: string;
  /** Folder with the sample projects (samples/ in development, resources/samples when packaged). */
  samplesDir: string;
  /** Set by tests (MP_SAVE_DIR): save without a dialog into this folder. */
  saveDirOverride?: string;
}

const err = <T>(code: string, message: string, hint?: string): Result<T> => ({ ok: false, error: { code, message, hint } });
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The sample's name and description without parsing the whole document model. */
function sampleInfo(dir: string, file: string): SampleInfo | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { name?: unknown; description?: unknown };
    return {
      id: file.slice(0, -SAMPLE_SUFFIX.length),
      name: typeof raw.name === 'string' ? raw.name : file,
      description: typeof raw.description === 'string' ? raw.description : '',
    };
  } catch {
    return null;
  }
}

export function registerIpc(deps: IpcDeps): void {
  const { settings } = deps;
  setLanguage(settings.get().lang);

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:platform', () => process.platform);
  ipcMain.handle('app:openExternal', async (_e, url: unknown) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
  });

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch: unknown) => {
    const next = settings.set(typeof patch === 'object' && patch !== null ? (patch as Partial<Settings>) : {});
    setLanguage(next.lang);
    return next;
  });

  ipcMain.handle('samples:list', (): SampleInfo[] => {
    if (!existsSync(deps.samplesDir)) return [];
    return readdirSync(deps.samplesDir)
      .filter((f) => f.endsWith(SAMPLE_SUFFIX))
      .sort()
      .map((f) => sampleInfo(deps.samplesDir, f))
      .filter((s): s is SampleInfo => s !== null);
  });
  ipcMain.handle('samples:read', async (_e, id: unknown): Promise<Result<string>> => {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) return err('bad-id', t('Unknown sample.'));
    const p = join(deps.samplesDir, id + SAMPLE_SUFFIX);
    if (!existsSync(p)) return err('not-found', t('Sample "{id}" is not installed.', { id }), t('Reinstall MechPilot to restore the samples.'));
    return { ok: true, value: await readFile(p, 'utf8') };
  });

  ipcMain.handle('files:open', async (e, path: unknown): Promise<Result<OpenedFile | null>> => {
    let target = typeof path === 'string' ? path : null;
    if (!target) {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const r = await dialog.showOpenDialog(win as BrowserWindow, {
        title: t('Open drawing'),
        filters: [{ name: t('MechPilot drawing'), extensions: ['mechpilot.json', 'json'] }],
        properties: ['openFile'],
      });
      if (r.canceled || r.filePaths.length === 0) return { ok: true, value: null };
      target = r.filePaths[0];
    }
    try {
      const text = await readFile(target, 'utf8');
      settings.addRecent(target);
      return { ok: true, value: { path: target, text } };
    } catch (ex) {
      return err('read-failed', t('Could not read {name}: {reason}', { name: basename(target), reason: reason(ex) }), t('Check that the file exists and you can read it.'));
    }
  });

  ipcMain.handle('files:openDxf', async (e): Promise<Result<OpenedFile | null>> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const r = await dialog.showOpenDialog(win as BrowserWindow, {
      title: t('Import DXF'),
      filters: [{ name: 'DXF', extensions: ['dxf'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return { ok: true, value: null };
    const target = r.filePaths[0];
    try {
      return { ok: true, value: { path: target, text: await readFile(target, 'utf8') } };
    } catch (ex) {
      return err('read-failed', t('Could not read {name}: {reason}', { name: basename(target), reason: reason(ex) }), t('Check that the file exists and you can read it.'));
    }
  });

  ipcMain.handle('files:saveDxf', async (e, text: unknown, suggestedName: unknown): Promise<Result<{ path: string } | null>> => {
    if (typeof text !== 'string') return err('bad-request', t('Nothing to save.'));
    const name = (typeof suggestedName === 'string' && suggestedName ? suggestedName : 'drawing').replace(/[\\/:*?"<>|]/g, '_');
    let target: string;
    if (deps.saveDirOverride) target = join(deps.saveDirOverride, name + '.dxf');
    else {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const r = await dialog.showSaveDialog(win as BrowserWindow, { title: t('Export DXF'), defaultPath: name + '.dxf', filters: [{ name: 'DXF', extensions: ['dxf'] }] });
      if (r.canceled || !r.filePath) return { ok: true, value: null };
      target = r.filePath;
    }
    try {
      await writeFile(target, text, 'utf8');
      return { ok: true, value: { path: target } };
    } catch (ex) {
      return err('write-failed', t('Could not save {name}: {reason}', { name: basename(target), reason: reason(ex) }), t('Check that the folder exists and is not read-only.'));
    }
  });

  // Crash recovery: one autosave file in the app data folder plus a small meta file. It is removed
  // on a successful save and when the user dismisses the recovery offer.
  const autosavePath = join(deps.dataDir, 'autosave.mechpilot.json');
  const autosaveMeta = join(deps.dataDir, 'autosave.meta.json');
  ipcMain.handle('files:autosave', async (_e, text: unknown, originalPath: unknown) => {
    if (typeof text !== 'string') return;
    try {
      await mkdir(deps.dataDir, { recursive: true });
      await writeFile(autosavePath, text, 'utf8');
      const name = (/"name":\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? 'drawing').replace(/\\"/g, '"');
      await writeFile(autosaveMeta, JSON.stringify({ originalPath: typeof originalPath === 'string' ? originalPath : null, name, savedAt: new Date().toISOString() }), 'utf8');
    } catch {
      // Autosave is best effort; the next tick tries again.
    }
  });
  ipcMain.handle('files:autosaveInfo', async (): Promise<AutosaveInfo | null> => {
    if (!existsSync(autosavePath) || !existsSync(autosaveMeta)) return null;
    try {
      const meta = JSON.parse(await readFile(autosaveMeta, 'utf8')) as { name?: unknown; savedAt?: unknown };
      return { path: autosavePath, name: typeof meta.name === 'string' ? meta.name : 'drawing', savedAt: typeof meta.savedAt === 'string' ? meta.savedAt : '' };
    } catch {
      return null;
    }
  });
  ipcMain.handle('files:readAutosave', async (): Promise<Result<{ text: string; originalPath: string | null } | null>> => {
    if (!existsSync(autosavePath)) return { ok: true, value: null };
    try {
      const text = await readFile(autosavePath, 'utf8');
      let originalPath: string | null = null;
      try {
        const meta = JSON.parse(await readFile(autosaveMeta, 'utf8')) as { originalPath?: unknown };
        originalPath = typeof meta.originalPath === 'string' ? meta.originalPath : null;
      } catch {
        originalPath = null;
      }
      return { ok: true, value: { text, originalPath } };
    } catch (ex) {
      return err('read-failed', t('Could not read {name}: {reason}', { name: 'autosave', reason: reason(ex) }));
    }
  });
  ipcMain.handle('files:clearAutosave', async () => {
    await rm(autosavePath, { force: true });
    await rm(autosaveMeta, { force: true });
  });

  ipcMain.handle('files:save', async (e, path: unknown, text: unknown, suggestedName: unknown): Promise<Result<{ path: string } | null>> => {
    if (typeof text !== 'string') return err('bad-request', t('Nothing to save.'));
    let target = typeof path === 'string' ? path : null;
    if (!target) {
      const name = (typeof suggestedName === 'string' && suggestedName ? suggestedName : 'drawing').replace(/[\\/:*?"<>|]/g, '_');
      if (deps.saveDirOverride) target = join(deps.saveDirOverride, name + FILE_EXTENSION);
      else {
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
        const r = await dialog.showSaveDialog(win as BrowserWindow, {
          title: t('Save drawing'),
          defaultPath: name + FILE_EXTENSION,
          filters: [{ name: t('MechPilot drawing'), extensions: ['mechpilot.json'] }],
        });
        if (r.canceled || !r.filePath) return { ok: true, value: null };
        target = r.filePath;
      }
    }
    try {
      await writeFile(target, text, 'utf8');
      settings.addRecent(target);
      return { ok: true, value: { path: target } };
    } catch (ex) {
      return err('write-failed', t('Could not save {name}: {reason}', { name: basename(target), reason: reason(ex) }), t('Check that the folder exists and is not read-only.'));
    }
  });
}
