// The typed API the preload script exposes to the renderer (window.mechpilot). The renderer never
// touches the file system, settings or the network directly. Every call returns a Result instead
// of throwing, so the UI can say what happened in plain words.

export interface AppError {
  code: string;
  message: string;
  hint?: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type Theme = 'dark' | 'light';
export type CanvasTheme = 'dark' | 'white';
export type Lang = 'en' | 'it';

export interface Settings {
  theme: Theme;
  canvas: CanvasTheme;
  lang: Lang;
  /** Last opened files, newest first. */
  recent: string[];
  /** The assistant's provider and model (M7). Keys are not here: they are encrypted separately. */
  ai?: { provider: AiProviderId; model: string };
}
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', canvas: 'dark', lang: 'en', recent: [] };

export interface SampleInfo {
  id: string;
  name: string;
  description: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  path: string;
  text: string;
}

import type { AiProviderId, AiSettings, AssistantProgress, AssistantReply, AssistantRequest } from './ai/types';

export interface MechPilotApi {
  /** The optional assistant (product rule 7). Keys live in the main process only. */
  ai: {
    settings(): Promise<AiSettings>;
    setSettings(patch: { provider?: AiProviderId; model?: string }): Promise<AiSettings>;
    /** Store a key (encrypted with Electron safeStorage in the app data folder). */
    setKey(provider: AiProviderId, key: string): Promise<Result<AiSettings>>;
    clearKey(provider: AiProviderId): Promise<AiSettings>;
    /** One cheap call to the provider to see that the key works. */
    testKey(provider: AiProviderId): Promise<Result<{ model: string }>>;
    /** One assistant turn: the model may call tools on the snapshot and answer with proposals. */
    chat(req: AssistantRequest): Promise<Result<AssistantReply>>;
    /** Progress of the running request. Returns the unsubscribe function. */
    onProgress(cb: (e: AssistantProgress) => void): () => void;
    cancel(): Promise<void>;
  };
  app: {
    version(): Promise<string>;
    /** process.platform: "darwin", "win32", "linux". */
    platform(): Promise<string>;
    /** Only https:// links; anything else is refused. */
    openExternal(url: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  samples: {
    list(): Promise<SampleInfo[]>;
    read(id: string): Promise<Result<string>>;
  };
  files: {
    /** Show the open dialog (or read `path` directly). null when the user cancelled. */
    open(path?: string): Promise<Result<OpenedFile | null>>;
    /** Save `text` to `path`, or ask where when `path` is null. null when the user cancelled. */
    save(path: string | null, text: string, suggestedName: string): Promise<Result<{ path: string } | null>>;
    /** Open dialog filtered to DXF. null when cancelled. */
    openDxf(): Promise<Result<OpenedFile | null>>;
    /** Save-as dialog for a DXF text. null when cancelled. */
    saveDxf(text: string, suggestedName: string): Promise<Result<{ path: string } | null>>;
    /** Save-as dialog for PDF bytes. null when cancelled. */
    savePdf(bytes: Uint8Array, suggestedName: string): Promise<Result<{ path: string } | null>>;
    /** Open dialog for a text file with the given filters (STEP, …). null when cancelled. */
    openText(filters: FileFilter[]): Promise<Result<OpenedFile | null>>;
    /** Save-as dialog for bytes with the given extension (step, stl, 3mf, …). null when cancelled. */
    saveBytes(bytes: Uint8Array, suggestedName: string, extension: string): Promise<Result<{ path: string } | null>>;
    /** Crash recovery: write the dirty document to the app data folder (product rule 3). */
    autosave(text: string, originalPath: string | null): Promise<void>;
    /** Is there an autosave from an earlier run? */
    autosaveInfo(): Promise<AutosaveInfo | null>;
    readAutosave(): Promise<Result<{ text: string; originalPath: string | null } | null>>;
    clearAutosave(): Promise<void>;
  };
}

export interface AutosaveInfo {
  path: string;
  name: string;
  /** ISO date of the autosave. */
  savedAt: string;
}
