// The assistant's contract between the renderer, the main process and the model (product rule 7:
// honest AI). The renderer owns the document; every request carries a snapshot of it, and every
// change the model wants comes back as a Proposal of ordinary commands that the user accepts or
// rejects. The API key never reaches the renderer: it is stored by the main process.

import type { AppError, Lang } from '../api';
import type { Command } from '../commands';
import type { Document, Id } from '../doc/types';
import type { BuildResult } from '../cad/protocol';

export type AiProviderId = 'anthropic' | 'openai' | 'gemini';

export interface AiModelInfo {
  id: string;
  name: string;
}

export interface ProviderInfo {
  name: string;
  /** The model used when the user has not chosen one. */
  defaultModel: string;
  /** A cheaper model for short helper calls (naming, summaries). */
  fastModel: string;
  /** Models offered in the settings; the user may type another id. */
  models: AiModelInfo[];
  keyHelp: string;
}

/** Product decision (docs/brief.md, "Decisions already made"; the demo wants the strongest model
 *  as the default): Claude Opus 5.5 by default, Haiku 4.5 as the fast model. */
export const PROVIDER_INFO: Record<AiProviderId, ProviderInfo> = {
  anthropic: {
    name: 'Claude',
    defaultModel: 'claude-opus-5-5',
    fastModel: 'claude-haiku-4-5-20251001',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
    ],
    keyHelp: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-5.1',
    fastModel: 'gpt-5.1-mini',
    models: [
      { id: 'gpt-5.1', name: 'GPT-5.1' },
      { id: 'gpt-5.1-mini', name: 'GPT-5.1 mini' },
    ],
    keyHelp: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    name: 'Gemini',
    defaultModel: 'gemini-3.1-pro',
    fastModel: 'gemini-3.1-flash',
    models: [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
      { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash' },
    ],
    keyHelp: 'https://aistudio.google.com/apikey',
  },
};

/** What the renderer may know about the assistant's configuration. Never the key itself. */
export interface AiSettings {
  provider: AiProviderId;
  model: string;
  /** Whether a key is stored (or supplied by the environment in development) per provider. */
  hasKey: Record<AiProviderId, boolean>;
  /** Where each available key comes from: stored by the user, or the development environment (.env.local / env var). */
  keySource?: Partial<Record<AiProviderId, 'stored' | 'env'>>;
}

/** Something the user pointed at. It shows as a chip in the chat and goes to the model as context. */
export type Reference =
  /** Entities selected in the 2D model or on a sheet. */
  | { kind: 'entities'; ids: Id[]; label: string }
  | { kind: 'part'; partId: Id; label: string }
  | { kind: 'feature'; partId: Id; featureId: Id; label: string }
  /** A face clicked in the 3D viewer: measured on the built mesh. */
  | { kind: 'face'; partId: Id; faceId: number; center: [number, number, number]; normal: [number, number, number]; area: number; label: string }
  /** A point clicked in 3D (a corner or an edge point), mm. */
  | { kind: 'point'; partId: Id | null; at: [number, number, number]; label: string };

/** Where a statement comes from (product rule 7: every claim shows its source). */
export type ClaimSource =
  | { kind: 'measured'; what: string }
  | { kind: 'standard'; standard: string; clause?: string }
  | { kind: 'library'; file: string; entry: string }
  | { kind: 'suggestion' };

export interface Claim {
  text: string;
  source: ClaimSource;
}

/** A change the model wants to make: ordinary commands, applied as one undo step on Accept. */
export interface Proposal {
  id: string;
  title: string;
  /** One or two sentences in plain words: what changes and why. */
  summary: string;
  commands: Command[];
  claims: Claim[];
  /** Ids the preview highlights (new or changed entities, parts whose features change). */
  touches: { entities: Id[]; parts: Id[] };
  /** Something the UI does after the commands are accepted. */
  then?: { kind: 'exportPdf' } | { kind: 'openPart'; partId: Id } | { kind: 'openSheet'; sheetId: Id };
  state: 'pending' | 'accepted' | 'rejected';
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  references?: Reference[];
  proposals?: Proposal[];
  claims?: Claim[];
  /** Short log of what the model looked at (tool calls), for the "look before asking" trust. */
  toolLog?: { name: string; summary: string }[];
  error?: AppError;
  /** ISO date. */
  at: string;
}

/** The document and the UI state the model may see. Built by the renderer for every request. */
export interface AssistantContext {
  doc: Document;
  selection: Id[];
  activePart: Id | null;
  activeSheet: Id | null;
  /** The last build of the active part, without the mesh. */
  build: Omit<BuildResult, 'mesh'> | null;
  /** The sketch solver's last word, when there is one. */
  sketch: { status: string; dof: number; message: string } | null;
  lang: Lang;
}

export interface AssistantRequest {
  /** The conversation so far, the new user turn last. Accepted / rejected states are visible. */
  turns: ChatTurn[];
  context: AssistantContext;
}

export interface AssistantReply {
  text: string;
  proposals: Proposal[];
  claims: Claim[];
  toolLog: { name: string; summary: string }[];
  /** Provider and model that answered, for the chat header. */
  model: { provider: AiProviderId; model: string };
}

/** Progress while a request runs: streamed text and tool activity. */
export type AssistantProgress = { kind: 'text'; text: string } | { kind: 'tool'; name: string; summary: string } | { kind: 'done' };
