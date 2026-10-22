// The part builder: a feature tree (shared/doc/types.ts, Feature) becomes a B-rep solid through
// replicad on OpenCascade (opencascade.js, LGPL-2.1, a separate module loaded by
// shared/cad/kernel.ts in the kernel worker, app/workers/kernel). No DOM here: this runs in a Web
// Worker and in Node tests.
//
// Rules (docs/parts.md):
// - Features run in order. A suppressed feature is 'skipped'. A feature that cannot be built is
//   'failed' with a plain-word error (product rule 5) and the body continues as it was before it.
//   Features that use a failed or suppressed sketch are 'skipped'.
// - A sketch alone builds nothing; extrude, revolve and hole read it.
// - Rebuilds reuse the bodies of the unchanged leading features (product rule 8).

import {
  addHolesInFace,
  basicFaceExtrusion,
  cast,
  draw,
  drawCircle,
  drawEllipse,
  EdgeFinder,
  FaceFinder,
  getOC,
  isShape3D,
  makeCompound,
  makeCylinder,
  makeFace,
  makePlane,
  makeProjectedEdges,
  measureArea,
  measureShapeVolumeProperties,
  ProjectionCamera,
  revolution,
  setOC,
  Sketch,
  Vector,
  type AnyShape,
  type Drawing,
  type Edge,
  type Face,
  type Shape3D,
  type Wire,
} from 'replicad';
import type { OpenCascadeInstance, TopoDS_Shape } from 'replicad-opencascadejs';
import iso273 from '@library/holes/iso-273.json';
import tapDrills from '@library/holes/tap-drills.json';
import type { BuildResult, FeatureError, MassProperties, PartMesh, SectionResult } from './protocol';
import type { Document, EdgeSelector, FaceSelector, Feature, HoleSpec, Id, Part, SketchPlane } from '../doc/types';
import type { Vec2 } from '../geometry/vec2';
import { getLanguage, t } from '../i18n';
import { buildProfile, chainPolylines, crossesAxis, fmt, holePoints, penSteps, planeFrame, toPlane, toWorld, type PlaneFrame, type Profile, type ProfileLoop, type ProfileResult, type Vec3 } from './profile';

/** Display mesh (protocol PartMesh): chord deflection in mm and angular deflection in radians. */
export const MESH_TOLERANCE = 0.05;
export const MESH_ANGULAR_TOLERANCE = 0.3;
/** Finer mesh for STL and 3MF files. */
export const EXPORT_TOLERANCE = 0.01;
export const EXPORT_ANGULAR_TOLERANCE = 0.1;

export type FeatureStatus = BuildResult['status'][Id];
export type ViewDirection = 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom' | 'iso';

type SketchFeature = Extract<Feature, { kind: 'sketch' }>;

/* ---------- errors ---------- */

/** A feature that cannot be built: the message is plain words, already translated. */
export class FeatureFailure extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'FeatureFailure';
  }
}

/** The engine aborted (out of memory, a crash): its state is lost; create a new kernel. */
export class EngineAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineAbort';
  }
}

/** True for errors that leave the WebAssembly module unusable. */
export function isAbort(e: unknown): boolean {
  if (e instanceof EngineAbort) return true;
  if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Aborted\(|out of memory|memory access out of bounds|unreachable/i.test(msg);
}

/** The C++ exception text of an OpenCascade error, or the JavaScript message. */
export function engineMessage(e: unknown): string {
  try {
    if (typeof WebAssembly !== 'undefined' && 'Exception' in WebAssembly && e instanceof WebAssembly.Exception) {
      const [type, message] = getOC().getExceptionMessage(e);
      return message ? `${type}: ${message}` : type;
    }
  } catch {
    // The exception could not be read: fall through.
  }
  return e instanceof Error ? e.message : String(e);
}

/* ---------- small vector helpers ---------- */

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subV = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulV = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dotV = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const AXIS: Record<'X' | 'Y' | 'Z', Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** Axis name for messages: "+Z", "−Y". */
function axisName(v: Vec3): string {
  const i = Math.abs(v[0]) > 0.5 ? 0 : Math.abs(v[1]) > 0.5 ? 1 : 2;
  return `${v[i] < 0 ? '−' : '+'}${'XYZ'[i]}`;
}

/* ---------- library data (library/holes) ---------- */

interface ClearanceRow {
  thread: string;
  fine: number;
  medium: number;
  coarse: number;
}
interface TapRow {
  thread: string;
  pitch: number;
  drill: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function rows<T>(json: unknown, key: string, ok: (r: Record<string, unknown>) => boolean): T[] {
  const list = isRecord(json) ? json[key] : undefined;
  return Array.isArray(list) ? (list.filter((r): r is Record<string, unknown> => isRecord(r) && ok(r)) as unknown as T[]) : [];
}

const CLEARANCE: ClearanceRow[] = rows<ClearanceRow>(iso273 as unknown, 'holes', (r) => typeof r.thread === 'string');
const TAP_DRILLS: TapRow[] = rows<TapRow>(tapDrills as unknown, 'threads', (r) => typeof r.thread === 'string' && typeof r.drill === 'number');

const sameThread = (a: string, b: string) => a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase();

/** The drill diameter of a hole spec (mm), from library/holes for clearance and tapped holes. */
export function holeDiameter(spec: HoleSpec): number {
  if (spec.kind === 'simple') return spec.diameter;
  if (spec.kind === 'clearance') {
    const row = CLEARANCE.find((r) => sameThread(r.thread, spec.thread));
    const d = row?.[spec.series];
    if (!row) throw new FeatureFailure(t("The library has no clearance hole for the thread '{thread}'. Threads in the library: {list}.", { thread: spec.thread, list: CLEARANCE.map((r) => r.thread).join(', ') }));
    const series = { fine: t('fine'), medium: t('medium'), coarse: t('coarse') }[spec.series];
    if (typeof d !== 'number') throw new FeatureFailure(t("The library has no clearance hole of the {series} series for the thread '{thread}'.", { thread: spec.thread, series }));
    return d;
  }
  const row = TAP_DRILLS.find((r) => sameThread(r.thread, spec.thread));
  if (!row) throw new FeatureFailure(t("The library has no tap drill for the thread '{thread}'. Threads in the library: {list}.", { thread: spec.thread, list: TAP_DRILLS.map((r) => r.thread).join(', ') }));
  return row.drill;
}

/* ---------- sketches ---------- */

interface SketchInfo {
  feature: SketchFeature;
  frame: PlaneFrame;
  profile: ProfileResult;
  /** Index in the feature list. */
  index: number;
  status: FeatureStatus;
}

/** The replicad drawing of a loop (in sketch coordinates). */
export function loopDrawing(loop: ProfileLoop): Drawing {
  const s = loop.shape;
  if (s.kind === 'circle') return drawCircle(s.radius).translate(s.center.x, s.center.y);
  if (s.kind === 'ellipse') return drawEllipse(s.rx, s.ry).rotate((s.rotation * 180) / Math.PI, [0, 0]).translate(s.center.x, s.center.y);
  const { start, steps } = penSteps(s.segments);
  const pen = draw([start.x, start.y]);
  for (const st of steps) {
    if (st.op === 'line') pen.lineTo([st.to.x, st.to.y]);
    else if (st.op === 'arc') pen.threePointsArcTo([st.to.x, st.to.y], [st.via.x, st.via.y]);
    else if (st.op === 'ellipse') pen.ellipseTo([st.to.x, st.to.y], st.rx, st.ry, st.rotation, st.long, st.ccw);
    else pen.bezierCurveTo([st.to.x, st.to.y], st.controls.map((c): [number, number] => [c.x, c.y]));
  }
  return pen.close();
}

function loopWire(loop: ProfileLoop, frame: PlaneFrame): Wire {
  const sketch = loopDrawing(loop).sketchOnPlane(frame.plane, frame.offset);
  if (!(sketch instanceof Sketch)) throw new FeatureFailure(t('A loop of the sketch could not be turned into one closed outline.'));
  return sketch.wire;
}

/** The planar faces of a profile on its plane: one per outer loop, with its holes. */
export function profileFaces(profile: Profile, frame: PlaneFrame): Face[] {
  return profile.regions.map((r) => {
    const face = makeFace(loopWire(r.outer, frame));
    return r.holes.length > 0 ? addHolesInFace(face, r.holes.map((h) => loopWire(h, frame))) : face;
  });
}

/* ---------- shape helpers ---------- */

function fuseAll(shapes: Shape3D[]): Shape3D {
  let out = shapes[0];
  for (let i = 1; i < shapes.length; i++) out = out.fuse(shapes[i]);
  return out;
}

function asShape3D(s: AnyShape): Shape3D {
  if (!isShape3D(s)) throw new FeatureFailure(t('OpenCascade returned something that is not a solid.'));
  return s;
}

export function volumeOf(s: Shape3D): number {
  return measureShapeVolumeProperties(s).volume;
}

/** OpenCascade's own check (BRepCheck_Analyzer). */
export function isValidShape(s: Shape3D): boolean {
  const oc = getOC();
  const analyzer = new oc.BRepCheck_Analyzer(s.wrapped, true, false, false);
  try {
    return analyzer.IsValid();
  } finally {
    analyzer.delete();
  }
}

/** Exact axis-aligned bounds (BRepBndLib::AddOptimal, no triangulation, no tolerance gap). */
export function boundsOf(s: { wrapped: TopoDS_Shape }): { min: Vec3; max: Vec3 } | null {
  const oc = getOC();
  const box = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.AddOptimal(s.wrapped, box, false, false);
    if (box.IsVoid()) return null;
    return { min: [box.GetXMin(), box.GetYMin(), box.GetZMin()], max: [box.GetXMax(), box.GetYMax(), box.GetZMax()] };
  } finally {
    box.delete();
  }
}

/** A new body must be a valid solid with some volume; otherwise the feature failed. */
function checked(s: Shape3D, failure: () => FeatureFailure): Shape3D {
  if (!isValidShape(s) || !(volumeOf(s) > 1e-9)) throw failure();
  return s;
}

/* ---------- selectors ---------- */

function edgesFor(body: Shape3D, sel: EdgeSelector): Edge[] {
  switch (sel.kind) {
    case 'all':
      return body.edges;
    case 'parallelTo':
      return new EdgeFinder().inDirection(sel.axis).find(body);
    case 'inPlane':
      return new EdgeFinder().inPlane(sel.plane, sel.offset).find(body);
    case 'ofLength':
      return new EdgeFinder().ofLength((l) => Math.abs(l - sel.length) <= 1e-6).find(body);
    case 'inBox': {
      const tol = 1e-6;
      return body.edges.filter((e) => {
        const b = boundsOf(e);
        return !!b && [0, 1, 2].every((i) => b.min[i] >= Math.min(sel.min[i], sel.max[i]) - tol && b.max[i] <= Math.max(sel.min[i], sel.max[i]) + tol);
      });
    }
  }
}

const DIRECTIONS: Record<Extract<FaceSelector, { kind: 'normal' }>['direction'], { plane: SketchPlane; dir: Vec3 }> = {
  'X+': { plane: 'YZ', dir: [1, 0, 0] },
  'X-': { plane: 'YZ', dir: [-1, 0, 0] },
  'Y+': { plane: 'XZ', dir: [0, 1, 0] },
  'Y-': { plane: 'XZ', dir: [0, -1, 0] },
  'Z+': { plane: 'XY', dir: [0, 0, 1] },
  'Z-': { plane: 'XY', dir: [0, 0, -1] },
};

function facesFor(body: Shape3D, sel: FaceSelector): Face[] {
  if (sel.kind === 'inPlane') return new FaceFinder().inPlane(sel.plane, sel.offset).find(body);
  const { plane, dir } = DIRECTIONS[sel.direction];
  return new FaceFinder()
    .parallelTo(plane)
    .when(({ normal }) => !!normal && normal.x * dir[0] + normal.y * dir[1] + normal.z * dir[2] > 0.5)
    .find(body);
}

/* ---------- features ---------- */

interface Ctx {
  doc: Document;
  part: Part;
  sketches: Map<Id, SketchInfo>;
}

function sketchFor(ctx: Ctx, f: { name: string; sketch: Id }, index: number): SketchInfo | 'skip' {
  const s = ctx.sketches.get(f.sketch);
  if (!s || s.index > index) {
    const exists = ctx.part.features.find((g) => g.id === f.sketch);
    if (exists && exists.kind === 'sketch') throw new FeatureFailure(t("'{name}' uses the sketch '{sketch}', which comes after it in the feature list.", { name: f.name, sketch: exists.name }), t('Move the sketch above this feature.'));
    throw new FeatureFailure(t("'{name}' uses a sketch that is no longer in this part.", { name: f.name }), t('Choose another sketch for this feature.'));
  }
  if (s.status !== 'ok') return 'skip';
  return s;
}

function profileOf(s: SketchInfo): Profile | 'skip' {
  return s.profile.ok ? s.profile.profile : 'skip';
}

function requireBody(body: Shape3D | null, name: string): Shape3D {
  if (!body) throw new FeatureFailure(t("There is no body yet for '{name}' to work on.", { name }), t('Add an extrude, a revolve or an import before this feature.'));
  return body;
}

function applyOp(body: Shape3D | null, tool: Shape3D, op: 'add' | 'cut', name: string, noTouch?: () => FeatureFailure): Shape3D {
  if (op === 'add') return body ? checked(body.fuse(tool), () => new FeatureFailure(t("'{name}' could not be joined to the body.", { name }))) : tool;
  const b = requireBody(body, name);
  const before = volumeOf(b);
  const out = b.cut(tool);
  const after = volumeOf(out);
  if (!(after > 1e-9)) throw new FeatureFailure(t("The cut '{name}' removes the whole body.", { name }), t('Make the cut smaller or move it.'));
  if (Math.abs(before - after) <= 1e-9 * Math.max(1, before)) throw noTouch ? noTouch() : new FeatureFailure(t("The cut '{name}' does not touch the body.", { name }), t('Check the plane, the offset and the direction of the cut.'));
  return checked(out, () => new FeatureFailure(t("The cut '{name}' could not be built.", { name })));
}

type StepOutcome = { body: Shape3D | null; status: FeatureStatus };

function buildFeature(ctx: Ctx, f: Feature, index: number, body: Shape3D | null): StepOutcome {
  const skipped: StepOutcome = { body, status: 'skipped' };
  switch (f.kind) {
    case 'sketch':
      return { body, status: 'ok' };

    case 'extrude': {
      const s = sketchFor(ctx, f, index);
      if (s === 'skip') return skipped;
      const profile = profileOf(s);
      if (profile === 'skip') return skipped;
      if (!(f.distance > 0)) throw new FeatureFailure(t("The distance of '{name}' must be more than 0 mm.", { name: f.name }));
      const offset = f.direction === 'both' ? s.frame.offset - f.distance / 2 : s.frame.offset;
      const frame = planeFrame(s.frame.plane, offset);
      const vec = mulV(frame.normal, f.direction === 'reverse' ? -f.distance : f.distance);
      const solids = profileFaces(profile, frame).map((face) => basicFaceExtrusion(face, new Vector(vec)));
      const tool = checked(fuseAll(solids), () => new FeatureFailure(t("'{name}' could not be extruded from its sketch.", { name: f.name }), t('Check that the profile does not touch itself.')));
      return { body: applyOp(body, tool, f.op, f.name), status: 'ok' };
    }

    case 'revolve': {
      const s = sketchFor(ctx, f, index);
      if (s === 'skip') return skipped;
      const profile = profileOf(s);
      if (profile === 'skip') return skipped;
      if (!(f.angle > 0 && f.angle <= 360)) throw new FeatureFailure(t("The angle of '{name}' must be more than 0° and at most 360°.", { name: f.name }));
      const a = toWorld(s.frame, f.axis.a);
      const dir = subV(toWorld(s.frame, f.axis.b), a);
      if (Math.hypot(...dir) < 1e-9) throw new FeatureFailure(t("The axis of '{name}' has two equal points.", { name: f.name }), t('Pick two different points for the axis.'));
      if (crossesAxis(profile, f.axis.a, f.axis.b)) throw new FeatureFailure(t("The profile of '{name}' crosses the axis of revolution.", { name: f.name }), t('Move the axis to the edge of the profile, or draw the profile on one side of it.'));
      const solids = profileFaces(profile, s.frame).map((face) => revolution(face, a, dir, f.angle));
      const tool = checked(fuseAll(solids), () => new FeatureFailure(t("'{name}' could not be revolved.", { name: f.name })));
      return { body: applyOp(body, tool, f.op, f.name), status: 'ok' };
    }

    case 'hole': {
      const s = sketchFor(ctx, f, index);
      if (s === 'skip') return skipped;
      const b = requireBody(body, f.name);
      const points = holePoints(ctx.doc, s.feature.entities);
      if (points.length === 0) throw new FeatureFailure(t("The sketch of '{name}' has no circle centres, line end points or polyline vertices to drill at.", { name: f.name }));
      const diameter = holeDiameter(f.spec);
      if (!(diameter > 0)) throw new FeatureFailure(t("The hole diameter of '{name}' must be more than 0 mm.", { name: f.name }));
      const drill = neg(s.frame.normal);
      let length: number;
      if (f.depth === 'through') {
        const bb = boundsOf(b);
        if (!bb) throw new FeatureFailure(t("There is no body yet for '{name}' to work on.", { name: f.name }));
        let reach = -Infinity;
        for (const x of [bb.min[0], bb.max[0]]) for (const y of [bb.min[1], bb.max[1]]) for (const z of [bb.min[2], bb.max[2]]) reach = Math.max(reach, dotV(subV([x, y, z], s.frame.origin), drill));
        length = reach + 1;
      } else {
        if (!(f.depth > 0)) throw new FeatureFailure(t("The depth of '{name}' must be more than 0 mm.", { name: f.name }));
        length = f.depth;
      }
      const noTouch = () =>
        new FeatureFailure(
          t("The holes of '{name}' do not touch the body: they are drilled along {dir} from the sketch plane at {offset} mm.", { name: f.name, dir: axisName(drill), offset: fmt(s.frame.offset) }),
          t('Put the hole sketch on the face to drill, or change the plane offset.'),
        );
      if (!(length > 0)) throw noTouch();
      const cylinders = points.map((p) => makeCylinder(diameter / 2, length, toWorld(s.frame, p), drill));
      const tool = cylinders.length === 1 ? cylinders[0] : asShape3D(makeCompound(cylinders));
      return { body: applyOp(b, tool, 'cut', f.name, noTouch), status: 'ok' };
    }

    case 'fillet':
    case 'chamfer': {
      const b = requireBody(body, f.name);
      const size = f.kind === 'fillet' ? f.radius : f.distance;
      const tooBig = () =>
        f.kind === 'fillet'
          ? new FeatureFailure(t('The fillet of {r} mm does not fit on these edges; try a smaller radius or fewer edges.', { r: fmt(size) }))
          : new FeatureFailure(t('The chamfer of {d} mm does not fit on these edges; try a smaller distance or fewer edges.', { d: fmt(size) }));
      if (!(size > 0)) throw new FeatureFailure(f.kind === 'fillet' ? t("The radius of '{name}' must be more than 0 mm.", { name: f.name }) : t("The distance of '{name}' must be more than 0 mm.", { name: f.name }));
      const edges = edgesFor(b, f.edges);
      if (edges.length === 0) throw new FeatureFailure(t("No edge of the body matches the edges chosen for '{name}'.", { name: f.name }), t('Change the edge selection.'));
      let out: Shape3D;
      try {
        out = f.kind === 'fillet' ? b.fillet(size, (finder) => finder.inList(edges)) : b.chamfer(size, (finder) => finder.inList(edges));
      } catch (e) {
        if (isAbort(e)) throw e;
        throw tooBig();
      }
      return { body: checked(out, tooBig), status: 'ok' };
    }

    case 'shell': {
      const b = requireBody(body, f.name);
      if (!(f.thickness > 0)) throw new FeatureFailure(t("The thickness of '{name}' must be more than 0 mm.", { name: f.name }));
      const fail = () => new FeatureFailure(t('The shell of {t} mm cannot be built on this body; try a thinner wall or remove other faces.', { t: fmt(f.thickness) }));
      const faces: Face[] = [];
      for (const sel of f.faces) for (const face of facesFor(b, sel)) if (!faces.some((g) => g.isSame(face))) faces.push(face);
      if (f.faces.length > 0 && faces.length === 0) throw new FeatureFailure(t("No face of the body matches the faces chosen for '{name}'.", { name: f.name }), t('Change the face selection.'));
      try {
        if (faces.length > 0) return { body: checked(b.shell({ filter: new FaceFinder().inList(faces), thickness: f.thickness }), fail), status: 'ok' };
        // Closed hollow: OpenCascade's thick solid without removed faces is the inner offset; cut it out.
        const inner = b.shell({ filter: new FaceFinder().when(() => false), thickness: f.thickness });
        const vb = volumeOf(b);
        const vi = volumeOf(inner);
        if (!(vi > 1e-9 && vi < vb)) throw fail();
        const out = checked(b.cut(inner), fail);
        if (Math.abs(volumeOf(out) - (vb - vi)) > 1e-6 * vb) throw fail();
        return { body: out, status: 'ok' };
      } catch (e) {
        if (isAbort(e) || e instanceof FeatureFailure) throw e;
        throw fail();
      }
    }

    case 'mirror': {
      const b = requireBody(body, f.name);
      const mirrored = b.clone().mirror(makePlane(f.plane, f.offset));
      return { body: checked(b.fuse(mirrored), () => new FeatureFailure(t("'{name}' could not be joined to the body.", { name: f.name }))), status: 'ok' };
    }

    case 'pattern': {
      const b = requireBody(body, f.name);
      const copies: Shape3D[] = [];
      if (f.mode === 'linear') {
        const [n1, n2] = f.counts;
        if (!(Number.isInteger(n1) && Number.isInteger(n2) && n1 >= 1 && n2 >= 1)) throw new FeatureFailure(t("The counts of '{name}' must be whole numbers of 1 or more.", { name: f.name }));
        if (n1 * n2 > 1000) throw new FeatureFailure(t("'{name}' would make {n} copies; the limit is 1000.", { name: f.name, n: n1 * n2 }));
        const u = mulV(AXIS[f.axes[0]], f.spacing[0]);
        const v = mulV(AXIS[f.axes[1]], f.spacing[1]);
        for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) if (i || j) copies.push(b.clone().translate(addV(mulV(u, i), mulV(v, j))));
      } else {
        if (!(Number.isInteger(f.count) && f.count >= 1)) throw new FeatureFailure(t("The count of '{name}' must be a whole number of 1 or more.", { name: f.name }));
        if (f.count > 1000) throw new FeatureFailure(t("'{name}' would make {n} copies; the limit is 1000.", { name: f.name, n: f.count }));
        if (!(f.angle > 0 && f.angle <= 360)) throw new FeatureFailure(t("The angle of '{name}' must be more than 0° and at most 360°.", { name: f.name }));
        // A full turn spreads the copies evenly; a smaller angle puts the last copy at that angle.
        const step = f.angle === 360 ? 360 / f.count : f.angle / Math.max(1, f.count - 1);
        for (let k = 1; k < f.count; k++) copies.push(b.clone().rotate(step * k, [0, 0, 0], AXIS[f.axis]));
      }
      let out = b;
      for (const c of copies) out = out.fuse(c);
      return { body: checked(out, () => new FeatureFailure(t("'{name}' could not be joined to the body.", { name: f.name }))), status: 'ok' };
    }

    case 'import': {
      let shape: Shape3D;
      try {
        shape = readStep(decodeBase64(f.data));
      } catch (e) {
        if (isAbort(e)) throw e;
        throw new FeatureFailure(t("The STEP file '{file}' could not be read.", { file: f.sourceName }), t('Export it again from the other program as STEP AP214 or AP242.'));
      }
      return { body: body ? checked(body.fuse(shape), () => new FeatureFailure(t("'{name}' could not be joined to the body.", { name: f.name }))) : shape, status: 'ok' };
    }
  }
}

/* ---------- STEP ---------- */

let fileCounter = 0;

/** Read STEP text into one shape (STEPControl_Reader). Throws when nothing solid comes out. */
export function readStep(text: string | Uint8Array): Shape3D {
  const oc = getOC();
  const name = `/mechpilot-in-${++fileCounter}.step`;
  oc.FS.writeFile(name, typeof text === 'string' ? new TextEncoder().encode(text) : text);
  const reader = new oc.STEPControl_Reader();
  try {
    if (reader.ReadFile(name) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP file not readable');
    reader.TransferRoots(new oc.Message_ProgressRange());
    const shape = cast(reader.OneShape());
    if (!isShape3D(shape) || !(volumeOf(shape) > 0)) throw new Error('STEP file has no solid');
    return shape;
  } finally {
    reader.delete();
    try {
      oc.FS.unlink(name);
    } catch {
      // already gone
    }
  }
}

/**
 * Write a shape as STEP AP214 text in millimetres. The shape goes through an XCAF document so the
 * STEP product carries the part's name (STEPCAFControl_Writer); no colour or layer is written.
 */
export function writeStep(shape: Shape3D, productName: string): string {
  const oc = getOC();
  const name = `/mechpilot-out-${++fileCounter}.step`;
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('XmlOcaf', true));
  const session = new oc.XSControl_WorkSession();
  const writer = new oc.STEPCAFControl_Writer(session, false);
  const progress = new oc.Message_ProgressRange();
  try {
    oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
    const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const label = tool.NewShape();
    tool.SetShape(label, shape.wrapped);
    oc.TDataStd_Name.Set(label, new oc.TCollection_ExtendedString(productName || 'part', true));
    tool.UpdateAssemblies();
    oc.Interface_Static.SetCVal('write.step.unit', 'MM');
    writer.SetNameMode(true);
    writer.SetColorMode(false);
    writer.SetLayerMode(false);
    if (!writer.Perform(doc, name, progress)) throw new Error(t('The body could not be written as STEP.'));
    return oc.FS.readFile(name, { encoding: 'utf8' });
  } finally {
    progress.delete();
    writer.delete();
    session.delete();
    doc.delete();
    try {
      oc.FS.unlink(name);
    } catch {
      // never written
    }
  }
}

export function decodeBase64(data: string): Uint8Array {
  const bin = atob(data.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- mesh and properties ---------- */

export function meshOf(shape: Shape3D, tolerance = MESH_TOLERANCE, angularTolerance = MESH_ANGULAR_TOLERANCE): PartMesh {
  const m = shape.mesh({ tolerance, angularTolerance });
  const faceIds = new Uint32Array(m.triangles.length / 3);
  // faceGroups count index entries (three per triangle).
  m.faceGroups.forEach((g, i) => faceIds.fill(i, g.start / 3, (g.start + g.count) / 3));
  const e = shape.meshEdges({ tolerance, angularTolerance });
  // meshEdges gives one polyline per edge (`count` points); the protocol wants segment pairs.
  const segs: number[] = [];
  for (const g of e.edgeGroups) {
    for (let k = g.start; k < g.start + g.count - 1; k++) {
      for (let c = 0; c < 3; c++) segs.push(e.lines[k * 3 + c]);
      for (let c = 0; c < 3; c++) segs.push(e.lines[(k + 1) * 3 + c]);
    }
  }
  return { positions: Float32Array.from(m.vertices), normals: Float32Array.from(m.normals), indices: Uint32Array.from(m.triangles), edges: Float32Array.from(segs), faceIds };
}

export function propertiesOf(shape: Shape3D): MassProperties {
  const vp = measureShapeVolumeProperties(shape);
  const bb = boundsOf(shape) ?? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
  return { volume: vp.volume, area: measureArea(shape), centerOfMass: vp.centerOfMass, bbox: { min: bb.min, max: bb.max } };
}

/* ---------- the build ---------- */

interface CachedStep {
  key: string;
  body: Shape3D | null;
  status: FeatureStatus;
  error?: FeatureError;
}
interface PartCache {
  oc: OpenCascadeInstance;
  lang: string;
  steps: CachedStep[];
  final?: { mesh: PartMesh | null; properties: MassProperties | null };
}
const caches = new Map<string, PartCache>();
const MAX_CACHED_PARTS = 16;

/** Forget the cached bodies (all parts, or one). */
export function clearBuildCache(partId?: Id): void {
  if (partId) caches.delete(partId);
  else caches.clear();
}

function featureKey(doc: Document, f: Feature): string {
  if (f.kind !== 'sketch') return JSON.stringify(f);
  return JSON.stringify(f) + JSON.stringify(f.entities.map((id) => doc.entities[id] ?? null));
}

export interface BuiltPart {
  shape: Shape3D | null;
  result: BuildResult;
}

export interface BuildOptions {
  /** Reuse the bodies of unchanged leading features from the previous build (default true). */
  cache?: boolean;
}

/** Build a part and keep the solid (for exports, sections and projections). */
export function buildShape(doc: Document, partId: Id, opts: BuildOptions = {}): BuiltPart {
  const t0 = now();
  const part = doc.parts[partId];
  if (!part) throw new Error(t('There is no part {id} in this document.', { id: partId }));
  const oc = getOC();
  const lang = getLanguage();
  const useCache = opts.cache !== false;
  let prev = useCache ? caches.get(partId) : undefined;
  if (prev && (prev.oc !== oc || prev.lang !== lang)) prev = undefined;

  // Sketches: profiles are pure and cheap, so they are worked out on every build.
  const sketches = new Map<Id, SketchInfo>();
  const needsProfile = new Set<Id>();
  for (const f of part.features) if (!f.suppressed && (f.kind === 'extrude' || f.kind === 'revolve')) needsProfile.add(f.sketch);
  const status: BuildResult['status'] = {};
  const errors: FeatureError[] = [];
  part.features.forEach((f, index) => {
    if (f.kind !== 'sketch') return;
    const frame = planeFrame(f.plane, f.offset);
    const profile = buildProfile(doc, f);
    let st: FeatureStatus = 'ok';
    if (f.suppressed) st = 'skipped';
    else if (!profile.ok) {
      const missing = f.entities.some((id) => !doc.entities[id]);
      if (missing || needsProfile.has(f.id)) {
        st = 'failed';
        errors.push({ feature: f.id, message: profile.error.message, hint: missing ? t('Remove the missing entity from the sketch or draw it again.') : t('Close the outline: every end must meet exactly one other end.') });
      }
    }
    sketches.set(f.id, { feature: f, frame, profile, index, status: st });
  });

  const ctx: Ctx = { doc, part, sketches };
  const steps: CachedStep[] = [];
  let body: Shape3D | null = null;
  let reusing = !!prev;
  part.features.forEach((f, index) => {
    const key = featureKey(doc, f);
    if (f.kind === 'sketch') {
      status[f.id] = sketches.get(f.id)?.status ?? 'ok';
      steps.push({ key, body, status: status[f.id] });
      if (reusing && prev?.steps[index]?.key !== key) reusing = false;
      return;
    }
    const cached = reusing ? prev?.steps[index] : undefined;
    if (cached && cached.key === key) {
      body = cached.body;
      status[f.id] = cached.status;
      if (cached.error) errors.push(cached.error);
      steps.push(cached);
      return;
    }
    reusing = false;
    let step: CachedStep;
    if (f.suppressed) step = { key, body, status: 'skipped' };
    else {
      try {
        const out = buildFeature(ctx, f, index, body);
        step = { key, body: out.body, status: out.status };
      } catch (e) {
        if (isAbort(e)) throw new EngineAbort(engineMessage(e));
        const error: FeatureError =
          e instanceof FeatureFailure
            ? { feature: f.id, message: e.message, hint: e.hint }
            : { feature: f.id, message: t("OpenCascade could not build '{name}' ({detail}).", { name: f.name, detail: engineMessage(e) }), hint: t('Change its values, or suppress it to see the body without it.') };
        step = { key, body, status: 'failed', error };
      }
    }
    body = step.body;
    status[f.id] = step.status;
    if (step.error) errors.push(step.error);
    steps.push(step);
  });

  const final = body as Shape3D | null;
  let mesh: PartMesh | null = null;
  let properties: MassProperties | null = null;
  // Every step came from the cache and nothing was added or removed: the mesh is the same too.
  if (reusing && prev?.final && prev.steps.length === steps.length) ({ mesh, properties } = prev.final);
  else if (final) {
    mesh = meshOf(final);
    properties = propertiesOf(final);
  }
  if (useCache) {
    caches.delete(partId);
    caches.set(partId, { oc, lang, steps, final: { mesh, properties } });
    while (caches.size > MAX_CACHED_PARTS) caches.delete(caches.keys().next().value as string);
  }
  const order = new Map(part.features.map((f, i) => [f.id, i]));
  errors.sort((a, b) => (order.get(a.feature) ?? 0) - (order.get(b.feature) ?? 0));
  return { shape: final, result: { mesh, properties, status, errors, ms: now() - t0 } };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Build a part's feature tree. `oc` sets the OpenCascade instance replicad uses (else the one set before). */
export function buildPart(doc: Document, partId: Id, oc?: OpenCascadeInstance, opts?: BuildOptions): BuildResult {
  if (oc) setOC(oc);
  return buildShape(doc, partId, opts).result;
}

function bodyOf(doc: Document, partId: Id): { shape: Shape3D; part: Part } {
  const { shape } = buildShape(doc, partId);
  if (!shape) throw new Error(t('The part has no body yet: add an extrude, a revolve or an import.'));
  return { shape, part: doc.parts[partId] };
}

/* ---------- exports ---------- */

/** STEP AP214 text, millimetres (product rule 1: round trip tested in tests/cad-build.test.ts). */
export function exportStep(doc: Document, partId: Id): string {
  const { shape, part } = bodyOf(doc, partId);
  return writeStep(shape, part.name);
}

/** STL in millimetres: binary (80-byte header, triangle count, 50 bytes per triangle) or ASCII. */
export function exportStl(doc: Document, partId: Id, binary = true): Uint8Array {
  const { shape, part } = bodyOf(doc, partId);
  const m = meshOf(shape, EXPORT_TOLERANCE, EXPORT_ANGULAR_TOLERANCE);
  return binary ? stlBinary(m, part.name) : new TextEncoder().encode(stlAscii(m, part.name));
}

function triangleNormal(p: Float32Array, i0: number, i1: number, i2: number): Vec3 {
  const a: Vec3 = [p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]];
  const b: Vec3 = [p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2]];
  const c: Vec3 = [p[i2 * 3], p[i2 * 3 + 1], p[i2 * 3 + 2]];
  const u = subV(b, a);
  const v = subV(c, a);
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  return l > 0 ? mulV(n, 1 / l) : [0, 0, 0];
}

export function stlBinary(m: PartMesh, name: string): Uint8Array {
  const n = m.indices.length / 3;
  const out = new Uint8Array(84 + 50 * n);
  const view = new DataView(out.buffer);
  const header = new TextEncoder().encode(`MechPilot STL, millimetres: ${name}`.slice(0, 80));
  out.set(header.subarray(0, 80), 0);
  view.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i;
    const [a, b, c] = [m.indices[i * 3], m.indices[i * 3 + 1], m.indices[i * 3 + 2]];
    const nrm = triangleNormal(m.positions, a, b, c);
    nrm.forEach((v, k) => view.setFloat32(o + k * 4, v, true));
    [a, b, c].forEach((vi, j) => {
      for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + j * 12 + k * 4, m.positions[vi * 3 + k], true);
    });
    view.setUint16(o + 48, 0, true);
  }
  return out;
}

export function stlAscii(m: PartMesh, name: string): string {
  const solid = name.replace(/\s+/g, '_') || 'part';
  const lines = [`solid ${solid}`];
  for (let i = 0; i < m.indices.length; i += 3) {
    const idx = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
    const n = triangleNormal(m.positions, idx[0], idx[1], idx[2]);
    lines.push(`  facet normal ${n[0]} ${n[1]} ${n[2]}`, '    outer loop');
    for (const v of idx) lines.push(`      vertex ${m.positions[v * 3]} ${m.positions[v * 3 + 1]} ${m.positions[v * 3 + 2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${solid}`, '');
  return lines.join('\n');
}

/** A 3MF package (3MF Core Specification 1.x) with the body as one mesh object, in millimetres. */
export function export3mf(doc: Document, partId: Id): Uint8Array {
  const { shape, part } = bodyOf(doc, partId);
  const m = meshOf(shape, EXPORT_TOLERANCE, EXPORT_ANGULAR_TOLERANCE);
  return threeMf(m, part.name);
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function threeMf(m: PartMesh, name: string): Uint8Array {
  // Weld vertices shared by faces: 3MF Core, chapter 4 "Object Resources", 4.1 Meshes, asks for a
  // closed (manifold) mesh, which needs every edge to be shared by index, not by position only.
  const map = new Map<string, number>();
  const verts: string[] = [];
  const remap = new Uint32Array(m.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = m.positions[i * 3];
    const y = m.positions[i * 3 + 1];
    const z = m.positions[i * 3 + 2];
    const key = `${x} ${y} ${z}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length;
      map.set(key, id);
      verts.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    remap[i] = id;
  }
  const tris: string[] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = remap[m.indices[i]];
    const b = remap[m.indices[i + 1]];
    const c = remap[m.indices[i + 2]];
    if (a === b || b === c || a === c) continue; // degenerate after welding (3MF 4.1.2: v1, v2, v3 distinct)
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  // 3MF Core, chapter 3 "3D Models": <model> with unit="millimeter" (3.3 Model, unit attribute),
  // <resources> with one <object type="model"> holding a <mesh> (4.1: <vertices>, <triangles>),
  // and a <build> with one <item> (3.4 Build). Namespace of 3MF Core 1.x (2015/02).
  const model = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Title">${xmlEscape(name)}</metadata>`,
    '<metadata name="Application">MechPilot</metadata>',
    '<resources>',
    `<object id="1" type="model" name="${xmlEscape(name)}">`,
    '<mesh>',
    '<vertices>',
    ...verts,
    '</vertices>',
    '<triangles>',
    ...tris,
    '</triangles>',
    '</mesh>',
    '</object>',
    '</resources>',
    '<build>',
    '<item objectid="1"/>',
    '</build>',
    '</model>',
    '',
  ].join('\n');
  // 3MF Core, chapter 2 "Parts and Relationships" (Open Packaging Conventions, ECMA-376 Part 2):
  // the content types stream and the package relationship to the 3D model part.
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    '</Types>',
    '',
  ].join('\n');
  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
    '',
  ].join('\n');
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}

/* ---------- ZIP (stored, no compression), PKWARE APPNOTE.TXT 6.3 ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3 polynomial, reflected), as APPNOTE 4.4.7 requires. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of stored entries with a central directory (APPNOTE 4.3.7, 4.3.12, 4.3.16). */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01: fixed so the same part gives the same file
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    // 4.3.7 local file header
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed to extract: 2.0
    lv.setUint16(6, 0x0800, true); // general purpose flag: bit 11, names in UTF-8
    lv.setUint16(8, 0, true); // compression method: 0 = stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true); // compressed size
    lv.setUint32(22, f.data.length, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    lh.set(name, 30);
    locals.push(lh, f.data);
    // 4.3.12 central directory file header
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true); // offset of the local header
    ch.set(name, 46);
    centrals.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  // 4.3.16 end of central directory record
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/* ---------- edges to points ---------- */

/** Points along an edge: the two ends of a straight edge, else samples every ≤0.5 mm (at most 720). */
export function edgePoints(edge: Edge): Vec3[] {
  if (edge.geomType === 'LINE') return [edge.startPoint.toTuple(), edge.endPoint.toTuple()];
  const length = edge.length;
  const n = Math.max(8, Math.min(720, Math.ceil(length / 0.5)));
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) out.push(edge.pointAt(i / n).toTuple());
  return out;
}

/* ---------- section ---------- */

/** The outline where a principal plane at an offset cuts the body (BRepAlgoAPI_Section), as closed loops. */
export function section(doc: Document, partId: Id, plane: SketchPlane, offset: number): SectionResult {
  const { shape } = bodyOf(doc, partId);
  const oc = getOC();
  const frame = planeFrame(plane, offset);
  const pln = new oc.gp_Pln(new oc.gp_Pnt(...frame.origin), new oc.gp_Dir(...frame.normal));
  const algo = new oc.BRepAlgoAPI_Section(shape.wrapped, pln, true);
  try {
    const result = cast(algo.Shape());
    const polylines = result.edges.map((e) => edgePoints(e).map((p) => toPlane(frame, p)));
    const { loops, open } = chainPolylines(polylines);
    const all = [...loops, ...open];
    return { loops: all, loops3d: all.map((l) => l.map((p) => toWorld(frame, p))) };
  } finally {
    algo.delete();
    pln.delete();
  }
}

/* ---------- projection for drawing views ---------- */

/**
 * Cameras for drawing views, ISO 5456-2 (first-angle method, clause 5.2; the placement of the views
 * on the sheet is the drawing's business, here each view is in its own 2D coordinates, mm):
 *   front  (view A): the viewer at −Y looks along +Y;  view x → +X, view y → +Z
 *   top    (view B): the viewer at +Z looks along −Z;  view x → +X, view y → +Y
 *   left   (view C): the viewer at −X looks along +X;  view x → −Y, view y → +Z
 *   right  (view D): the viewer at +X looks along −X;  view x → +Y, view y → +Z
 *   bottom (view E): the viewer at −Z looks along +Z;  view x → +X, view y → −Y
 *   back   (view F): the viewer at +Y looks along −Y;  view x → −X, view y → +Z
 *   iso: the viewer at (+1, −1, +1) (front, right, above), view y up the Z axis.
 * OpenCascade's projector (HLRAlgo_Projector on a gp_Ax2) takes the main direction pointing
 * towards the viewer and gives points as (x along XDirection, y along N × X), as checked in tests.
 */
export const VIEW_CAMERAS: Record<ViewDirection, { toViewer: Vec3; x: Vec3 }> = {
  front: { toViewer: [0, -1, 0], x: [1, 0, 0] },
  top: { toViewer: [0, 0, 1], x: [1, 0, 0] },
  left: { toViewer: [-1, 0, 0], x: [0, -1, 0] },
  right: { toViewer: [1, 0, 0], x: [0, 1, 0] },
  bottom: { toViewer: [0, 0, -1], x: [1, 0, 0] },
  back: { toViewer: [0, 1, 0], x: [-1, 0, 0] },
  iso: { toViewer: [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)], x: [1 / Math.SQRT2, 1 / Math.SQRT2, 0] },
};

/** Visible and hidden edges of the body seen from a view direction (HLRBRep), as 2D polylines in mm. */
export function project(doc: Document, partId: Id, direction: ViewDirection): { visible: Vec2[][]; hidden: Vec2[][] } {
  const { shape } = bodyOf(doc, partId);
  const cam = VIEW_CAMERAS[direction];
  const camera = new ProjectionCamera([0, 0, 0], cam.toViewer, cam.x);
  const { visible, hidden } = makeProjectedEdges(shape, camera, true);
  const to2d = (edges: Edge[]) => edges.map((e) => edgePoints(e).map((p) => ({ x: p[0], y: p[1] })));
  const vis = to2d(visible);
  return { visible: vis, hidden: dropCovered(to2d(hidden), vis) };
}

/**
 * Hidden edges that lie on visible ones (the back edges of a box seen from the front, the circle of
 * a hole seen edge-on) would draw dashes over the outline: the visible line wins, so they are
 * dropped. A hidden polyline is dropped only when all its points and segment midpoints lie within
 * `tol` of visible segments.
 */
export function dropCovered(hidden: Vec2[][], visible: Vec2[][], tol = 1e-6): Vec2[][] {
  const segs: [Vec2, Vec2][] = [];
  for (const l of visible) for (let i = 0; i + 1 < l.length; i++) segs.push([l[i], l[i + 1]]);
  if (segs.length === 0) return hidden;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [a, b] of segs) {
    minX = Math.min(minX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxX = Math.max(maxX, a.x, b.x);
    maxY = Math.max(maxY, a.y, b.y);
  }
  const cell = Math.max(maxX - minX, maxY - minY, 1e-9) / 64;
  const grid = new Map<string, number[]>();
  const cellOf = (v: number, o: number) => Math.floor((v - o) / cell);
  segs.forEach(([a, b], i) => {
    for (let x = cellOf(Math.min(a.x, b.x) - tol, minX); x <= cellOf(Math.max(a.x, b.x) + tol, minX); x++)
      for (let y = cellOf(Math.min(a.y, b.y) - tol, minY); y <= cellOf(Math.max(a.y, b.y) + tol, minY); y++) {
        const k = `${x},${y}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  });
  const onVisible = (p: Vec2): boolean => {
    const list = grid.get(`${cellOf(p.x, minX)},${cellOf(p.y, minY)}`);
    if (!list) return false;
    return list.some((i) => {
      const [a, b] = segs[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)) <= tol;
    });
  };
  return hidden.filter((l) => !l.every((p, i) => onVisible(p) && (i === 0 || onVisible({ x: (p.x + l[i - 1].x) / 2, y: (p.y + l[i - 1].y) / 2 }))));
}

/* ---------- STEP import for the UI ---------- */

/** Read a STEP file for a new `import` feature: its mesh and properties, or a plain message. */
export function importStepText(text: string, name: string): { ok: true; mesh: PartMesh; properties: MassProperties } | { ok: false; message: string } {
  try {
    const shape = readStep(text);
    return { ok: true, mesh: meshOf(shape), properties: propertiesOf(shape) };
  } catch (e) {
    if (isAbort(e)) throw new EngineAbort(engineMessage(e));
    return { ok: false, message: t("The STEP file '{file}' could not be read: it has no solid that OpenCascade can open.", { file: name }) };
  }
}
