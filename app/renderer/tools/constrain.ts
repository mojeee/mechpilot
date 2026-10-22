// Sketch constraint tools: each one picks the entities (and their points) it needs, then adds one
// constraint command; the store re-solves the sketch and reports conflicts in plain words.

import type { Constraint, Entity, Id, PointRef } from '@shared/doc/types';
import { add, dist, fromAngle, type Vec2 } from '@shared/geometry/vec2';
import { parseLength } from '@shared/units';
import type { Tool, ToolCtx } from './types';

/** The entity point nearest to `p` (end points, centre, arc ends, polyline vertices), within tol. */
export function nearestPoint(e: Entity, p: Vec2, tol: number): PointRef | null {
  const candidates: { ref: PointRef; at: Vec2 }[] = [];
  switch (e.type) {
    case 'line':
      candidates.push({ ref: { entity: e.id, point: 'a' }, at: e.a }, { ref: { entity: e.id, point: 'b' }, at: e.b });
      break;
    case 'circle':
      candidates.push({ ref: { entity: e.id, point: 'center' }, at: e.center });
      break;
    case 'arc':
      candidates.push({ ref: { entity: e.id, point: 'center' }, at: e.center }, { ref: { entity: e.id, point: 'start' }, at: add(e.center, fromAngle(e.start, e.radius)) }, { ref: { entity: e.id, point: 'end' }, at: add(e.center, fromAngle(e.end, e.radius)) });
      break;
    case 'polyline':
      e.points.forEach((pt, i) => candidates.push({ ref: { entity: e.id, point: i }, at: pt }));
      break;
    default:
      return null;
  }
  let best: { ref: PointRef; d: number } | null = null;
  for (const c of candidates) {
    const d = dist(c.at, p);
    if (d <= tol && (!best || d < best.d)) best = { ref: c.ref, d };
  }
  return best?.ref ?? null;
}

const POINT_TOL = 2; // mm at any zoom: the store's pick tolerance already found the entity; this picks its point

interface PickState {
  picks: { id: Id; p: Vec2; ref: PointRef | null }[];
  value: number | null;
}
const init = (): PickState => ({ picks: [], value: null });

function pointTool(id: Tool['id'], kind: 'coincident' | 'distance', prompts: [string, string, string?]): Tool<PickState> {
  return {
    id,
    init,
    wantsEntity: (s) => s.picks.length < 2,
    prompt: (s, ctx) => ctx.t(prompts[Math.min(s.picks.length, 2)] ?? ''),
    entity(s, eid, p, ctx) {
      const e = ctx.doc.entities[eid];
      const ref = nearestPoint(e, p, POINT_TOL * 6);
      if (!ref) {
        ctx.say({ kind: 'warn', text: ctx.t('Click near an end point, a centre or a vertex.') });
        return s;
      }
      const picks = [...s.picks, { id: eid, p, ref }];
      if (picks.length < 2) return { ...s, picks };
      if (kind === 'coincident') {
        const [a, b] = picks;
        if (a.ref && b.ref && a.ref.entity === b.ref.entity && a.ref.point === b.ref.point) {
          ctx.say({ kind: 'warn', text: ctx.t('Pick two different points.') });
          return { ...s, picks: [a] };
        }
        addConstraint(ctx, { kind: 'coincident', p1: a.ref as PointRef, p2: b.ref as PointRef });
        return init();
      }
      return { ...s, picks };
    },
    text(s, text, ctx) {
      if (s.picks.length < 2) {
        ctx.say({ kind: 'warn', text: ctx.t('Pick the points first.') });
        return s;
      }
      const v = parseLength(text);
      if (v === null || v < 0) {
        ctx.say({ kind: 'warn', text: ctx.t('Type a distance in mm.') });
        return s;
      }
      const [a, b] = s.picks;
      addConstraint(ctx, { kind: 'distance', p1: a.ref as PointRef, p2: b.ref as PointRef, value: v });
      return init();
    },
    enter(s, ctx) {
      if (kind === 'distance' && s.picks.length === 2) {
        // Enter keeps the current distance.
        const [a, b] = s.picks;
        const pa = pointAt(ctx, a.ref as PointRef);
        const pb = pointAt(ctx, b.ref as PointRef);
        if (pa && pb) addConstraint(ctx, { kind: 'distance', p1: a.ref as PointRef, p2: b.ref as PointRef, value: dist(pa, pb) });
        return init();
      }
      return null;
    },
  };
}

function pointAt(ctx: ToolCtx, ref: PointRef): Vec2 | null {
  const e = ctx.doc.entities[ref.entity];
  if (!e) return null;
  if (typeof ref.point === 'number') return e.type === 'polyline' ? (e.points[ref.point] ?? null) : null;
  if (e.type === 'line') return ref.point === 'a' ? e.a : e.b;
  if (e.type === 'circle') return e.center;
  if (e.type === 'arc') return ref.point === 'center' ? e.center : add(e.center, fromAngle(ref.point === 'start' ? e.start : e.end, e.radius));
  return null;
}

/** A constraint without its id (distributed over the union, so each kind keeps its own fields). */
type ConstraintBody = Constraint extends infer C ? (C extends { id: string } ? Omit<C, 'id'> : never) : never;

function addConstraint(ctx: ToolCtx, c: ConstraintBody): void {
  ctx.run({ kind: 'addConstraints', constraints: [{ id: ctx.ids(), ...c } as Constraint] });
}

function oneEntityTool(id: Tool['id'], kind: 'horizontal' | 'vertical' | 'fixed', types: Entity['type'][], prompt: string, wrong: string): Tool<PickState> {
  return {
    id,
    init,
    wantsEntity: () => true,
    prompt: (_s, ctx) => ctx.t(prompt),
    entity(s, eid, _p, ctx) {
      const e = ctx.doc.entities[eid];
      if (!types.includes(e.type)) {
        ctx.say({ kind: 'warn', text: ctx.t(wrong) });
        return s;
      }
      addConstraint(ctx, { kind, entity: eid });
      return s;
    },
    enter: () => null,
  };
}

function twoEntityTool(id: Tool['id'], kind: 'parallel' | 'perpendicular' | 'tangent' | 'equal' | 'angle', types: Entity['type'][], prompts: [string, string], wrong: string): Tool<PickState> {
  return {
    id,
    init,
    wantsEntity: (s) => s.picks.length < 2,
    prompt: (s, ctx) => (s.picks.length === 0 ? ctx.t(prompts[0]) : s.picks.length === 1 ? ctx.t(prompts[1]) : ctx.t('Angle in degrees (Enter keeps the current angle)')),
    entity(s, eid, p, ctx) {
      const e = ctx.doc.entities[eid];
      if (!types.includes(e.type)) {
        ctx.say({ kind: 'warn', text: ctx.t(wrong) });
        return s;
      }
      if (s.picks[0]?.id === eid) {
        ctx.say({ kind: 'warn', text: ctx.t('Pick a different second entity.') });
        return s;
      }
      const picks = [...s.picks, { id: eid, p, ref: null }];
      if (picks.length < 2) return { ...s, picks };
      if (kind === 'angle') return { ...s, picks };
      if (kind === 'tangent') {
        const [a, b] = picks.map((x) => ctx.doc.entities[x.id]);
        if (a.type === 'line' && b.type === 'line') {
          ctx.say({ kind: 'warn', text: ctx.t('Tangent needs a circle or an arc on at least one side.') });
          return init();
        }
      }
      if (kind === 'equal') {
        const [a, b] = picks.map((x) => ctx.doc.entities[x.id]);
        if ((a.type === 'line') !== (b.type === 'line')) {
          ctx.say({ kind: 'warn', text: ctx.t('Equal works between two lines (lengths) or two circles or arcs (radii).') });
          return init();
        }
      }
      addConstraint(ctx, { kind, a: picks[0].id, b: picks[1].id } as ConstraintBody);
      return init();
    },
    text(s, text, ctx) {
      if (kind !== 'angle' || s.picks.length < 2) return s;
      const v = Number(text.trim().replace('°', '').replace(',', '.'));
      if (!Number.isFinite(v)) {
        ctx.say({ kind: 'warn', text: ctx.t('Type an angle in degrees, for example 90 or -45.') });
        return s;
      }
      addConstraint(ctx, { kind: 'angle', a: s.picks[0].id, b: s.picks[1].id, value: (v * Math.PI) / 180 });
      return init();
    },
    enter(s, ctx) {
      if (kind === 'angle' && s.picks.length === 2) {
        const a = ctx.doc.entities[s.picks[0].id];
        const b = ctx.doc.entities[s.picks[1].id];
        if (a.type === 'line' && b.type === 'line') {
          const ang = Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x) - Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x);
          addConstraint(ctx, { kind: 'angle', a: a.id, b: b.id, value: ang });
        }
        return init();
      }
      return null;
    },
  };
}

export const coincidentTool = pointTool('c-coincident', 'coincident', ['Coincident: first point (click near an end point, centre or vertex)', 'Coincident: second point']);
export const distanceTool = pointTool('c-distance', 'distance', ['Distance: first point', 'Distance: second point', 'Distance in mm (Enter keeps the current distance)']);
export const horizontalTool = oneEntityTool('c-horizontal', 'horizontal', ['line'], 'Horizontal: click a line (Enter to finish)', 'Horizontal works on lines.');
export const verticalTool = oneEntityTool('c-vertical', 'vertical', ['line'], 'Vertical: click a line (Enter to finish)', 'Vertical works on lines.');
export const fixedTool = oneEntityTool('c-fixed', 'fixed', ['line', 'circle', 'arc', 'polyline'], 'Fix: click an entity to lock it in place (Enter to finish)', 'Fix works on lines, circles, arcs and polylines.');
export const parallelTool = twoEntityTool('c-parallel', 'parallel', ['line'], ['Parallel: first line', 'Parallel: second line'], 'Parallel works between two lines.');
export const perpendicularTool = twoEntityTool('c-perpendicular', 'perpendicular', ['line'], ['Perpendicular: first line', 'Perpendicular: second line'], 'Perpendicular works between two lines.');
export const tangentTool = twoEntityTool('c-tangent', 'tangent', ['line', 'circle', 'arc'], ['Tangent: first entity', 'Tangent: second entity'], 'Tangent works between lines, circles and arcs.');
export const equalTool = twoEntityTool('c-equal', 'equal', ['line', 'circle', 'arc'], ['Equal: first entity', 'Equal: second entity'], 'Equal works between lines, circles and arcs.');
export const angleTool = twoEntityTool('c-angle', 'angle', ['line'], ['Angle: first line', 'Angle: second line'], 'Angle works between two lines.');

interface RadiusState {
  entity: Id | null;
}
export const radiusTool: Tool<RadiusState> = {
  id: 'c-radius',
  init: () => ({ entity: null }),
  wantsEntity: (s) => !s.entity,
  prompt: (s, ctx) => (s.entity ? ctx.t('Radius in mm (Enter keeps the current radius)') : ctx.t('Radius constraint: click a circle or an arc')),
  entity(s, eid, _p, ctx) {
    const e = ctx.doc.entities[eid];
    if (e.type !== 'circle' && e.type !== 'arc') {
      ctx.say({ kind: 'warn', text: ctx.t('Radius works on circles and arcs.') });
      return s;
    }
    return { entity: eid };
  },
  text(s, text, ctx) {
    if (!s.entity) return s;
    const v = parseLength(text);
    if (v === null || v <= 0) {
      ctx.say({ kind: 'warn', text: ctx.t('Type a radius greater than zero in mm.') });
      return s;
    }
    addConstraint(ctx, { kind: 'radius', entity: s.entity, value: v });
    return { entity: null };
  },
  enter(s, ctx) {
    if (!s.entity) return null;
    const e = ctx.doc.entities[s.entity];
    if (e.type === 'circle' || e.type === 'arc') addConstraint(ctx, { kind: 'radius', entity: s.entity, value: e.radius });
    return { entity: null };
  },
};

interface SymState {
  picks: PointRef[];
}
export const symmetricTool: Tool<SymState> = {
  id: 'c-symmetric',
  init: () => ({ picks: [] }),
  wantsEntity: () => true,
  prompt: (s, ctx) => [ctx.t('Symmetric: first point'), ctx.t('Symmetric: second point'), ctx.t('Symmetric: the mirror line')][s.picks.length],
  entity(s, eid, p, ctx) {
    const e = ctx.doc.entities[eid];
    if (s.picks.length < 2) {
      const ref = nearestPoint(e, p, POINT_TOL * 6);
      if (!ref) {
        ctx.say({ kind: 'warn', text: ctx.t('Click near an end point, a centre or a vertex.') });
        return s;
      }
      return { picks: [...s.picks, ref] };
    }
    if (e.type !== 'line') {
      ctx.say({ kind: 'warn', text: ctx.t('The mirror must be a line.') });
      return s;
    }
    addConstraint(ctx, { kind: 'symmetric', p1: s.picks[0], p2: s.picks[1], line: eid });
    return { picks: [] };
  },
  enter: () => null,
};

interface PolState {
  p: PointRef | null;
}
export const pointOnLineTool: Tool<PolState> = {
  id: 'c-point-on-line',
  init: () => ({ p: null }),
  wantsEntity: () => true,
  prompt: (s, ctx) => (s.p ? ctx.t('Point on line: the line') : ctx.t('Point on line: the point (click near an end point, centre or vertex)')),
  entity(s, eid, p, ctx) {
    const e = ctx.doc.entities[eid];
    if (!s.p) {
      const ref = nearestPoint(e, p, POINT_TOL * 6);
      if (!ref) {
        ctx.say({ kind: 'warn', text: ctx.t('Click near an end point, a centre or a vertex.') });
        return s;
      }
      return { p: ref };
    }
    if (e.type !== 'line') {
      ctx.say({ kind: 'warn', text: ctx.t('Point on line needs a line as the second pick.') });
      return s;
    }
    addConstraint(ctx, { kind: 'pointOnLine', p: s.p, line: eid });
    return { p: null };
  },
  enter: () => null,
};

export const CONSTRAIN_TOOLS = [coincidentTool, pointOnLineTool, horizontalTool, verticalTool, parallelTool, perpendicularTool, tangentTool, equalTool, symmetricTool, fixedTool, distanceTool, angleTool, radiusTool] as Tool<unknown>[];
