// The engine wrapper: planegcs (FreeCAD's sketch solver as WebAssembly, LGPL-2.0-or-later) behind a
// small API. Runs in the solver worker (app/workers/solver) and in Node tests. The engine is a
// separate, replaceable module (CLAUDE.md, Licences); everything else talks to shared/sketch/model.ts
// and the worker protocol, never to planegcs directly.
//
// Each group of connected geometry (a cluster) is solved on its own: planegcs diagnoses a system
// with a dense QR decomposition in a fixed ~21 MB WebAssembly heap, so one big system of unrelated
// geometry is slow and soon runs out of memory, while many small systems are fast.

import { Algorithm, DebugMode, GcsWrapper, init_planegcs_module, SolveStatus, type GcsSystem, type SketchPrimitive } from '@salusoft89/planegcs';
import type { Document, Entity, Id, PointRef } from '../doc/types';
import type { Vec2 } from '../geometry/vec2';
import { t } from '../i18n';
import { analyse, applySolution, buildSystem, explain, freeDof, type SketchDiagnosis, type SketchSystem, type SolverEntity } from './model';

export type SolverAlgorithm = 'dogleg' | 'levenberg-marquardt' | 'bfgs';
export type Freedom = 'free' | 'constrained' | 'unknown';

export interface SolveOptions {
  /** Drag: pull this point towards `to` (a temporary constraint; planegcs then uses SQP). */
  temporary?: { ref: PointRef; to: Vec2 };
  algorithm?: SolverAlgorithm;
  /** Driving dimensions take part (default true). */
  drivingDimensions?: boolean;
}

export interface SolveResult {
  entities: Entity[];
  diagnosis: SketchDiagnosis;
}

export interface SketchSolver {
  solve(doc: Document, opts?: SolveOptions): SolveResult;
  /** Per solver entity: can the solver still move it? (DOF colouring.) */
  freedom(doc: Document, maxEntities?: number): Record<Id, Freedom>;
  /** False after the engine aborted (e.g. out of memory): create a new solver. */
  readonly healthy: boolean;
  dispose(): void;
}

export interface CreateSolverOptions {
  /** URL of planegcs.wasm (Vite: `import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'`). */
  wasmUrl?: string;
  /** The wasm bytes (Node tests: read from node_modules). */
  wasmBinary?: ArrayBuffer | Uint8Array;
}

/**
 * Size guard for one cluster: unknowns × constraints. planegcs' memory is fixed (about 21 MB); its
 * dense diagnosis ran out of memory at about 390,000 in our measurements (a chain of 230 lines with
 * coincident and horizontal/vertical constraints: 920 unknowns × 459 constraints). Half of that
 * keeps a margin; bigger clusters are reported, not solved.
 */
export const MAX_CLUSTER_WORK = 200_000;

/** A point that moved more than this (mm) in the freedom test can still move. */
export const FREEDOM_TOL = 1e-7;

/* ---------- loading the engine ---------- */

interface PlanegcsModule {
  GcsSystem: new () => GcsSystem;
}
interface EmscriptenConfig {
  locateFile?: (path: string, prefix: string) => string;
  instantiateWasm?: (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) => object;
}
// The package ships no declaration next to the emscripten loader in dist/, so type it here.
const initModule = init_planegcs_module as unknown as (config?: EmscriptenConfig) => Promise<PlanegcsModule>;
type WrapperModule = ConstructorParameters<typeof GcsWrapper>[1];

export async function createSolver(opts: CreateSolverOptions = {}): Promise<SketchSolver> {
  let config: EmscriptenConfig | undefined;
  let failed: Promise<never> | undefined;
  if (opts.wasmBinary) {
    // The emscripten build has no `wasmBinary` option: instantiate the bytes ourselves.
    // A Uint8Array over its own ArrayBuffer (what WebAssembly.instantiate accepts).
    const bytes: Uint8Array<ArrayBuffer> = opts.wasmBinary instanceof Uint8Array ? new Uint8Array(opts.wasmBinary) : new Uint8Array(opts.wasmBinary);
    let reject: (e: unknown) => void = () => undefined;
    failed = new Promise<never>((_, r) => (reject = r));
    config = {
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(bytes, imports).then((r) => done(r.instance), reject);
        return {};
      },
    };
  } else if (opts.wasmUrl) {
    const url = opts.wasmUrl;
    config = { locateFile: () => url };
  }
  const mod = await (failed ? Promise.race([initModule(config), failed]) : initModule(config));
  return new PlanegcsSolver(mod);
}

/* ---------- the solver ---------- */

const ALGORITHMS: Record<SolverAlgorithm, Algorithm> = { dogleg: Algorithm.DogLeg, 'levenberg-marquardt': Algorithm.LevenbergMarquardt, bfgs: Algorithm.BFGS };

interface RunResult {
  status: SolveStatus;
  dof: number;
  conflicting: string[];
  redundant: string[];
  partiallyRedundant: string[];
  solved: SketchPrimitive[];
}

/** Golden angle: pull directions that never line up, for the freedom test. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

class PlanegcsSolver implements SketchSolver {
  private wrapper: GcsWrapper | null;
  private gcs: GcsSystem | null;
  private ok = true;

  constructor(mod: PlanegcsModule) {
    this.gcs = new mod.GcsSystem();
    this.wrapper = new GcsWrapper(this.gcs, mod as unknown as WrapperModule);
    // Minimal debug (the default) prints "Sketcher Redundant solving" lines to the console.
    this.wrapper.debug_mode = DebugMode.NoDebug;
  }

  get healthy(): boolean {
    return this.ok && this.wrapper !== null;
  }

  dispose(): void {
    if (this.wrapper && this.ok) {
      try {
        this.wrapper.destroy_gcs_module();
      } catch {
        /* the engine may already be gone */
      }
    }
    this.wrapper = null;
    this.gcs = null;
  }

  private run(prims: SketchPrimitive[], algorithm: Algorithm): RunResult {
    const w = this.wrapper;
    const gcs = this.gcs;
    if (!w || !gcs || !this.ok) throw new Error('The solver was disposed.');
    try {
      w.clear_data();
      w.push_primitives_and_params(prims);
      const status = w.solve(algorithm);
      // planegcs computes the DOF and the conflicts while solving (dof() is −1 before).
      const dof = gcs.dof();
      const conflicting = w.get_gcs_conflicting_constraints();
      const redundant = w.get_gcs_redundant_constraints();
      const partiallyRedundant = w.get_gcs_partially_redundant_constraints();
      w.apply_solution();
      return { status, dof, conflicting, redundant, partiallyRedundant, solved: w.sketch_index.get_primitives() };
    } catch (e) {
      // An abort (out of memory) leaves the WebAssembly instance unusable.
      if (e instanceof WebAssembly.RuntimeError) this.ok = false;
      throw e;
    }
  }

  solve(doc: Document, opts: SolveOptions = {}): SolveResult {
    const a = analyse(doc, opts);
    const algorithm = ALGORITHMS[opts.algorithm ?? 'dogleg'];
    const conflicting: Id[] = [];
    const redundant: Id[] = [];
    const partiallyRedundant: Id[] = [];
    const entities: Entity[] = [];
    let dof = 0;
    let failed = false;
    let reason: SketchDiagnosis['reason'];
    let detail: string | undefined;

    for (const [x, y] of a.structuralConflicts) conflicting.push(x, y);
    for (const id of a.unconstrained) dof += freeDof(a.byId.get(id) as SolverEntity);

    for (const cluster of a.clusters) {
      const sys = buildSystem(doc, { ...opts, analysis: a, entities: new Set(cluster) });
      const work = clusterWork(sys);
      if (work > MAX_CLUSTER_WORK) {
        failed = true;
        reason = 'too-large';
        detail = t('{n} entities in one connected group, {u} unknowns', { n: cluster.length, u: sys.unknowns });
        continue;
      }
      let r: RunResult;
      try {
        r = this.run(sys.primitives, algorithm);
      } catch (e) {
        failed = true;
        reason = 'engine-error';
        detail = e instanceof Error ? e.message : String(e);
        if (!this.ok) break;
        continue;
      }
      const own = (ids: string[]) => [...new Set(ids.map((p) => sys.ownerOf(p)).filter((x): x is Id => x !== undefined))];
      const conf = own(r.conflicting);
      conflicting.push(...conf);
      redundant.push(...own(r.redundant));
      partiallyRedundant.push(...own(r.partiallyRedundant));
      dof += r.dof;
      const clusterFailed = conf.length === 0 && (r.status === SolveStatus.Failed || r.status === SolveStatus.SuccessfulSolutionInvalid);
      if (clusterFailed) {
        failed = true;
        continue;
      }
      entities.push(...applySolution(doc, sys, r.solved));
    }

    const uniq = (ids: Id[]) => [...new Set(ids)];
    const diagnosis: SketchDiagnosis = {
      status: conflicting.length ? 'conflicting' : failed ? 'failed' : redundant.length ? 'redundant' : a.hasConstraints ? 'solved' : 'empty',
      dof,
      conflicting: uniq(conflicting),
      redundant: uniq(redundant),
      partiallyRedundant: uniq(partiallyRedundant),
      skippedDimensions: a.skippedDimensions,
      skippedConstraints: a.skippedConstraints,
      fixedOnly: a.fixedOnly,
      freeExample: a.unconstrained[0],
      message: '',
    };
    if (diagnosis.status === 'failed' && reason) {
      diagnosis.reason = reason;
      if (detail !== undefined) diagnosis.detail = detail;
    }
    if (diagnosis.freeExample === undefined) delete diagnosis.freeExample;
    diagnosis.message = explain(doc, diagnosis);
    return { entities, diagnosis };
  }

  /**
   * DOF colouring. Entities with no constraint are free; polylines with arcs are fixed. For each
   * cluster: solve it, then pull every point (and every radius) a little in a different direction
   * with temporary constraints and solve again (planegcs uses SQP: it moves the geometry as close to
   * the pulls as the real constraints allow). A point that cannot move stays where it is; any
   * freedom left shows up as movement. One extra solve per cluster instead of one per entity.
   */
  freedom(doc: Document, maxEntities = 300): Record<Id, Freedom> {
    const a = analyse(doc);
    const out: Record<Id, Freedom> = {};
    if (a.entities.length > maxEntities) {
      for (const e of a.entities) out[e.id] = 'unknown';
      return out;
    }
    for (const id of a.unconstrained) out[id] = 'free';
    for (const id of a.fixedOnly) out[id] = 'constrained';
    // Structural conflicts make the sketch over-constrained: no colouring for the lines involved.
    const conflicted = new Set(a.structuralConflicts.flat().flatMap((cid) => constraintEntityIds(doc, cid)));

    for (const cluster of a.clusters) {
      const mark = (f: Freedom) => {
        for (const id of cluster) out[id] = f;
      };
      if (cluster.some((id) => conflicted.has(id))) {
        mark('unknown');
        continue;
      }
      const sys = buildSystem(doc, { analysis: a, entities: new Set(cluster) });
      if (clusterWork(sys) > MAX_CLUSTER_WORK) {
        mark('unknown');
        continue;
      }
      try {
        const base = this.run(sys.primitives, Algorithm.DogLeg);
        if (base.conflicting.length || base.status === SolveStatus.Failed || base.status === SolveStatus.SuccessfulSolutionInvalid) {
          mark('unknown');
          continue;
        }
        const before = new Map<string, SketchPrimitive>(base.solved.map((p) => [p.id, p]));
        const pulls = pullPrimitives(base.solved);
        if (pulls.length === 0) {
          mark('constrained');
          continue;
        }
        const after = new Map<string, SketchPrimitive>(this.run([...base.solved, ...pulls], Algorithm.DogLeg).solved.map((p) => [p.id, p]));
        for (const id of cluster) out[id] = moved(id, before, after) ? 'free' : 'constrained';
      } catch {
        mark('unknown');
        if (!this.ok) break;
      }
    }
    for (const e of a.entities) if (!(e.id in out)) out[e.id] = 'unknown';
    return out;
  }
}

/** Unknowns × constraint primitives: the size guard's measure (see MAX_CLUSTER_WORK). */
function clusterWork(sys: SketchSystem): number {
  let constraints = 0;
  for (const p of sys.primitives) if (p.type !== 'point' && p.type !== 'line' && p.type !== 'circle' && p.type !== 'arc') constraints++;
  return sys.unknowns * Math.max(1, constraints);
}

/** Temporary pulls for the freedom test: every free point 1 mm away, every radius 1 mm larger. */
function pullPrimitives(solved: SketchPrimitive[]): SketchPrimitive[] {
  const out: SketchPrimitive[] = [];
  let k = 0;
  for (const p of solved) {
    if (p.type === 'point' && !p.fixed && p.id !== '__drag.point') {
      const angle = ++k * GOLDEN;
      const target = `__pull.${k}`;
      out.push({ id: target, type: 'point', x: p.x + Math.cos(angle), y: p.y + Math.sin(angle), fixed: true });
      out.push({ id: `${target}.c`, type: 'p2p_coincident', p1_id: p.id, p2_id: target, temporary: true });
    } else if (p.type === 'circle') {
      out.push({ id: `__pull.${++k}`, type: 'circle_radius', c_id: p.id, radius: p.radius + 1, temporary: true });
    } else if (p.type === 'arc') {
      out.push({ id: `__pull.${++k}`, type: 'arc_radius', a_id: p.id, radius: p.radius + 1, temporary: true });
    }
  }
  return out;
}

/** Did any point (or the radius) of an entity move between two solutions? */
function moved(id: Id, before: Map<string, SketchPrimitive>, after: Map<string, SketchPrimitive>): boolean {
  for (const [pid, p] of before) {
    if (!(pid === id || pid.startsWith(`${id}.`))) continue;
    const q = after.get(pid);
    if (!q) continue;
    if (p.type === 'point' && q.type === 'point' && Math.hypot(q.x - p.x, q.y - p.y) > FREEDOM_TOL) return true;
    if ((p.type === 'circle' && q.type === 'circle') || (p.type === 'arc' && q.type === 'arc')) {
      if (Math.abs(q.radius - p.radius) > FREEDOM_TOL) return true;
    }
  }
  return false;
}

function constraintEntityIds(doc: Document, cid: Id): Id[] {
  const c = doc.constraints[cid];
  if (!c) return [];
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':
      return [c.entity];
    case 'parallel':
    case 'perpendicular':
      return [c.a, c.b];
    default:
      return [];
  }
}

