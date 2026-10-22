// The sample's sketch solves cleanly: no conflicts, no redundancy, the plate stays 120 × 80, and
// the sides are fully constrained (what the user sees on File > Open sample).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@shared/doc/file';
import { createSolver, type SketchSolver } from '@shared/sketch/solver';

let solver: SketchSolver;
beforeAll(async () => {
  solver = await createSolver();
});
afterAll(() => solver.dispose());

describe('sample sketch', () => {
  it('mounting bracket: solved, no redundancy, 120 × 80 kept', () => {
    const r = parse(readFileSync(join(__dirname, '..', 'samples', 'mounting-bracket.mechpilot.json'), 'utf8'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = solver.solve(r.doc);
    expect(out.diagnosis.status, JSON.stringify(out.diagnosis)).toBe('solved');
    expect(out.diagnosis.skippedDimensions).toEqual([]);
    // Already solved on disk: nothing should move.
    expect(out.entities.map((e) => e.id)).toEqual([]);
    const freedom = solver.freedom(r.doc);
    expect(freedom.e1).toBe('constrained');
    expect(freedom.e5).toBe('constrained');
  });
});
