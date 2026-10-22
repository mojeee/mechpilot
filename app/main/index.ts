// Electron main process entry. Owns the window, settings and files; the renderer is sandboxed and
// talks to it only through the typed API in shared/api.ts (CLAUDE.md, Security).

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { registerIpc } from './ipc';
import { SettingsStore } from './settings';

// MP_PROFILE=<dir>: use this folder as the app's data. End-to-end tests and screenshots start from
// a clean profile, so nothing remembered by an earlier run changes what they see.
if (process.env.MP_PROFILE) app.setPath('userData', process.env.MP_PROFILE);
const dataDir = app.getPath('userData');
const settings = new SettingsStore(join(dataDir, 'settings.json'));
const samplesDir = app.isPackaged ? join(process.resourcesPath, 'samples') : join(app.getAppPath(), 'samples');

function createWindow(): void {
  const dark = settings.get().theme !== 'light';
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: dark ? '#15191e' : '#f3f5f7',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } } : { autoHideMenuBar: true }),
    title: 'MechPilot',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!process.env.MP_SNAPSHOT) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const hash = process.env.MP_HASH ?? '';
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + hash);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.replace(/^#/, '') });

  // Developer aid: MP_SNAPSHOT=/path.png captures the window after MP_SNAPSHOT_DELAY ms and quits
  // (website screenshots, M8).
  if (process.env.MP_SNAPSHOT) {
    const out = process.env.MP_SNAPSHOT;
    const delay = Number(process.env.MP_SNAPSHOT_DELAY ?? 4000);
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        await writeFile(out, out.endsWith('.jpg') ? img.toJPEG(88) : img.toPNG());
        app.quit();
      }, delay);
    });
  }
}

void app.whenReady().then(() => {
  registerIpc({ settings, samplesDir, saveDirOverride: process.env.MP_SAVE_DIR });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
