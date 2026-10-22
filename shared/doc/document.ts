// Creating documents and reading them: bounds, lookups, hit tests. Nothing here mutates.

import { boxOf, boxUnion, dist, distToSegment, fromAngle, add, angleInArc, angleOf, sub, type Box, type Vec2 } from '../geometry/vec2';
import { FORMAT_NAME, FORMAT_VERSION, type Document, type Entity, type Id, type Layer } from './types';

/** The default layers of a new drawing. Line types and widths from library/line-types/iso-128-2.json. */
export function defaultLayers(): Layer[] {
  return [
    // ISO 128-2 Table 1: 01.2 continuous wide for visible outlines; 0.5 mm from the width series.
    { id: '0', name: '0', color: 'auto', lineType: '01.2', lineWidth: 0.5, visible: true, locked: false },
    // 02.1 dashed narrow for hidden edges; narrow = half the wide width (ISO 128-2, 5).
    { id: 'hidden', name: 'Hidden', color: '#f0a63a', lineType: '02.1', lineWidth: 0.25, visible: true, locked: false },
    // 04.1 long-dashed dotted narrow for centre lines.
    { id: 'centre', name: 'Centre', color: '#4da3ff', lineType: '04.1', lineWidth: 0.25, visible: true, locked: false },
    // 01.1 continuous narrow for dimension, extension and leader lines.
    { id: 'dimensions', name: 'Dimensions', color: '#52c98b', lineType: '01.1', lineWidth: 0.25, visible: true, locked: false },
  ];
}

export function newDocument(name = 'Untitled'): Document {
  const layers = defaultLayers();
  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    unit: 'mm',
    name,
    standard: 'iso',
    projection: 'first',
    layers: Object.fromEntries(layers.map((l) => [l.id, l])),
    layerOrder: layers.map((l) => l.id),
    activeLayer: '0',
    entities: {},
    entityOrder: [],
  };
}

export const entitiesInOrder = (doc: Document): Entity[] => doc.entityOrder.map((id) => doc.entities[id]).filter((e): e is Entity => e !== undefined);
export const layersInOrder = (doc: Document): Layer[] => doc.layerOrder.map((id) => doc.layers[id]).filter((l): l is Layer => l !== undefined);

export function entityBox(e: Entity): Box {
  switch (e.type) {
    case 'line':
      return boxOf([e.a, e.b]) as Box;
    case 'circle':
      return { min: { x: e.center.x - e.radius, y: e.center.y - e.radius }, max: { x: e.center.x + e.radius, y: e.center.y + e.radius } };
    case 'arc': {
      // End points plus every axis extreme that lies on the arc.
      const pts = [add(e.center, fromAngle(e.start, e.radius)), add(e.center, fromAngle(e.end, e.radius))];
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if (angleInArc(a, e.start, e.end)) pts.push(add(e.center, fromAngle(a, e.radius)));
      }
      return boxOf(pts) as Box;
    }
  }
}

export function documentBox(doc: Document, onlyVisible = true): Box | null {
  let box: Box | null = null;
  for (const e of entitiesInOrder(doc)) {
    if (onlyVisible && doc.layers[e.layer]?.visible === false) continue;
    box = boxUnion(box, entityBox(e));
  }
  return box;
}

/** Distance from a point to the entity's curve, in mm. */
export function distToEntity(p: Vec2, e: Entity): number {
  switch (e.type) {
    case 'line':
      return distToSegment(p, e.a, e.b);
    case 'circle':
      return Math.abs(dist(p, e.center) - e.radius);
    case 'arc': {
      const a = angleOf(sub(p, e.center));
      if (angleInArc(a, e.start, e.end)) return Math.abs(dist(p, e.center) - e.radius);
      const s = add(e.center, fromAngle(e.start, e.radius));
      const t = add(e.center, fromAngle(e.end, e.radius));
      return Math.min(dist(p, s), dist(p, t));
    }
  }
}

/** The topmost entity within `tolerance` mm of `p`, on a visible, unlocked layer. */
export function pick(doc: Document, p: Vec2, tolerance: number): Id | null {
  let best: { id: Id; d: number } | null = null;
  for (const e of entitiesInOrder(doc)) {
    const layer = doc.layers[e.layer];
    if (!layer || !layer.visible || layer.locked) continue;
    const d = distToEntity(p, e);
    if (d <= tolerance && (!best || d <= best.d)) best = { id: e.id, d };
  }
  return best?.id ?? null;
}

export function countByType(doc: Document): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entitiesInOrder(doc)) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}
