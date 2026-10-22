// Spatial index for picking, snapping and view culling (product rule 8). A uniform grid of
// buckets over the document's extent: build is O(n), a rectangle query touches only the cells it
// covers. Entities that span many cells go into one "large" list instead of every cell, so a long
// centre line does not flood the grid. Rebuilt on every document change (cheap: ~100k boxes in a
// few tens of ms) and queried many times per frame.

import type { Box, Vec2 } from '../geometry/vec2';

export interface Indexed<K> {
  key: K;
  box: Box;
}

export class SpatialIndex<K = string> {
  private readonly cells = new Map<number, K[]>();
  private readonly large: Indexed<K>[] = [];
  private readonly boxes = new Map<K, Box>();
  private readonly minX: number;
  private readonly minY: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;

  /** `items` with their boxes in mm. `targetPerCell` tunes the cell size from the item density. */
  constructor(items: Indexed<K>[], targetPerCell = 8) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const it of items) {
      if (it.box.min.x < minX) minX = it.box.min.x;
      if (it.box.min.y < minY) minY = it.box.min.y;
      if (it.box.max.x > maxX) maxX = it.box.max.x;
      if (it.box.max.y > maxY) maxY = it.box.max.y;
    }
    if (items.length === 0) {
      minX = minY = 0;
      maxX = maxY = 1;
    }
    const w = Math.max(maxX - minX, 1e-6);
    const h = Math.max(maxY - minY, 1e-6);
    const cellsWanted = Math.max(1, items.length / targetPerCell);
    // Never smaller than 1 µm: a query far outside the extent must not loop over billions of cells.
    this.cell = Math.max(Math.sqrt((w * h) / cellsWanted) || 1, 1e-3);
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil(w / this.cell) + 1);
    this.rows = Math.max(1, Math.ceil(h / this.cell) + 1);
    const maxSpan = 64; // cells; beyond this an item is "large"
    for (const it of items) {
      this.boxes.set(it.key, it.box);
      const c0 = this.col(it.box.min.x);
      const c1 = this.col(it.box.max.x);
      const r0 = this.row(it.box.min.y);
      const r1 = this.row(it.box.max.y);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > maxSpan) {
        this.large.push(it);
        continue;
      }
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * this.cols + c;
          const list = this.cells.get(k);
          if (list) list.push(it.key);
          else this.cells.set(k, [it.key]);
        }
      }
    }
  }

  private col(x: number): number {
    return Math.floor((x - this.minX) / this.cell);
  }
  private row(y: number): number {
    return Math.floor((y - this.minY) / this.cell);
  }

  get size(): number {
    return this.boxes.size;
  }

  boxOf(key: K): Box | undefined {
    return this.boxes.get(key);
  }

  /** Keys whose box intersects `box`, each once, in no particular order. */
  query(box: Box): K[] {
    const out: K[] = [];
    const seen = new Set<K>();
    // Cells outside the grid hold nothing: clamp, so a query far away costs nothing.
    const c0 = Math.max(0, this.col(box.min.x));
    const c1 = Math.min(this.cols - 1, this.col(box.max.x));
    const r0 = Math.max(0, this.row(box.min.y));
    const r1 = Math.min(this.rows - 1, this.row(box.max.y));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells.get(r * this.cols + c);
        if (!list) continue;
        for (const k of list) {
          if (seen.has(k)) continue;
          seen.add(k);
          const b = this.boxes.get(k)!;
          if (overlaps(b, box)) out.push(k);
        }
      }
    }
    for (const it of this.large) if (overlaps(it.box, box)) out.push(it.key);
    return out;
  }

  /** Keys whose box comes within `tolerance` of the point (candidates for picking and snapping). */
  near(p: Vec2, tolerance: number): K[] {
    return this.query({ min: { x: p.x - tolerance, y: p.y - tolerance }, max: { x: p.x + tolerance, y: p.y + tolerance } });
  }
}

export const overlaps = (a: Box, b: Box): boolean => a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
export const contains = (outer: Box, inner: Box): boolean => inner.min.x >= outer.min.x && inner.max.x <= outer.max.x && inner.min.y >= outer.min.y && inner.max.y <= outer.max.y;
