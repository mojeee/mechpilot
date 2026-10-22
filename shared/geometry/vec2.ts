// 2D vectors in millimetres, double precision. Plain objects so they serialize as they are.

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** z component of a × b: positive when b is counter-clockwise from a. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Rotate `a` by `angle` radians (counter-clockwise, y up) around `center`. */
export function rotate(a: Vec2, angle: number, center: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = a.x - center.x;
  const dy = a.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const fromAngle = (angle: number, r = 1): Vec2 => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
/** Equal within `eps` (default 1e-9 mm, far below any manufacturing tolerance). */
export const eq = (a: Vec2, b: Vec2, eps = 1e-9): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Axis-aligned box in mm. */
export interface Box {
  min: Vec2;
  max: Vec2;
}
export const boxOf = (points: Vec2[]): Box | null => {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
};
export const boxUnion = (a: Box | null, b: Box | null): Box | null => {
  if (!a) return b;
  if (!b) return a;
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
  };
};

/** Distance from point `p` to the segment a-b. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Normalize an angle to [0, 2π). */
export const normAngle = (a: number): number => {
  const twoPi = Math.PI * 2;
  const r = a % twoPi;
  return r < 0 ? r + twoPi : r;
};

/** True when `angle` lies on the counter-clockwise arc from `start` to `end`. */
export function angleInArc(angle: number, start: number, end: number): boolean {
  const a = normAngle(angle - start);
  const span = normAngle(end - start);
  return span === 0 ? true : a <= span;
}
