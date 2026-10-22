// Dimension and annotation tools (ISO 129-1, ISO 1101, ISO 21920-1): linear, aligned, angular,
// radius, diameter and ordinate dimensions; notes with leaders, balloons, surface texture symbols,
// geometrical tolerance frames and datums. Every tool ends in one addEntities command.

import type { Entity, Id } from '@shared/doc/types';
import { add, angleOf, dist, normalize, scale, sub, type Vec2 } from '@shared/geometry/vec2';
import { closestPointOnEntity, lineLineInfinite } from '@shared/geometry/intersect';
import { GDT_SYMBOLS } from '@shared/draw/annotations';
import type { Tool, ToolCtx } from './types';

interface Pts {
  points: Vec2[];
}
const dimLayer = (ctx: ToolCtx): Id => (ctx.doc.layers.dimensions ? 'dimensions' : ctx.layer);

/** Horizontal or vertical from where the dimension line was dragged to. */
function linearRotation(a: Vec2, b: Vec2, position: Vec2): number {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const off = sub(position, m);
  // Dragged mostly up/down → the dimension line is horizontal and measures x (rotation 0).
  if (Math.abs(a.x - b.x) < 1e-12) return Math.PI / 2;
  if (Math.abs(a.y - b.y) < 1e-12) return 0;
  return Math.abs(off.y) >= Math.abs(off.x) ? 0 : Math.PI / 2;
}

interface LinState extends Pts {
  force: 'h' | 'v' | null;
}
export const dimLinearTool: Tool<LinState> = {
  id: 'dim-linear',
  init: () => ({ points: [], force: null }),
  prompt: (s, ctx) => [ctx.t('Linear dimension: first point'), ctx.t('Linear dimension: second point'), ctx.t('Linear dimension: dimension line position (H or V forces the direction)')][s.points.length],
  point(s, p, ctx) {
    if (s.points.length < 2) return { ...s, points: [...s.points, p] };
    const [a, b] = s.points;
    const rotation = s.force === 'h' ? 0 : s.force === 'v' ? Math.PI / 2 : linearRotation(a, b, p);
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'dimension', layer: dimLayer(ctx), kind: 'linear', a, b, position: p, rotation }] });
    return null;
  },
  text(s, text, ctx) {
    const u = text.trim().toUpperCase();
    if (u === 'H') return { ...s, force: 'h' };
    if (u === 'V') return { ...s, force: 'v' };
    ctx.say({ kind: 'warn', text: ctx.t('Type a point as x,y, or H / V to force a horizontal or vertical dimension.') });
    return s;
  },
  preview(s, cursor, ctx) {
    if (!cursor || s.points.length !== 2) return [];
    const [a, b] = s.points;
    const rotation = s.force === 'h' ? 0 : s.force === 'v' ? Math.PI / 2 : linearRotation(a, b, cursor);
    return [{ id: '_p', type: 'dimension', layer: dimLayer(ctx), kind: 'linear', a, b, position: cursor, rotation }];
  },
  reference: (s) => s.points[s.points.length - 1] ?? null,
};

export const dimAlignedTool: Tool<Pts> = {
  id: 'dim-aligned',
  init: () => ({ points: [] }),
  prompt: (s, ctx) => [ctx.t('Aligned dimension: first point'), ctx.t('Aligned dimension: second point'), ctx.t('Aligned dimension: dimension line position')][s.points.length],
  point(s, p, ctx) {
    if (s.points.length < 2) {
      if (s.points.length === 1 && dist(s.points[0], p) === 0) return s;
      return { points: [...s.points, p] };
    }
    const [a, b] = s.points;
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'dimension', layer: dimLayer(ctx), kind: 'aligned', a, b, position: p, rotation: 0 }] });
    return null;
  },
  preview: (s, cursor, ctx) => (cursor && s.points.length === 2 ? [{ id: '_p', type: 'dimension', layer: dimLayer(ctx), kind: 'aligned', a: s.points[0], b: s.points[1], position: cursor, rotation: 0 }] : []),
  reference: (s) => s.points[s.points.length - 1] ?? null,
};

interface AngState {
  lines: { id: Id; p: Vec2 }[];
}
export const dimAngularTool: Tool<AngState> = {
  id: 'dim-angular',
  init: () => ({ lines: [] }),
  wantsEntity: (s) => s.lines.length < 2,
  prompt: (s, ctx) => [ctx.t('Angular dimension: first line'), ctx.t('Angular dimension: second line'), ctx.t('Angular dimension: arc position')][s.lines.length],
  entity(s, id, p, ctx) {
    const e = ctx.doc.entities[id];
    if (e.type !== 'line') {
      ctx.say({ kind: 'warn', text: ctx.t('Angular dimensions measure between two lines.') });
      return s;
    }
    if (s.lines[0]?.id === id) return s;
    return { lines: [...s.lines, { id, p }] };
  },
  point(s, p, ctx) {
    if (s.lines.length < 2) return s;
    const e = angularFrom(s, p, ctx);
    if (!e) {
      ctx.say({ kind: 'warn', text: ctx.t('The two lines are parallel; no angle between them.') });
      return null;
    }
    ctx.run({ kind: 'addEntities', entities: [{ ...e, id: ctx.ids() }] });
    return null;
  },
  preview(s, cursor, ctx) {
    if (!cursor || s.lines.length !== 2) return [];
    const e = angularFrom(s, cursor, ctx);
    return e ? [{ ...e, id: '_p' }] : [];
  },
};

function angularFrom(s: AngState, position: Vec2, ctx: ToolCtx): Entity | null {
  const l1 = ctx.doc.entities[s.lines[0].id];
  const l2 = ctx.doc.entities[s.lines[1].id];
  if (l1.type !== 'line' || l2.type !== 'line') return null;
  const c = lineLineInfinite(l1.a, l1.b, l2.a, l2.b);
  if (!c) return null;
  // The legs point from the vertex towards where each line was picked.
  const legDir = (l: typeof l1, pick: Vec2): Vec2 => {
    const q = closestPointOnEntity(pick, l).point;
    const d = sub(q, c);
    return dist(q, c) < 1e-9 ? normalize(sub(l.b, l.a)) : normalize(d);
  };
  const r = Math.max(dist(position, c), 1e-6);
  let a = add(c, scale(legDir(l1, s.lines[0].p), r));
  let b = add(c, scale(legDir(l2, s.lines[1].p), r));
  // Counter-clockwise from a to b, and the arc should pass where the user points.
  const ang = (p: Vec2) => angleOf(sub(p, c));
  const inArc = (x: number, s0: number, s1: number) => ((x - s0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) <= ((s1 - s0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (!inArc(ang(position), ang(a), ang(b))) [a, b] = [b, a];
  return { id: '', type: 'dimension', layer: dimLayer(ctx), kind: 'angular', a, b, center: c, position, rotation: 0 };
}

interface RadState {
  target: { id: Id; p: Vec2 } | null;
}
function radialTool(kind: 'radius' | 'diameter', id: 'dim-radius' | 'dim-diameter'): Tool<RadState> {
  return {
    id,
    init: () => ({ target: null }),
    wantsEntity: (s) => !s.target,
    prompt: (s, ctx) => (s.target ? (kind === 'radius' ? ctx.t('Radius: text position') : ctx.t('Diameter: text position')) : kind === 'radius' ? ctx.t('Radius: click an arc or circle') : ctx.t('Diameter: click an arc or circle')),
    entity(s, eid, p, ctx) {
      const e = ctx.doc.entities[eid];
      if (e.type !== 'circle' && e.type !== 'arc') {
        ctx.say({ kind: 'warn', text: ctx.t('Radius and diameter dimensions need an arc or a circle.') });
        return s;
      }
      return { target: { id: eid, p } };
    },
    point(s, p, ctx) {
      if (!s.target) return s;
      const e = ctx.doc.entities[s.target.id];
      if (e.type !== 'circle' && e.type !== 'arc') return null;
      const onCurve = add(e.center, scale(normalize(sub(p, e.center)), e.radius));
      ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'dimension', layer: dimLayer(ctx), kind, a: e.center, b: onCurve, position: p, rotation: 0 }] });
      return null;
    },
    preview(s, cursor, ctx) {
      if (!cursor || !s.target) return [];
      const e = ctx.doc.entities[s.target.id];
      if (e.type !== 'circle' && e.type !== 'arc') return [];
      const onCurve = add(e.center, scale(normalize(sub(cursor, e.center)), e.radius));
      return [{ id: '_p', type: 'dimension', layer: dimLayer(ctx), kind, a: e.center, b: onCurve, position: cursor, rotation: 0 }];
    },
  };
}
export const dimRadiusTool = radialTool('radius', 'dim-radius');
export const dimDiameterTool = radialTool('diameter', 'dim-diameter');

let ordinateOrigin: Vec2 = { x: 0, y: 0 };
interface OrdState {
  origin: Vec2 | null;
  feature: Vec2 | null;
}
export const dimOrdinateTool: Tool<OrdState> = {
  id: 'dim-ordinate',
  init: () => ({ origin: null, feature: null }),
  prompt: (s, ctx) => (!s.origin ? ctx.t('Ordinate: origin (Enter = {x},{y})', { x: ordinateOrigin.x, y: ordinateOrigin.y }) : !s.feature ? ctx.t('Ordinate: feature point (Enter to finish)') : ctx.t('Ordinate: leader end (drag up/down for an X ordinate, sideways for Y)')),
  enter: (s) => (!s.origin ? { ...s, origin: ordinateOrigin } : null),
  point(s, p, ctx) {
    if (!s.origin) {
      ordinateOrigin = p;
      return { ...s, origin: p };
    }
    if (!s.feature) return { ...s, feature: p };
    const d = sub(p, s.feature);
    const rotation = Math.abs(d.y) >= Math.abs(d.x) ? 0 : Math.PI / 2;
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'dimension', layer: dimLayer(ctx), kind: 'ordinate', a: s.origin, b: s.feature, position: p, rotation }] });
    return { ...s, feature: null };
  },
  preview(s, cursor, ctx) {
    if (!cursor || !s.origin || !s.feature) return [];
    const d = sub(cursor, s.feature);
    const rotation = Math.abs(d.y) >= Math.abs(d.x) ? 0 : Math.PI / 2;
    return [{ id: '_p', type: 'dimension', layer: dimLayer(ctx), kind: 'ordinate', a: s.origin, b: s.feature, position: cursor, rotation }];
  },
  reference: (s) => s.feature ?? s.origin,
};

interface NoteState {
  leader: Vec2[];
  position: Vec2 | null;
}
export const noteTool: Tool<NoteState> = {
  id: 'note',
  init: () => ({ leader: [], position: null }),
  prompt: (s, ctx) => (s.position ? ctx.t('Note: type the text (a vertical bar | starts a new line) and press Enter') : s.leader.length === 0 ? ctx.t('Note: arrow point (Enter for a note without leader)') : ctx.t('Note: text position')),
  enter: (s) => (s.position ? null : s.leader.length === 0 ? { ...s, leader: [], position: null } : s),
  point(s, p) {
    if (s.position) return s;
    if (s.leader.length === 0 && !s.position) return { ...s, leader: [p] };
    return { ...s, position: p };
  },
  text(s, text, ctx) {
    if (!s.position) {
      // A note without leader: the first typed text asks for a position next.
      ctx.say({ kind: 'info', text: ctx.t('Click where the text goes, then type it.') });
      return s;
    }
    const body = text.replace(/\s*\|\s*/g, '\n');
    if (!body.trim()) return s;
    const h = ctx.doc.dimStyle.textHeight / ctx.doc.dimStyle.annotationScale;
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'note', layer: dimLayer(ctx), position: s.position, text: body, height: h, rotation: 0, ...(s.leader.length ? { leader: s.leader } : {}) }] });
    return null;
  },
  preview(s, cursor, ctx) {
    const pos = s.position ?? cursor;
    if (!pos) return [];
    const h = ctx.doc.dimStyle.textHeight / ctx.doc.dimStyle.annotationScale;
    return [{ id: '_p', type: 'note', layer: dimLayer(ctx), position: pos, text: 'Abc', height: h, rotation: 0, ...(s.leader.length ? { leader: s.leader } : {}) }];
  },
  reference: (s) => s.leader[0] ?? null,
};

interface BalloonState {
  tip: Vec2 | null;
  position: Vec2 | null;
}
let nextBalloon = 1;
export const balloonTool: Tool<BalloonState> = {
  id: 'balloon',
  init: () => ({ tip: null, position: null }),
  prompt: (s, ctx) => (!s.tip ? ctx.t('Balloon: arrow point on the part') : !s.position ? ctx.t('Balloon: circle position') : ctx.t('Balloon: item number (Enter = {n})', { n: nextBalloon })),
  point(s, p) {
    if (!s.tip) return { ...s, tip: p };
    if (!s.position) return { ...s, position: p };
    return s;
  },
  text(s, text, ctx) {
    if (!s.tip || !s.position) return s;
    return finishBalloon(s, text.trim(), ctx);
  },
  enter: (s, ctx) => (s.tip && s.position ? finishBalloon(s, String(nextBalloon), ctx) : null),
  preview: (s, cursor, ctx) => (s.tip && (s.position ?? cursor) ? [{ id: '_p', type: 'balloon', layer: dimLayer(ctx), position: (s.position ?? cursor) as Vec2, text: String(nextBalloon), leader: s.tip }] : []),
  reference: (s) => s.tip,
};
function finishBalloon(s: BalloonState, text: string, ctx: ToolCtx): null {
  ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'balloon', layer: dimLayer(ctx), position: s.position as Vec2, text: text || String(nextBalloon), leader: s.tip as Vec2 }] });
  const n = Number(text);
  nextBalloon = Number.isInteger(n) && n > 0 ? n + 1 : nextBalloon + 1;
  return null;
}

interface SurfState {
  position: Vec2 | null;
  rotation: number | null;
  removal: 'any' | 'required' | 'prohibited';
}
export const surfaceTool: Tool<SurfState> = {
  id: 'surface',
  init: () => ({ position: null, rotation: null, removal: 'any' }),
  prompt: (s, ctx) => (!s.position ? ctx.t('Surface texture: point on the surface (A any process, R removal required, P removal prohibited)') : s.rotation === null ? ctx.t('Surface texture: a second point along the surface (Enter = horizontal)') : ctx.t('Surface texture: Ra in µm (for example 3.2) and optional text, or Enter for none')),
  point(s, p, ctx) {
    if (!s.position) return { ...s, position: p };
    if (s.rotation === null) {
      const d = sub(p, s.position);
      if (Math.hypot(d.x, d.y) === 0) return s;
      return { ...s, rotation: angleOf(d) };
    }
    void ctx;
    return s;
  },
  enter(s, ctx) {
    if (!s.position) return s;
    if (s.rotation === null) return { ...s, rotation: 0 };
    return finishSurface(s, '', ctx);
  },
  text(s, text, ctx) {
    const u = text.trim().toUpperCase();
    if (!s.position || s.rotation === null) {
      if (u === 'A') return { ...s, removal: 'any' };
      if (u === 'R') return { ...s, removal: 'required' };
      if (u === 'P') return { ...s, removal: 'prohibited' };
      ctx.say({ kind: 'warn', text: ctx.t('Type A, R or P, or pick a point.') });
      return s;
    }
    return finishSurface(s, text.trim(), ctx);
  },
  preview: (s, cursor, ctx) => (s.position ? [{ id: '_p', type: 'surface', layer: dimLayer(ctx), position: s.position, rotation: s.rotation ?? (cursor ? angleOf(sub(cursor, s.position)) : 0), removal: s.removal }] : []),
  reference: (s) => s.position,
};
function finishSurface(s: SurfState, text: string, ctx: ToolCtx): null {
  const m = /^(?:ra\s*)?(\d+(?:[.,]\d+)?)\s*(.*)$/i.exec(text);
  const ra = m ? Number(m[1].replace(',', '.')) : undefined;
  const extra = m ? m[2].trim() : text;
  ctx.run({
    kind: 'addEntities',
    entities: [{ id: ctx.ids(), type: 'surface', layer: dimLayer(ctx), position: s.position as Vec2, rotation: s.rotation ?? 0, removal: s.removal, ...(ra && ra > 0 ? { ra } : {}), ...(extra ? { text: extra } : {}) }],
  });
  return null;
}

const GDT_KEYS: Record<string, string> = { STR: 'straightness', FLAT: 'flatness', ROU: 'roundness', CYL: 'cylindricity', LPR: 'line-profile', SPR: 'surface-profile', PAR: 'parallelism', PER: 'perpendicularity', ANG: 'angularity', POS: 'position', CON: 'concentricity', SYM: 'symmetry', CRU: 'circular-runout', TRU: 'total-runout' };
interface GdtState {
  characteristic: string | null;
  tolerance: string | null;
  datums: string[] | null;
  leader: Vec2 | null;
}
export const gdtTool: Tool<GdtState> = {
  id: 'gdt',
  init: () => ({ characteristic: null, tolerance: null, datums: null, leader: null }),
  prompt: (s, ctx) =>
    !s.characteristic
      ? ctx.t('Tolerance frame: characteristic ({keys})', { keys: Object.keys(GDT_KEYS).join(' ') })
      : !s.tolerance
        ? ctx.t('Tolerance frame: tolerance value (for example 0.05 or Ø0.1)')
        : !s.datums
          ? ctx.t('Tolerance frame: datums (for example A or A B C; Enter for none)')
          : !s.leader
            ? ctx.t('Tolerance frame: arrow point on the feature (Enter for no leader)')
            : ctx.t('Tolerance frame: frame position (bottom-left corner)'),
  text(s, text, ctx) {
    const u = text.trim().toUpperCase();
    if (!s.characteristic) {
      const id = GDT_KEYS[u] ?? (u.toLowerCase() in GDT_SYMBOLS ? u.toLowerCase() : null);
      if (!id) {
        ctx.say({ kind: 'warn', text: ctx.t('Unknown characteristic. Use one of: {keys}.', { keys: Object.keys(GDT_KEYS).join(' ') }) });
        return s;
      }
      return { ...s, characteristic: id };
    }
    if (!s.tolerance) {
      if (!text.trim()) return s;
      return { ...s, tolerance: text.trim().replace(/^d/i, 'Ø').replace(/^dia\s*/i, 'Ø') };
    }
    if (!s.datums) return { ...s, datums: u.split(/[\s,;-]+/).filter(Boolean).slice(0, 3) };
    ctx.say({ kind: 'warn', text: ctx.t('Pick a point.') });
    return s;
  },
  enter(s) {
    if (!s.characteristic || !s.tolerance) return s;
    if (!s.datums) return { ...s, datums: [] };
    if (!s.leader) return { ...s, leader: { x: NaN, y: NaN } };
    return s;
  },
  point(s, p, ctx) {
    if (!s.characteristic || !s.tolerance || !s.datums) return s;
    if (!s.leader) return { ...s, leader: p };
    const leader = Number.isNaN(s.leader.x) ? undefined : s.leader;
    ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'gdt', layer: dimLayer(ctx), position: p, rotation: 0, characteristic: s.characteristic, tolerance: s.tolerance, datums: s.datums, ...(leader ? { leader } : {}) }] });
    return null;
  },
  preview(s, cursor, ctx) {
    if (!cursor || !s.characteristic || !s.tolerance || !s.datums || !s.leader) return [];
    const leader = Number.isNaN(s.leader.x) ? undefined : s.leader;
    return [{ id: '_p', type: 'gdt', layer: dimLayer(ctx), position: cursor, rotation: 0, characteristic: s.characteristic, tolerance: s.tolerance, datums: s.datums, ...(leader ? { leader } : {}) }];
  },
  reference: (s) => (s.leader && !Number.isNaN(s.leader.x) ? s.leader : null),
};

interface DatumState {
  label: string | null;
  position: Vec2 | null;
}
let nextDatum = 'A';
export const datumTool: Tool<DatumState> = {
  id: 'datum',
  init: () => ({ label: null, position: null }),
  prompt: (s, ctx) => (!s.label ? ctx.t('Datum: letter (Enter = {l})', { l: nextDatum }) : !s.position ? ctx.t('Datum: point on the feature') : ctx.t('Datum: a second point along the feature (Enter = horizontal)')),
  text(s, text, ctx) {
    if (s.label) {
      ctx.say({ kind: 'warn', text: ctx.t('Pick a point.') });
      return s;
    }
    const l = text.trim().toUpperCase();
    if (!/^[A-Z]{1,2}$/.test(l)) {
      ctx.say({ kind: 'warn', text: ctx.t('A datum label is one or two letters, for example A or AB.') });
      return s;
    }
    return { ...s, label: l };
  },
  enter(s, ctx) {
    if (!s.label) return { ...s, label: nextDatum };
    if (s.position) return finishDatum(s, 0, ctx);
    return s;
  },
  point(s, p, ctx) {
    if (!s.label) return s;
    if (!s.position) return { ...s, position: p };
    const d = sub(p, s.position);
    return finishDatum(s, Math.hypot(d.x, d.y) === 0 ? 0 : angleOf(d), ctx);
  },
  preview: (s, cursor, ctx) => (s.label && s.position ? [{ id: '_p', type: 'datum', layer: dimLayer(ctx), position: s.position, rotation: cursor ? angleOf(sub(cursor, s.position)) : 0, label: s.label }] : []),
  reference: (s) => s.position,
};
function finishDatum(s: DatumState, rotation: number, ctx: ToolCtx): null {
  ctx.run({ kind: 'addEntities', entities: [{ id: ctx.ids(), type: 'datum', layer: dimLayer(ctx), position: s.position as Vec2, rotation, label: s.label as string }] });
  const code = (s.label as string).charCodeAt(0);
  nextDatum = code < 90 ? String.fromCharCode(code + 1) : 'A';
  return null;
}

export const ANNOTATE_TOOLS = [dimLinearTool, dimAlignedTool, dimAngularTool, dimRadiusTool, dimDiameterTool, dimOrdinateTool, noteTool, balloonTool, surfaceTool, gdtTool, datumTool] as Tool<unknown>[];
