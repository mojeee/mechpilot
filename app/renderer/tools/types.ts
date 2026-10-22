// The tool framework. A tool is a small state machine driven by the canvas and the command line:
// points (clicked or typed), typed text (numbers, options), entity picks and Enter. Tools never
// touch the document: they build commands and run them through the store (CLAUDE.md, Architecture).

import type { Command } from '@shared/commands';
import type { Document, Entity, Id } from '@shared/doc/types';
import type { Vec2 } from '@shared/geometry/vec2';
import type { IdGen } from '@shared/ids';
import type { Message } from '../state/store';

export type ToolId =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'ellipse'
  | 'spline'
  | 'text'
  | 'move'
  | 'copy'
  | 'rotate'
  | 'scale'
  | 'mirror'
  | 'offset'
  | 'trim'
  | 'extend'
  | 'fillet'
  | 'chamfer'
  | 'array';

export interface ToolCtx {
  doc: Document;
  selection: Id[];
  /** The active layer for new entities. */
  layer: Id;
  ids: IdGen;
  run(cmd: Command): boolean;
  say(message: Message | null): void;
  select(ids: Id[], mode?: 'set' | 'toggle' | 'add'): void;
  /** Entity under a point, if any (visible, unlocked). */
  pick(p: Vec2): Id | null;
  /** Switch back to the select tool. */
  finish(): void;
  /** Ask for text to be typed: the command line shows it as the prompt's input (e.g. the text tool). */
  t(text: string, vars?: Record<string, string | number>): string;
}

/**
 * A tool with its own state S. Every handler returns the next state, or null to finish the tool.
 * A tool that wants to keep going after an action returns a fresh state from init().
 */
export interface Tool<S = unknown> {
  id: ToolId;
  init(ctx: ToolCtx): S;
  prompt(s: S, ctx: ToolCtx): string;
  /** A point from the canvas or the command line (already snapped). */
  point?(s: S, p: Vec2, ctx: ToolCtx): S | null;
  /** Typed text that is not a point: a number, an option letter, a string. */
  text?(s: S, text: string, ctx: ToolCtx): S | null;
  /** A click on an entity when the step wants entities (see wantsEntity). */
  entity?(s: S, id: Id, p: Vec2, ctx: ToolCtx): S | null;
  /** Enter on an empty command line. */
  enter?(s: S, ctx: ToolCtx): S | null;
  /** Entities to draw as a rubber band for the cursor position. */
  preview?(s: S, cursor: Vec2 | null, ctx: ToolCtx): Entity[];
  /** The point perpendicular/tangent snaps and polar tracking refer to. */
  reference?(s: S, ctx: ToolCtx): Vec2 | null;
  /** True when a click should pick an entity instead of giving a point. */
  wantsEntity?(s: S, ctx: ToolCtx): boolean;
  /** Entity ids the snap engine should ignore (e.g. the ones being moved). */
  exclude?(s: S, ctx: ToolCtx): Id[];
}

/** Helper for tools that take a selection first: use the current one or collect clicks. */
export interface SelectStep {
  /** True until the user confirmed the selection with Enter. */
  selecting: boolean;
}
