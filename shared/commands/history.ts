// Undo/redo over the command layer. Pure: every function returns a new editor state.

import type { Document } from '../doc/types';
import { apply, labelOf, type Command, type CommandError } from './index';

export interface HistoryEntry {
  label: string;
  command: Command;
  inverse: Command;
}
export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}
export interface EditorState {
  doc: Document;
  history: History;
  /** True when the document differs from the last saved/opened state. */
  dirty: boolean;
}

export const DEFAULT_HISTORY_LIMIT = 500;

export const emptyHistory = (): History => ({ undo: [], redo: [] });
export const editorState = (doc: Document): EditorState => ({ doc, history: emptyHistory(), dirty: false });

export type ExecuteResult = { ok: true; state: EditorState } | { ok: false; error: CommandError };

/** Apply a command and record it. A new command clears the redo stack. */
export function execute(state: EditorState, cmd: Command, limit = DEFAULT_HISTORY_LIMIT): ExecuteResult {
  const r = apply(state.doc, cmd);
  if (!r.ok) return r;
  const entry: HistoryEntry = { label: labelOf(cmd), command: cmd, inverse: r.inverse };
  const undo = [...state.history.undo, entry];
  if (undo.length > limit) undo.splice(0, undo.length - limit);
  return { ok: true, state: { doc: r.doc, history: { undo, redo: [] }, dirty: true } };
}

export function undo(state: EditorState): EditorState | null {
  const entry = state.history.undo[state.history.undo.length - 1];
  if (!entry) return null;
  const r = apply(state.doc, entry.inverse);
  if (!r.ok) return null;
  return { doc: r.doc, history: { undo: state.history.undo.slice(0, -1), redo: [...state.history.redo, entry] }, dirty: true };
}

export function redo(state: EditorState): EditorState | null {
  const entry = state.history.redo[state.history.redo.length - 1];
  if (!entry) return null;
  const r = apply(state.doc, entry.command);
  if (!r.ok) return null;
  const replay: HistoryEntry = { ...entry, inverse: r.inverse };
  return { doc: r.doc, history: { undo: [...state.history.undo, replay], redo: state.history.redo.slice(0, -1) }, dirty: true };
}

export const canUndo = (state: EditorState): boolean => state.history.undo.length > 0;
export const canRedo = (state: EditorState): boolean => state.history.redo.length > 0;
export const undoLabel = (state: EditorState): string | null => state.history.undo[state.history.undo.length - 1]?.label ?? null;
export const redoLabel = (state: EditorState): string | null => state.history.redo[state.history.redo.length - 1]?.label ?? null;

/** After a save: same document and history, not dirty. */
export const markSaved = (state: EditorState): EditorState => ({ ...state, dirty: false });
