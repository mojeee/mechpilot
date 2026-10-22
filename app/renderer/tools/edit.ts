// Edit tools: move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array.
// Each one gathers its inputs step by step and ends in one command (one undo step).

import type { Command } from '@shared/commands';
import type { Entity, Id, LineEntity } from '@shared/doc/types';
import { angleOf, dist, sub, type Vec2 } from '@shared/geometry/vec2';
import { mirror as mirrorMatrix, rotation, scaling, transformEntity, translation, type Matrix } from '@shared/geometry/transform';
import { arrayPolar, arrayRectangular, chamfer, extend, fillet, offsetEntity, offsetIsApproximate, trim } from '@shared/geometry/ops';
import { parseLength } from '@shared/units';
import type { Tool, ToolCtx } from './types';

/* ---------- selection-first tools ---------- */

interface SelState {
  selecting: boolean;
  ids: Id[];
  points: Vec2[];
  /** Typed values gathered after the points (factor, angle, counts). */
  values: number[];
}

function initSel(ctx: ToolCtx): SelState {
  const ids = ctx.selection.filter((id) => ctx.doc.entities[id]);
  return { selecting: ids.length === 0, ids, points: [], values: [] };
}

const selectPrompt = (s: SelState, ctx: ToolCtx) => (s.ids.length ? ctx.t('Select entities: {n} selected, Enter to continue', { n: s.ids.length }) : ctx.t('Select entities (click or drag a window), then Enter'));

function selectEntity(s: SelState, id: Id, _p: Vec2, ctx: ToolCtx): SelState {
  const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
  ctx.select(ids);
  return { ...s, ids };
}

function selectEnter(s: SelState, ctx: ToolCtx): SelState | null {
  if (!s.selecting) return s;
  // The store may have changed the selection with a window; take it.
  const ids = (ctx.selection.length ? ctx.selection : s.ids).filter((id) => ctx.doc.entities[id]);
  if (ids.length === 0) {
    ctx.say({ kind: 'info', text: ctx.t('Nothing selected.') });
    return s;
  }
  return { ...s, selecting: false, ids };
}

function transformed(ctx: ToolCtx, ids: Id[], m: Matrix): Entity[] {
  return ids.map((id) => transformEntity(ctx.doc.entities[id], m));
}

function previewOf(ctx: ToolCtx, ids: Id[], m: Matrix): Entity[] {
  if (ids.length > 2000) return [];
  return transformed(ctx, ids, m).map((e) => ({ ...e, id: `_p${e.id}` }));
}

export const moveTool: Tool<SelState> = {
  id: 'move',
  init: initSel,
  wantsEntity: (s) => s.selecting,
  entity: selectEntity,
  enter: selectEnter,
  prompt: (s, ctx) => (s.selecting ? selectPrompt(s, ctx) : s.points.length === 0 ? ctx.t('Move: base point') : ctx.t('Move: destination point (or @dx,dy)')),
  point(s, p, ctx) {
    if (s.selecting) return s;
    if (s.points.length === 0) return { ...s, points: [p] };
    const m = translation(p.x - s.points[0].x, p.y - s.points[0].y);
    ctx.run({ kind: 'batch', label: ctx.t('Move {n} entities', { n: s.ids.length }), commands: [{ kind: 'updateEntities', entities: transformed(ctx, s.ids, m) }] });
    return null;
  },
  preview: (s, cursor, ctx) => (cursor && s.points.length === 1 ? previewOf(ctx, s.ids, translation(cursor.x - s.points[0].x, cursor.y - s.points[0].y)) : []),
  reference: (s) => s.points[0] ?? null,
  exclude: (s) => (s.points.length === 1 ? s.ids : []),
};

export const copyTool: Tool<SelState> = {
  id: 'copy',
  init: initSel,
  wantsEntity: (s) => s.selecting,
  entity: selectEntity,
  enter: (s, ctx) => (s.selecting ? selectEnter(s, ctx) : null),
  prompt: (s, ctx) => (s.selecting ? selectPrompt(s, ctx) : s.points.length === 0 ? ctx.t('Copy: base point') : ctx.t('Copy: destination point (repeat for more copies, Enter to finish)')),
  point(s, p, ctx) {
    if (s.selecting) return s;
    if (s.points.length === 0) return { ...s, points: [p] };
    const m = translation(p.x - s.points[0].x, p.y - s.points[0].y);
    const copies = transformed(ctx, s.ids, m).map((e) => ({ ...e, id: ctx.ids() }));
    ctx.run({ kind: 'addEntities', entities: copies });
    return s;
  },
  preview: (s, cursor, ctx) => (cursor && s.points.length === 1 ? previewOf(ctx, s.ids, translation(cursor.x - s.points[0].x, cursor.y - s.points[0].y)) : []),
  reference: (s) => s.points[0] ?? null,
};

const degrees = (text: string): number | null => {
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(°|deg)?$/i.exec(text.trim());
  return m ? (Number(m[1].replace(',', '.')) * Math.PI) / 180 : null;
};

export const rotateTool: Tool<SelState> = {
  id: 'rotate',
  init: initSel,
  wantsEntity: (s) => s.selecting,
  entity: selectEntity,
  enter: selectEnter,
  prompt: (s, ctx) => (s.selecting ? selectPrompt(s, ctx) : s.points.length === 0 ? ctx.t('Rotate: base point') : ctx.t('Rotate: angle in degrees (counter-clockwise), or a point that gives the direction')),
  point(s, p, ctx) {
    if (s.selecting) return s;
    if (s.points.length === 0) return { ...s, points: [p] };
    return applyRotate(s, angleOf(sub(p, s.points[0])), ctx);
  },
  text(s, text, ctx) {
    if (s.selecting || s.points.length === 0) return s;
    const a = degrees(text);
    if (a === null) {
      ctx.say({ kind: 'warn', text: ctx.t('Type an angle in degrees, for example 90 or -45.') });
      return s;
    }
    return applyRotate(s, a, ctx);
  },
  preview: (s, cursor, ctx) => (cursor && s.points.length === 1 && dist(cursor, s.points[0]) > 0 ? previewOf(ctx, s.ids, rotation(angleOf(sub(cursor, s.points[0])), s.points[0])) : []),
  reference: (s) => s.points[0] ?? null,
  exclude: (s) => (s.points.length === 1 ? s.ids : []),
};

function applyRotate(s: SelState, angle: number, ctx: ToolCtx): null {
  ctx.run({ kind: 'batch', label: ctx.t('Rotate {n} entities', { n: s.ids.length }), commands: [{ kind: 'updateEntities', entities: transformed(ctx, s.ids, rotation(angle, s.points[0])) }] });
  return null;
}

export const scaleTool: Tool<SelState> = {
  id: 'scale',
  init: initSel,
  wantsEntity: (s) => s.selecting,
  entity: selectEntity,
  enter: selectEnter,
  prompt: (s, ctx) => (s.selecting ? selectPrompt(s, ctx) : s.points.length === 0 ? ctx.t('Scale: base point') : s.points.length === 1 ? ctx.t('Scale: factor (for example 2 or 0.5), or a reference point') : ctx.t('Scale: new point for the reference length')),
  point(s, p, ctx) {
    if (s.selecting) return s;
    if (s.points.length < 2) return { ...s, points: [...s.points, p] };
    const ref = dist(s.points[0], s.points[1]);
    const k = dist(s.points[0], p) / ref;
    return applyScale(s, k, ctx);
  },
  text(s, text, ctx) {
    if (s.selecting || s.points.length !== 1) return s;
    const k = Number(text.trim().replace(',', '.'));
    if (!(k > 0)) {
      ctx.say({ kind: 'warn', text: ctx.t('Type a scale factor greater than zero, for example 2 or 0.5.') });
      return s;
    }
    return applyScale(s, k, ctx);
  },
  preview(s, cursor, ctx) {
    if (!cursor || s.points.length !== 2) return [];
    const ref = dist(s.points[0], s.points[1]);
    const k = dist(s.points[0], cursor) / ref;
    return k > 0 ? previewOf(ctx, s.ids, scaling(k, s.points[0])) : [];
  },
  reference: (s) => s.points[0] ?? null,
};

function applyScale(s: SelState, k: number, ctx: ToolCtx): null {
  if (!(k > 0) || !Number.isFinite(k)) {
    ctx.say({ kind: 'warn', text: ctx.t('Type a scale factor greater than zero, for example 2 or 0.5.') });
    return null;
  }
  ctx.run({ kind: 'batch', label: ctx.t('Scale {n} entities', { n: s.ids.length }), commands: [{ kind: 'updateEntities', entities: transformed(ctx, s.ids, scaling(k, s.points[0])) }] });
  return null;
}

export const mirrorTool: Tool<SelState> = {
  id: 'mirror',
  init: initSel,
  wantsEntity: (s) => s.selecting,
  entity: selectEntity,
  enter(s, ctx) {
    if (s.selecting) return selectEnter(s, ctx);
    if (s.points.length === 2) return applyMirror(s, false, ctx);
    return s;
  },
  prompt: (s, ctx) => (s.selecting ? selectPrompt(s, ctx) : s.points.length === 0 ? ctx.t('Mirror: first point of the mirror line') : s.points.length === 1 ? ctx.t('Mirror: second point of the mirror line') : ctx.t('Mirror: keep the originals? Enter = yes, N = delete them')),
  point(s, p, ctx) {
    if (s.selecting || s.points.length >= 2) return s;
    if (s.points.length === 1 && dist(s.points[0], p) === 0) {
      ctx.say({ kind: 'warn', text: ctx.t('The two points are the same; pick another point.') });
      return s;
    }
    return { ...s, points: [...s.points, p] };
  },
  text(s, text, ctx) {
    if (s.points.length !== 2) return s;
    const u = text.trim().toUpperCase();
    if (u === 'N' || u === 'NO') return applyMirror(s, true, ctx);
    if (u === 'Y' || u === 'YES') return applyMirror(s, false, ctx);
    ctx.say({ kind: 'warn', text: ctx.t('Answer Y to keep the originals or N to delete them.') });
    return s;
  },
  preview: (s, cursor, ctx) => (s.points.length === 1 && cursor && dist(cursor, s.points[0]) > 0 ? previewOf(ctx, s.ids, mirrorMatrix(s.points[0], cursor)) : s.points.length === 2 ? previewOf(ctx, s.ids, mirrorMatrix(s.points[0], s.points[1])) : []),
  reference: (s) => s.points[0] ?? null,
};

function applyMirror(s: SelState, deleteOriginals: boolean, ctx: ToolCtx): null {
  const copies = transformed(ctx, s.ids, mirrorMatrix(s.points[0], s.points[1])).map((e) => ({ ...e, id: ctx.ids() }));
  const commands: Command[] = [{ kind: 'addEntities', entities: copies }];
  if (deleteOriginals) commands.push({ kind: 'deleteEntities', ids: s.ids });
  ctx.run({ kind: 'batch', label: ctx.t('Mirror {n} entities', { n: s.ids.length }), commands });
  return null;
}

interface ArrayState extends SelState {
  mode: 'ask' | 'rect' | 'polar';
}
export const arrayTool: Tool<ArrayState> = {
  id: 'array',
  init: (ctx) => ({ ...initSel(ctx), mode: 'ask' }),
  wantsEntity: (s) => s.selecting,
  entity: (s, id, p, ctx) => ({ ...s, ...selectEntity(s, id, p, ctx) }),
  enter(s, ctx) {
    if (s.selecting) {
      const r = selectEnter(s, ctx);
      return r ? { ...s, ...r } : null;
    }
    return s;
  },
  prompt(s, ctx) {
    if (s.selecting) return selectPrompt(s, ctx);
    if (s.mode === 'ask') return ctx.t('Array: R for rectangular, P for polar');
    if (s.mode === 'rect') return [ctx.t('Array: number of rows'), ctx.t('Array: number of columns'), ctx.t('Array: distance between rows (mm)'), ctx.t('Array: distance between columns (mm)')][s.values.length];
    return s.points.length === 0 ? ctx.t('Array: centre point') : [ctx.t('Array: total number of items'), ctx.t('Array: angle to fill in degrees (360 = full circle)')][s.values.length];
  },
  point(s, p) {
    if (s.mode === 'polar' && s.points.length === 0) return { ...s, points: [p] };
    return s;
  },
  text(s, text, ctx) {
    if (s.selecting) return s;
    const u = text.trim().toUpperCase();
    if (s.mode === 'ask') {
      if (u === 'R') return { ...s, mode: 'rect' };
      if (u === 'P') return { ...s, mode: 'polar' };
      ctx.say({ kind: 'warn', text: ctx.t('Type R for a rectangular array or P for a polar one.') });
      return s;
    }
    if (s.mode === 'rect') {
      const v = s.values.length < 2 ? Number(u) : parseLength(text);
      if (v === null || !Number.isFinite(v) || (s.values.length < 2 && (!Number.isInteger(v) || v < 1))) {
        ctx.say({ kind: 'warn', text: ctx.t('Type a number.') });
        return s;
      }
      const values = [...s.values, v];
      if (values.length < 4) return { ...s, values };
      const [rows, cols, dy, dx] = values;
      const copies = arrayRectangular(s.ids.map((id) => ctx.doc.entities[id]), rows, cols, dy, dx, ctx.ids);
      if (copies.length === 0) {
        ctx.say({ kind: 'info', text: ctx.t('A 1 × 1 array makes no copies.') });
        return null;
      }
      ctx.run({ kind: 'batch', label: ctx.t('Array ({n} copies)', { n: copies.length }), commands: [{ kind: 'addEntities', entities: copies }] });
      return null;
    }
    if (s.points.length === 0) {
      ctx.say({ kind: 'warn', text: ctx.t('Pick the centre point first.') });
      return s;
    }
    const v = Number(u.replace('°', ''));
    if (!Number.isFinite(v) || (s.values.length === 0 && (!Number.isInteger(v) || v < 2))) {
      ctx.say({ kind: 'warn', text: ctx.t('Type a number.') });
      return s;
    }
    const values = [...s.values, v];
    if (values.length < 2) return { ...s, values };
    const copies = arrayPolar(s.ids.map((id) => ctx.doc.entities[id]), s.points[0], values[0], (values[1] * Math.PI) / 180, true, ctx.ids);
    ctx.run({ kind: 'batch', label: ctx.t('Array ({n} copies)', { n: copies.length }), commands: [{ kind: 'addEntities', entities: copies }] });
    return null;
  },
};

/* ---------- entity-pick tools ---------- */

interface OffsetState {
  distance: number | null;
  entity: Id | null;
}
let lastOffset = 5;
export const offsetTool: Tool<OffsetState> = {
  id: 'offset',
  init: () => ({ distance: null, entity: null }),
  wantsEntity: (s) => s.distance !== null && s.entity === null,
  prompt: (s, ctx) => (s.distance === null ? ctx.t('Offset: distance in mm (Enter = {d})', { d: lastOffset }) : s.entity === null ? ctx.t('Offset: click the entity to offset (Enter to finish)') : ctx.t('Offset: click the side to offset to')),
  text(s, text, ctx) {
    if (s.distance !== null) return s;
    const v = parseLength(text);
    if (v === null || v <= 0) {
      ctx.say({ kind: 'warn', text: ctx.t('Type a distance greater than zero in mm.') });
      return s;
    }
    lastOffset = v;
    return { ...s, distance: v };
  },
  enter: (s) => (s.distance === null ? { ...s, distance: lastOffset } : null),
  entity: (s, id) => ({ ...s, entity: id }),
  point(s, p, ctx) {
    if (s.distance === null || s.entity === null) return s;
    const e = ctx.doc.entities[s.entity];
    const out = offsetEntity(e, s.distance, p, ctx.ids);
    if (!out) {
      ctx.say({ kind: 'warn', text: ctx.t('This entity cannot be offset by {d} mm on that side (the result would vanish).', { d: s.distance }) });
      return { ...s, entity: null };
    }
    if (offsetIsApproximate(e)) ctx.say({ kind: 'info', text: ctx.t('Ellipses and splines are offset as polylines (0.01 mm).') });
    ctx.run({ kind: 'addEntities', entities: [out] });
    return { ...s, entity: null };
  },
  preview(s, cursor, ctx) {
    if (s.distance === null || s.entity === null || !cursor) return [];
    const e = ctx.doc.entities[s.entity];
    const out = offsetEntity(e, s.distance, cursor, () => '_p');
    return out ? [out] : [];
  },
};

interface CutState {
  /** Cutting edges (trim) or boundaries (extend); empty = every entity. */
  edges: Id[];
  chosen: boolean;
}
const cutInit = (ctx: ToolCtx): CutState => ({ edges: ctx.selection.filter((id) => ctx.doc.entities[id]), chosen: false });

export const trimTool: Tool<CutState> = {
  id: 'trim',
  init: cutInit,
  wantsEntity: () => true,
  prompt: (s, ctx) => (s.chosen ? ctx.t('Trim: click the part to remove (Enter to finish)') : s.edges.length ? ctx.t('Trim: cutting edges: {n} selected, Enter to continue', { n: s.edges.length }) : ctx.t('Trim: select the cutting edges, then Enter (Enter alone = every entity)')),
  entity(s, id, p, ctx) {
    if (!s.chosen) {
      const edges = s.edges.includes(id) ? s.edges.filter((x) => x !== id) : [...s.edges, id];
      ctx.select(edges);
      return { ...s, edges };
    }
    const cutters = (s.edges.length ? s.edges : ctx.doc.entityOrder).filter((x) => x !== id).map((x) => ctx.doc.entities[x]);
    const pieces = trim(ctx.doc.entities[id], cutters, p, ctx.ids);
    if (!pieces) {
      ctx.say({ kind: 'warn', text: ctx.t('Nothing to trim here: no cutting edge crosses this entity at that point.') });
      return s;
    }
    const commands: Command[] = [{ kind: 'deleteEntities', ids: [id] }];
    if (pieces.length) commands.push({ kind: 'addEntities', entities: pieces });
    ctx.run({ kind: 'batch', label: ctx.t('Trim'), commands });
    return s;
  },
  enter(s, ctx) {
    if (s.chosen) return null;
    ctx.select([]);
    return { ...s, chosen: true };
  },
};

export const extendTool: Tool<CutState> = {
  id: 'extend',
  init: cutInit,
  wantsEntity: () => true,
  prompt: (s, ctx) => (s.chosen ? ctx.t('Extend: click the entity near the end to extend (Enter to finish)') : s.edges.length ? ctx.t('Extend: boundaries: {n} selected, Enter to continue', { n: s.edges.length }) : ctx.t('Extend: select the boundary edges, then Enter (Enter alone = every entity)')),
  entity(s, id, p, ctx) {
    if (!s.chosen) {
      const edges = s.edges.includes(id) ? s.edges.filter((x) => x !== id) : [...s.edges, id];
      ctx.select(edges);
      return { ...s, edges };
    }
    const bounds = (s.edges.length ? s.edges : ctx.doc.entityOrder).filter((x) => x !== id).map((x) => ctx.doc.entities[x]);
    const out = extend(ctx.doc.entities[id], bounds, p);
    if (!out) {
      ctx.say({ kind: 'warn', text: ctx.t('Nothing to extend to: no boundary lies beyond that end.') });
      return s;
    }
    ctx.run({ kind: 'batch', label: ctx.t('Extend'), commands: [{ kind: 'updateEntities', entities: [out] }] });
    return s;
  },
  enter(s, ctx) {
    if (s.chosen) return null;
    ctx.select([]);
    return { ...s, chosen: true };
  },
};

interface FilletState {
  radius: number;
  first: { id: Id; p: Vec2 } | null;
}
let lastRadius = 5;
export const filletTool: Tool<FilletState> = {
  id: 'fillet',
  init: () => ({ radius: lastRadius, first: null }),
  wantsEntity: () => true,
  prompt: (s, ctx) => (s.first ? ctx.t('Fillet: second entity (radius {r} mm)', { r: s.radius }) : ctx.t('Fillet: first entity, or type a radius (R=) — radius {r} mm', { r: s.radius })),
  text(s, text, ctx) {
    const m = /^(?:r\s*=?\s*)?(.+)$/i.exec(text.trim());
    const v = m ? parseLength(m[1]) : null;
    if (v === null || v < 0) {
      ctx.say({ kind: 'warn', text: ctx.t('Type the radius in mm, for example R=3 (0 makes a sharp corner).') });
      return s;
    }
    lastRadius = v;
    return { ...s, radius: v };
  },
  entity(s, id, p, ctx) {
    if (!s.first) return { ...s, first: { id, p } };
    if (s.first.id === id) {
      ctx.say({ kind: 'warn', text: ctx.t('Pick a different second entity.') });
      return s;
    }
    const a = ctx.doc.entities[s.first.id];
    const b = ctx.doc.entities[id];
    const r = fillet(a, b, s.radius, s.first.p, p, ctx.ids);
    if (!r.ok) {
      const why = { 'no-solution': ctx.t('no arc of that radius touches both'), unsupported: ctx.t('only lines, arcs and circles can be filleted'), 'radius-too-large': ctx.t('the radius is too large for these entities'), parallel: ctx.t('the lines are parallel') }[r.reason];
      ctx.say({ kind: 'warn', text: ctx.t('Cannot fillet: {why}.', { why }) });
      return { ...s, first: null };
    }
    const commands: Command[] = [];
    const updates: Entity[] = [];
    const deletes: Id[] = [];
    if (r.a) updates.push(r.a);
    else deletes.push(a.id);
    if (r.b) updates.push(r.b);
    else deletes.push(b.id);
    if (updates.length) commands.push({ kind: 'updateEntities', entities: updates });
    if (deletes.length) commands.push({ kind: 'deleteEntities', ids: deletes });
    if (r.arc) commands.push({ kind: 'addEntities', entities: [r.arc] });
    ctx.run({ kind: 'batch', label: ctx.t('Fillet R{r}', { r: s.radius }), commands });
    return { ...s, first: null };
  },
  enter: () => null,
};

interface ChamferState {
  d1: number;
  d2: number;
  first: { id: Id; p: Vec2 } | null;
}
let lastChamfer = { d1: 2, d2: 2 };
export const chamferTool: Tool<ChamferState> = {
  id: 'chamfer',
  init: () => ({ ...lastChamfer, first: null }),
  wantsEntity: () => true,
  prompt: (s, ctx) => (s.first ? ctx.t('Chamfer: second line (distances {d1} × {d2} mm)', { d1: s.d1, d2: s.d2 }) : ctx.t('Chamfer: first line, or type the distances (D=2 or D=2,3) — {d1} × {d2} mm', { d1: s.d1, d2: s.d2 })),
  text(s, text, ctx) {
    const m = /^(?:d\s*=?\s*)?([^,;x×]+)(?:[,;x×]\s*(.+))?$/i.exec(text.trim());
    const d1 = m ? parseLength(m[1]) : null;
    const d2 = m?.[2] ? parseLength(m[2]) : d1;
    if (d1 === null || d2 === null || d1 <= 0 || d2 <= 0) {
      ctx.say({ kind: 'warn', text: ctx.t('Type the chamfer distances in mm, for example D=2 or D=2,3.') });
      return s;
    }
    lastChamfer = { d1, d2 };
    return { ...s, d1, d2 };
  },
  entity(s, id, p, ctx) {
    const e = ctx.doc.entities[id];
    if (e.type !== 'line') {
      ctx.say({ kind: 'warn', text: ctx.t('Chamfer works between two lines.') });
      return s;
    }
    if (!s.first) return { ...s, first: { id, p } };
    if (s.first.id === id) return s;
    const a = ctx.doc.entities[s.first.id] as LineEntity;
    const r = chamfer(a, e, s.d1, s.d2, s.first.p, p, ctx.ids);
    if (!r.ok) {
      ctx.say({ kind: 'warn', text: r.reason === 'parallel' ? ctx.t('Cannot chamfer: the lines are parallel.') : ctx.t('Cannot chamfer: the distances are larger than the lines.') });
      return { ...s, first: null };
    }
    ctx.run({ kind: 'batch', label: ctx.t('Chamfer'), commands: [{ kind: 'updateEntities', entities: [r.a, r.b] }, { kind: 'addEntities', entities: [r.line] }] });
    return { ...s, first: null };
  },
  enter: () => null,
};

export const EDIT_TOOLS = [moveTool, copyTool, rotateTool, scaleTool, mirrorTool, arrayTool, offsetTool, trimTool, extendTool, filletTool, chamferTool] as Tool<unknown>[];
