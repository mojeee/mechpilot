// Preload: exposes the typed API from shared/api.ts as window.mechpilot. No Node, file system or
// network access leaks to the renderer.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { MechPilotApi } from '@shared/api';
import type { AssistantProgress } from '@shared/ai/types';

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: MechPilotApi = {
  ai: {
    settings: call('ai:settings'),
    setSettings: call('ai:setSettings'),
    setKey: call('ai:setKey'),
    clearKey: call('ai:clearKey'),
    testKey: call('ai:testKey'),
    chat: call('ai:chat'),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: AssistantProgress) => cb(p);
      ipcRenderer.on('ai:progress', listener);
      return () => {
        ipcRenderer.removeListener('ai:progress', listener);
      };
    },
    cancel: call('ai:cancel'),
  },
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
    openDxf: call('files:openDxf'),
    saveDxf: call('files:saveDxf'),
    savePdf: call('files:savePdf'),
    openText: call('files:openText'),
    saveBytes: call('files:saveBytes'),
    autosave: call('files:autosave'),
    autosaveInfo: call('files:autosaveInfo'),
    readAutosave: call('files:readAutosave'),
    clearAutosave: call('files:clearAutosave'),
  },
};

contextBridge.exposeInMainWorld('mechpilot', api);
