// Registry of tools and their command-line names.

import { DRAW_TOOLS } from './draw';
import { EDIT_TOOLS } from './edit';
import type { Tool, ToolId } from './types';

export const TOOLS: Record<ToolId, Tool<unknown> | null> = {
  select: null,
  line: null,
  polyline: null,
  rect: null,
  circle: null,
  arc: null,
  ellipse: null,
  spline: null,
  text: null,
  move: null,
  copy: null,
  rotate: null,
  scale: null,
  mirror: null,
  offset: null,
  trim: null,
  extend: null,
  fillet: null,
  chamfer: null,
  array: null,
};
for (const t of [...DRAW_TOOLS, ...EDIT_TOOLS]) TOOLS[t.id] = t;

/** Command-line aliases (AutoCAD habits): L, PL, REC, C, A, EL, SPL, T, M, CO, RO, SC, MI, O, TR, EX, F, CHA, AR. */
export const ALIASES: Record<string, ToolId> = {
  L: 'line',
  LINE: 'line',
  PL: 'polyline',
  POLYLINE: 'polyline',
  REC: 'rect',
  RECT: 'rect',
  RECTANGLE: 'rect',
  C: 'circle',
  CIRCLE: 'circle',
  A: 'arc',
  ARC: 'arc',
  EL: 'ellipse',
  ELLIPSE: 'ellipse',
  SPL: 'spline',
  SPLINE: 'spline',
  T: 'text',
  TEXT: 'text',
  M: 'move',
  MOVE: 'move',
  CO: 'copy',
  CP: 'copy',
  COPY: 'copy',
  RO: 'rotate',
  ROTATE: 'rotate',
  SC: 'scale',
  SCALE: 'scale',
  MI: 'mirror',
  MIRROR: 'mirror',
  O: 'offset',
  OFFSET: 'offset',
  TR: 'trim',
  TRIM: 'trim',
  EX: 'extend',
  EXTEND: 'extend',
  F: 'fillet',
  FILLET: 'fillet',
  CHA: 'chamfer',
  CHAMFER: 'chamfer',
  AR: 'array',
  ARRAY: 'array',
};

export type { Tool, ToolId, ToolCtx } from './types';
