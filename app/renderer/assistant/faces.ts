// Measuring a face of the built mesh for a `face` reference: every triangle carries the id of the
// B-rep face it came from (PartMesh.faceIds), so a face is the set of its triangles. Centre, normal
// and area are area-weighted over those triangles (measured on this model, product rule 7).

import type { PartMesh } from '@shared/cad/protocol';
import { t } from '@shared/i18n';

export interface FaceInfo {
  faceId: number;
  center: [number, number, number];
  normal: [number, number, number];
  /** mm² */
  area: number;
  /** The triangles' corner positions, flat (for the highlight geometry). */
  positions: Float32Array;
}

export function faceInfo(mesh: PartMesh, faceId: number): FaceInfo | null {
  const P = mesh.positions;
  const I = mesh.indices;
  const tris: number[] = [];
  for (let k = 0; k < mesh.faceIds.length; k++) if (mesh.faceIds[k] === faceId) tris.push(k);
  if (tris.length === 0) return null;
  let area = 0;
  const c = [0, 0, 0];
  const n = [0, 0, 0];
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((tri, j) => {
    const a = I[tri * 3] * 3;
    const b = I[tri * 3 + 1] * 3;
    const d = I[tri * 3 + 2] * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const vx = P[d] - P[a];
    const vy = P[d + 1] - P[a + 1];
    const vz = P[d + 2] - P[a + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const ar = Math.hypot(cx, cy, cz) / 2;
    area += ar;
    n[0] += cx / 2;
    n[1] += cy / 2;
    n[2] += cz / 2;
    for (let k = 0; k < 3; k++) c[k] += (ar * (P[a + k] + P[b + k] + P[d + k])) / 3;
    for (let k = 0; k < 3; k++) {
      positions[j * 9 + k] = P[a + k];
      positions[j * 9 + 3 + k] = P[b + k];
      positions[j * 9 + 6 + k] = P[d + k];
    }
  });
  const nl = Math.hypot(n[0], n[1], n[2]);
  // A closed curved face (a full cylinder) has no average normal: report the zero vector.
  const normal: [number, number, number] = nl > 1e-9 * Math.max(area, 1) ? [n[0] / nl, n[1] / nl, n[2] / nl] : [0, 0, 0];
  const center: [number, number, number] = area > 0 ? [c[0] / area, c[1] / area, c[2] / area] : [P[I[tris[0] * 3] * 3], P[I[tris[0] * 3] * 3 + 1], P[I[tris[0] * 3] * 3 + 2]];
  return { faceId, center, normal, area, positions };
}

/** "+Z" when the normal is along an axis, else "(0.71, 0.00, 0.71)"; "curved" when it averages out. */
export function normalText(n: [number, number, number]): string {
  if (n[0] === 0 && n[1] === 0 && n[2] === 0) return t('curved');
  const axes = ['X', 'Y', 'Z'];
  for (let k = 0; k < 3; k++) if (Math.abs(n[k]) > 0.9995) return `${n[k] > 0 ? '+' : '−'}${axes[k]}`;
  return `(${n.map((v) => v.toFixed(2)).join(', ')})`;
}

export function areaText(mm2: number): string {
  return mm2 >= 100 ? `${(mm2 / 100).toFixed(mm2 >= 10_000 ? 0 : 1)} cm²` : `${mm2.toFixed(1)} mm²`;
}

export function faceLabel(info: FaceInfo, partName: string): string {
  return t('Face {n} of {part}, normal {normal}, {area}', { n: info.faceId, part: partName, normal: normalText(info.normal), area: areaText(info.area) });
}

export function pointLabel(p: [number, number, number]): string {
  return t('Point ({x}, {y}, {z})', { x: p[0].toFixed(2), y: p[1].toFixed(2), z: p[2].toFixed(2) });
}
