// Preload: exposes the typed API from shared/api.ts as window.mechpilot. No Node, file system or
// network access leaks to the renderer.

import { contextBridge, ipcRenderer } from 'electron';
import type { MechPilotApi } from '@shared/api';

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: MechPilotApi = {
  app: {
    version: call('app:version'),
    platform: call('app:platform'),
    openExternal: call('app:openExternal'),
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
  },
  samples: {
    list: call('samples:list'),
    read: call('samples:read'),
  },
  files: {
    open: call('files:open'),
    save: call('files:save'),
  },
};

contextBridge.exposeInMainWorld('mechpilot', api);
