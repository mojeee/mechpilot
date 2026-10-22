// The renderer's one store. The document is only ever changed through run(command): undo, autosave,
// scripting and AI share that path (CLAUDE.md, Architecture). Tools (app/renderer/tools) are state
// machines the store drives with points, text, entity picks and Enter.

import { create } from 'zustand';
import type { Command } from '@shared/commands';
import { canRedo, canUndo, DEFAULT_HISTORY_LIMIT, editorState, execute, markSaved, redo as redoState, undo as undoState, type EditorState } from '@shared/commands/history';
import { explain, type SketchDiagnosis } from '@shared/sketch/model';
import { kernelWorker, solverWorker } from '../workers';
import { documentBox, entityBox, pick } from '@shared/doc/document';
import { newDocument } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import type { Document, Entity, Feature, HoleSpec, Id, Part, Sheet, SheetSize, SketchPlane } from '@shared/doc/types';
import type { BuildResult } from '@shared/cad/protocol';
import { newSheet, sheetPaper } from '@shared/draw/sheet';
import { sheetPage } from '@shared/draw/pages';
import { type Box, type Vec2 } from '@shared/geometry/vec2';
import { randomId } from '@shared/ids';
import { setLanguage, t } from '@shared/i18n';
import { DEFAULT_SETTINGS, type SampleInfo, type Settings } from '@shared/api';
import { contains, overlaps, SpatialIndex } from '@shared/spatial/index';
import { parseLength, parsePoint } from '@shared/units';
import { DEFAULT_SNAPS, findSnap, type SnapResult, type SnapSettings } from '../snap';
// (SnapResult is also the type of the snap handed to tools for inferred constraints.)
import { ALIASES, TOOLS, type ToolCtx, type ToolId } from '../tools';

export type { ToolId } from '../tools';

export interface ViewState {
  /** Pixels per millimetre. */
  scale: number;
  /** Screen position (CSS px) of the world origin. Screen y grows down, world y grows up. */
  origin: Vec2;
}
export interface Message {
  kind: 'info' | 'warn' | 'error';
  text: string;
  hint?: string;
}
export interface Size {
  w: number;
  h: number;
}

export const worldToScreen = (v: ViewState, p: Vec2): Vec2 => ({ x: v.origin.x + p.x * v.scale, y: v.origin.y - p.y * v.scale });
export const screenToWorld = (v: ViewState, p: Vec2): Vec2 => ({ x: (p.x - v.origin.x) / v.scale, y: (v.origin.y - p.y) / v.scale });

const api = () => window.mechpilot;
const PICK_PX = 6;
const SNAP_PX = 10;

export interface Store {
  editor: EditorState;
  filePath: string | null;
  index: SpatialIndex<Id>;
  selection: Id[];
  hover: Id | null;
  view: ViewState;
  canvasSize: Size;
  cursor: Vec2 | null;
  /** The snapped point under the cursor, when a snap applies. */
  snap: SnapResult | null;
  snaps: SnapSettings;
  gridOn: boolean;
  snapGrid: boolean;
  tool: ToolId;
  toolState: unknown;
  selectBox: { a: Vec2; b: Vec2 } | null;
  settings: Settings;
  samples: SampleInfo[];
  message: Message | null;
  version: string;
  /** Autosave: last time the dirty document was written (ms), and whether a recovery file exists. */
  recovery: { path: string; name: string } | null;
  /** The sheet shown on the canvas (paper mm), or null for model space. */
  activeSheet: Id | null;
  setActiveSheet(id: Id | null): void;
  addSheet(size?: SheetSize): void;
  deleteSheet(id: Id): void;
  updateSheet(sheet: Sheet): void;
  /** Export every sheet as one PDF (one page per sheet), or the model at 1:1 on A3 when there is none. */
  exportPdf(): Promise<void>;
  /** M3: the sketch solver's last diagnosis and per-entity freedom (degrees-of-freedom colouring). */
  diagnosis: SketchDiagnosis | null;
  freedom: Record<Id, 'free' | 'constrained' | 'unknown'>;
  solving: boolean;
  /** Solve the constraints now and apply the moved geometry as part of the last undo step. */
  solveNow(): Promise<void>;

  /** M4: the part shown in the 3D view (null = 2D model or a sheet), its build, section and measuring. */
  activePart: Id | null;
  build: BuildResult | null;
  building: boolean;
  section: { plane: SketchPlane; offset: number } | null;
  measure: boolean;
  measurePoints: [number, number, number][];
  setActivePart(id: Id | null): void;
  addPart(name?: string): Id;
  updatePart(part: Part): void;
  deletePart(id: Id): void;
  addFeature(partId: Id, feature: Feature): void;
  updateFeature(partId: Id, feature: Feature): void;
  deleteFeature(partId: Id, featureId: Id): void;
  /** A sketch feature from the selected 2D entities on a plane (and a part when there is none). */
  makeSketch(plane: SketchPlane, offset?: number): Id | null;
  rebuild(): Promise<void>;
  exportPart(format: 'step' | 'stl' | '3mf'): Promise<void>;
  importStepFile(): Promise<void>;
  setSection(section: { plane: SketchPlane; offset: number } | null): void;
  toggleMeasure(): void;
  addMeasurePoint(p: [number, number, number]): void;

  run(cmd: Command): boolean;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  select(ids: Id[], mode?: 'set' | 'toggle' | 'add'): void;
  clearSelection(): void;
  deleteSelection(): void;
  pickAt(world: Vec2): Id | null;
  setHover(id: Id | null): void;
  /** Window (a→b left to right: fully inside) or crossing (right to left: touching) selection. */
  beginSelectBox(a: Vec2): void;
  updateSelectBox(b: Vec2): void;
  endSelectBox(add: boolean): void;

  setTool(tool: ToolId): void;
  cancelTool(): void;
  /** A click on the canvas at a world point (already snapped) or a typed point. */
  toolPoint(p: Vec2): void;
  /** A click on the canvas: picks an entity when the tool wants one, else gives the point. */
  toolClick(world: Vec2, shift: boolean): void;
  toolText(text: string): void;
  toolEnter(): void;
  prompt(): string;
  toolPreview(): Entity[];
  toolReference(): Vec2 | null;
  toolWantsEntity(): boolean;

  setView(view: ViewState): void;
  setCanvasSize(size: Size): void;
  zoomAt(screen: Vec2, factor: number): void;
  panBy(dx: number, dy: number): void;
  zoomExtents(): void;
  zoomTo(box: Box): void;
  /** Update the cursor from a screen position: applies grid snap and object snaps. */
  moveCursor(screen: Vec2 | null): void;
  toggleGrid(): void;
  toggleSnapGrid(): void;
  setSnaps(patch: Partial<SnapSettings>): void;
  gridStep(): number;
  /** Entities whose box meets the view, in drawing order. */
  visibleIds(): Id[];

  newDocument(): void;
  openFile(path?: string): Promise<void>;
  saveFile(saveAs?: boolean): Promise<void>;
  openSample(id: string): Promise<void>;
  loadDocument(doc: Document, path: string | null, label: string): void;
  importDxf(): Promise<void>;
  exportDxf(version: 'R12' | '2000'): Promise<void>;
  autosave(): Promise<void>;
  recover(): Promise<void>;
  dismissRecovery(): Promise<void>;

  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  say(message: Message | null): void;
  runCommandLine(text: string): void;
  runPartCommand(upper: string): boolean;
}

const FIT_PADDING = 40;

function fitView(box: Box | null, size: Size): ViewState {
  if (!box || size.w === 0 || size.h === 0) return { scale: 4, origin: { x: size.w / 2 || 400, y: size.h / 2 || 300 } };
  const w = Math.max(box.max.x - box.min.x, 1e-6);
  const h = Math.max(box.max.y - box.min.y, 1e-6);
  const scale = Math.min((size.w - 2 * FIT_PADDING) / w, (size.h - 2 * FIT_PADDING) / h, 10_000);
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  return { scale, origin: { x: size.w / 2 - cx * scale, y: size.h / 2 + cy * scale } };
}

/** 1-2-5 series: the smallest step whose spacing on screen is at least `minPx`. */
export function gridStepFor(scale: number, minPx = 12): number {
  for (let exp = -3; exp <= 6; exp++) {
    for (const m of [1, 2, 5]) {
      const step = Number((m * 10 ** exp).toPrecision(3));
      if (step * scale >= minPx) return step;
    }
  }
  return 1e7;
}

export function applyTheme(settings: Settings): void {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.canvas = settings.canvas;
  document.documentElement.lang = settings.lang;
  setLanguage(settings.lang);
}

function buildIndex(doc: Document): SpatialIndex<Id> {
  const items = doc.entityOrder.map((id) => ({ key: id, box: entityBox(doc.entities[id]) }));
  return new SpatialIndex(items);
}

function viewBox(view: ViewState, size: Size): Box {
  const a = screenToWorld(view, { x: 0, y: size.h });
  const b = screenToWorld(view, { x: size.w, y: 0 });
  return { min: a, max: b };
}

/** The snap the last tool point came from (set by toolClick before the tool sees the point). */
let lastSnapUsed: SnapResult | null = null;

export const useStore = create<Store>((set, get) => {
  const ctx = (): ToolCtx => {
    const s = get();
    return {
      lastSnap: lastSnapUsed,
      doc: s.editor.doc,
      selection: s.selection,
      layer: s.editor.doc.activeLayer,
      ids: randomId,
      run: (cmd) => get().run(cmd),
      say: (m) => get().say(m),
      select: (ids, mode) => get().select(ids, mode),
      pick: (p) => get().pickAt(p),
      finish: () => set({ tool: 'select', toolState: null }),
      t,
    };
  };
  /** Apply a tool handler's result: null finishes the tool, a state continues it. */
  const after = (next: unknown) => {
    if (next === null) set({ tool: 'select', toolState: null });
    else set({ toolState: next });
  };
  const setEditor = (editor: EditorState, extra: Partial<Store> = {}) => {
    const ids = new Set(Object.keys(editor.doc.entities));
    const s = get();
    const changed = s.editor.doc !== editor.doc;
    set({ editor, index: changed ? buildIndex(editor.doc) : s.index, selection: s.selection.filter((id) => ids.has(id)), hover: s.hover && ids.has(s.hover) ? s.hover : null, ...extra });
    // The 3D part follows every document change (a feature edit, an entity of a sketch moved, undo).
    if (changed && s.activePart) {
      if (editor.doc.parts[s.activePart]) void get().rebuild();
      else get().setActivePart(null);
    }
  };

  const first = editorState(newDocument(t('Untitled')));
  return {
    editor: first,
    filePath: null,
    index: buildIndex(first.doc),
    selection: [],
    hover: null,
    view: { scale: 4, origin: { x: 400, y: 300 } },
    canvasSize: { w: 0, h: 0 },
    cursor: null,
    snap: null,
    snaps: DEFAULT_SNAPS,
    gridOn: true,
    snapGrid: false,
    tool: 'select',
    toolState: null,
    selectBox: null,
    settings: DEFAULT_SETTINGS,
    samples: [],
    message: null,
    version: '',
    recovery: null,
    activeSheet: null,
    diagnosis: null,
    freedom: {},
    solving: false,

    async solveNow() {
      const s = get();
      const doc = s.editor.doc;
      const hasDriving = doc.entityOrder.some((id) => {
        const e = doc.entities[id];
        return e.type === 'dimension' && e.driving !== undefined;
      });
      if (doc.constraintOrder.length === 0 && !hasDriving) {
        if (s.diagnosis || Object.keys(s.freedom).length) set({ diagnosis: null, freedom: {} });
        return;
      }
      if (s.solving) return;
      set({ solving: true });
      try {
        const r = await solverWorker().call('solve', { doc }, 20_000);
        // The document may have changed while solving: apply only if it is still the same one.
        if (get().editor.doc !== doc) {
          set({ solving: false });
          void get().solveNow();
          return;
        }
        if (r.entities.length && r.diagnosis.status !== 'failed') {
          const next = execute(get().editor, { kind: 'updateEntities', entities: r.entities }, DEFAULT_HISTORY_LIMIT, true);
          if (next.ok) setEditor(next.state);
        }
        const text = explain(get().editor.doc, r.diagnosis, t);
        set({ diagnosis: r.diagnosis, message: { kind: r.diagnosis.status === 'conflicting' || r.diagnosis.status === 'redundant' || r.diagnosis.status === 'failed' ? 'warn' : 'info', text } });
        const f = await solverWorker().call('freedom', { doc: get().editor.doc }, 20_000);
        set({ freedom: f });
      } catch (e) {
        set({ diagnosis: null, message: { kind: 'error', text: t('The constraint solver did not answer: {reason}', { reason: e instanceof Error ? e.message : String(e) }) } });
      } finally {
        set({ solving: false });
      }
    },

    activePart: null,
    build: null,
    building: false,
    section: null,
    measure: false,
    measurePoints: [],

    setActivePart(id) {
      set({ activePart: id, activeSheet: null, selection: [], tool: 'select', toolState: null, cursor: null, snap: null, hover: null, measure: false, measurePoints: [] });
      if (id) void get().rebuild();
    },
    addPart(name) {
      const s = get();
      const n = s.editor.doc.partOrder.length + 1;
      const part: Part = { id: randomId(), name: name ?? t('Part {n}', { n }), features: [] };
      s.run({ kind: 'addPart', part });
      return part.id;
    },
    updatePart(part) {
      get().run({ kind: 'updatePart', part });
    },
    deletePart(id) {
      const s = get();
      if (s.run({ kind: 'deletePart', id }) && s.activePart === id) s.setActivePart(null);
    },
    addFeature(partId, feature) {
      const part = get().editor.doc.parts[partId];
      if (!part) return;
      get().run({ kind: 'updatePart', part: { ...part, features: [...part.features, feature] } });
    },
    updateFeature(partId, feature) {
      const part = get().editor.doc.parts[partId];
      if (!part) return;
      get().run({ kind: 'updatePart', part: { ...part, features: part.features.map((f) => (f.id === feature.id ? feature : f)) } });
    },
    deleteFeature(partId, featureId) {
      const part = get().editor.doc.parts[partId];
      if (!part) return;
      get().run({ kind: 'updatePart', part: { ...part, features: part.features.filter((f) => f.id !== featureId) } });
    },
    makeSketch(plane, offset = 0) {
      const s = get();
      const doc = s.editor.doc;
      const ids = s.selection.filter((id) => {
        const e = doc.entities[id];
        return e && ['line', 'arc', 'circle', 'polyline', 'ellipse', 'spline'].includes(e.type);
      });
      if (ids.length === 0) {
        s.say({ kind: 'warn', text: t('Select the lines, arcs or circles of a closed outline first, then type SKETCH.') });
        return null;
      }
      const partId = s.activePart ?? doc.partOrder[doc.partOrder.length - 1] ?? s.addPart();
      const part = get().editor.doc.parts[partId];
      const n = part.features.filter((f) => f.kind === 'sketch').length + 1;
      const feature: Feature = { id: randomId(), name: t('Sketch {n}', { n }), kind: 'sketch', plane, offset, entities: ids };
      get().addFeature(partId, feature);
      get().say({ kind: 'info', text: t('Sketch "{name}" made from {n} entities on the {plane} plane. Now EXTRUDE <distance> or REVOLVE, or use the Features tab.', { name: feature.name, n: ids.length, plane }) });
      return feature.id;
    },
    async rebuild() {
      const s = get();
      const partId = s.activePart;
      if (!partId) return;
      const doc = s.editor.doc;
      if (!doc.parts[partId]) return;
      if (s.building) return;
      set({ building: true });
      try {
        const r = await kernelWorker().call('build', { doc, partId, lang: s.settings.lang }, 120_000);
        if (get().editor.doc !== doc && get().activePart === partId) {
          set({ building: false, build: r });
          void get().rebuild();
          return;
        }
        set({ build: r });
        if (r.errors.length) set({ message: { kind: 'warn', text: r.errors[0].message, hint: r.errors[0].hint } });
      } catch (e) {
        set({ build: null, message: { kind: 'error', text: t('The 3D kernel did not answer: {reason}', { reason: e instanceof Error ? e.message : String(e) }) } });
      } finally {
        set({ building: false });
      }
    },
    async exportPart(format) {
      const s = get();
      const partId = s.activePart;
      if (!partId) {
        s.say({ kind: 'info', text: t('Open a part in the 3D tab first.') });
        return;
      }
      const doc = s.editor.doc;
      const name = doc.parts[partId]?.name ?? doc.name;
      try {
        let bytes: Uint8Array;
        if (format === 'step') bytes = new TextEncoder().encode((await kernelWorker().call('exportStep', { doc, partId }, 120_000)).text);
        else if (format === 'stl') bytes = (await kernelWorker().call('exportStl', { doc, partId, binary: true }, 120_000)).data;
        else bytes = (await kernelWorker().call('export3mf', { doc, partId }, 120_000)).data;
        const r = await api().files.saveBytes(bytes, name, format);
        if (!r.ok) {
          s.say({ kind: 'error', text: r.error.message, hint: r.error.hint });
          return;
        }
        if (r.value) s.say({ kind: 'info', text: t('Exported {path}.', { path: r.value.path }) });
      } catch (e) {
        s.say({ kind: 'error', text: t('Export failed: {reason}', { reason: e instanceof Error ? e.message : String(e) }) });
      }
    },
    async importStepFile() {
      const s = get();
      const r = await api().files.openText([{ name: 'STEP', extensions: ['step', 'stp'] }]);
      if (!r.ok) {
        s.say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      if (!r.value) return;
      const name = r.value.path.replace(/^.*[\\/]/, '');
      const partId = get().addPart(name.replace(/\.(step|stp)$/i, ''));
      const data = btoa(unescape(encodeURIComponent(r.value.text)));
      get().addFeature(partId, { id: randomId(), name: t('Imported {name}', { name }), kind: 'import', format: 'step', data, sourceName: name });
      get().setActivePart(partId);
    },
    setSection: (section) => set({ section }),
    toggleMeasure: () => set({ measure: !get().measure, measurePoints: [] }),
    addMeasurePoint(p) {
      const pts = get().measurePoints;
      set({ measurePoints: pts.length >= 2 ? [p] : [...pts, p] });
    },

    setActiveSheet(id) {
      set({ activeSheet: id, activePart: null, selection: [], tool: 'select', toolState: null, cursor: null, snap: null, hover: null });
      get().zoomExtents();
    },
    addSheet(size = 'A3') {
      const s = get();
      const box = documentBox(s.editor.doc);
      const center = box ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 } : { x: 0, y: 0 };
      const n = s.editor.doc.sheetOrder.length + 1;
      const sheet = newSheet(randomId(), randomId(), t('Sheet {n}', { n }), center, size);
      if (s.run({ kind: 'addSheet', sheet })) s.setActiveSheet(sheet.id);
    },
    deleteSheet(id) {
      const s = get();
      if (s.run({ kind: 'deleteSheet', id }) && s.activeSheet === id) s.setActiveSheet(null);
    },
    updateSheet(sheet) {
      get().run({ kind: 'updateSheet', sheet });
    },
    async exportPdf() {
      const s = get();
      const doc = s.editor.doc;
      const { pdfFromPages } = await import('@shared/pdf');
      const lang = s.settings.lang;
      const sheets = doc.sheetOrder.map((id) => doc.sheets[id]);
      const pages = sheets.length
        ? sheets.map((sh) => sheetPage(doc, sh, lang))
        : [sheetPage(doc, newSheet('tmp', 'v', doc.name, (() => {
            const b = documentBox(doc);
            return b ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 } : { x: 0, y: 0 };
          })()), lang)];
      const bytes = await pdfFromPages(pages, { title: doc.name, author: t('MechPilot user'), creator: `MechPilot ${s.version}` });
      const r = await api().files.savePdf(bytes, doc.name);
      if (!r.ok) {
        s.say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      if (!r.value) return;
      s.say({ kind: 'info', text: t('Exported {path} ({n} pages).', { path: r.value.path, n: pages.length }), hint: sheets.length ? undefined : t('The drawing has no sheet yet, so it was printed at 1:1 on an A3; add a sheet in the Sheets tab to choose the size, scale and title block.') });
    },

    run(cmd) {
      const r = execute(get().editor, cmd);
      if (!r.ok) {
        set({ message: { kind: 'error', text: r.error.message, hint: r.error.hint } });
        return false;
      }
      setEditor(r.state);
      // Geometry or constraints changed: let the solver move things (as part of this undo step).
      if (cmd.kind !== 'setProps' && cmd.kind !== 'setActiveLayer' && cmd.kind !== 'setDimStyle' && !cmd.kind.endsWith('Sheet') && cmd.kind !== 'addLayer' && cmd.kind !== 'updateLayer' && cmd.kind !== 'deleteLayer') {
        queueMicrotask(() => void get().solveNow());
      }
      return true;
    },
    undo() {
      const s = undoState(get().editor);
      if (!s) return;
      setEditor(s, { message: { kind: 'info', text: t('Undo') } });
      set({ freedom: {} });
      queueMicrotask(() => void get().solveNow());
    },
    redo() {
      const s = redoState(get().editor);
      if (!s) return;
      setEditor(s, { message: { kind: 'info', text: t('Redo') } });
      set({ freedom: {} });
      queueMicrotask(() => void get().solveNow());
    },
    canUndo: () => canUndo(get().editor),
    canRedo: () => canRedo(get().editor),

    select(ids, mode = 'set') {
      const cur = get().selection;
      if (mode === 'set') set({ selection: ids });
      else if (mode === 'add') set({ selection: [...new Set([...cur, ...ids])] });
      else {
        const next = new Set(cur);
        for (const id of ids) if (next.has(id)) next.delete(id);
        else next.add(id);
        set({ selection: [...next] });
      }
    },
    clearSelection: () => set({ selection: [] }),
    deleteSelection() {
      const ids = get().selection;
      if (ids.length === 0) {
        get().say({ kind: 'info', text: t('Nothing selected.') });
        return;
      }
      if (get().run({ kind: 'deleteEntities', ids })) set({ selection: [], message: { kind: 'info', text: t('{n} deleted', { n: ids.length }) } });
    },
    pickAt(world) {
      const s = get();
      const tol = PICK_PX / s.view.scale;
      return pick(s.editor.doc, world, tol, s.index.near(world, tol));
    },
    setHover: (hover) => {
      if (get().hover !== hover) set({ hover });
    },
    beginSelectBox: (a) => set({ selectBox: { a, b: a } }),
    updateSelectBox: (b) => {
      const box = get().selectBox;
      if (box) set({ selectBox: { a: box.a, b } });
    },
    endSelectBox(add) {
      const s = get();
      const box = s.selectBox;
      set({ selectBox: null });
      if (!box) return;
      const crossing = box.b.x < box.a.x;
      const rect: Box = { min: { x: Math.min(box.a.x, box.b.x), y: Math.min(box.a.y, box.b.y) }, max: { x: Math.max(box.a.x, box.b.x), y: Math.max(box.a.y, box.b.y) } };
      const doc = s.editor.doc;
      const hit = s.index.query(rect).filter((id) => {
        const e = doc.entities[id];
        const layer = doc.layers[e.layer];
        if (!layer?.visible || layer.locked) return false;
        const b = entityBox(e);
        return crossing ? overlaps(b, rect) : contains(rect, b);
      });
      // Keep drawing order.
      const set2 = new Set(hit);
      const ordered = doc.entityOrder.filter((id) => set2.has(id));
      s.select(ordered, add ? 'add' : 'set');
      if (s.tool !== 'select' && s.toolWantsEntity()) {
        // Tools that collect a selection take it from the store on Enter.
      }
    },

    setTool(tool) {
      const def = TOOLS[tool];
      if (tool === 'select' || !def) {
        set({ tool: 'select', toolState: null, message: null });
        return;
      }
      set({ tool, toolState: def.init(ctx()), message: null });
    },
    cancelTool() {
      const s = get();
      if (s.tool === 'select') set({ selection: [], selectBox: null, message: null });
      else set({ tool: 'select', toolState: null, selectBox: null, message: null });
    },
    toolPoint(p) {
      const s = get();
      const def = TOOLS[s.tool];
      if (!def?.point) return;
      after(def.point(s.toolState, p, ctx()));
    },
    toolClick(world, shift) {
      const s = get();
      if (s.activeSheet) {
        s.say({ kind: 'info', text: t('This is a sheet. Switch to Model to draw; edit the views and the title block in the Sheets tab.') });
        return;
      }
      if (s.tool === 'select') {
        const id = s.pickAt(world);
        if (id) s.select([id], shift ? 'toggle' : 'set');
        else if (!shift) s.clearSelection();
        return;
      }
      const def = TOOLS[s.tool];
      if (!def) return;
      if (def.wantsEntity?.(s.toolState, ctx())) {
        const id = s.pickAt(world);
        if (!id) {
          get().say({ kind: 'info', text: t('Click on an entity.') });
          return;
        }
        if (def.entity) after(def.entity(s.toolState, id, world, ctx()));
        return;
      }
      const p = s.snap?.point ?? world;
      lastSnapUsed = s.snap;
      if (def.point) after(def.point(s.toolState, p, ctx()));
      lastSnapUsed = null;
    },
    toolText(text) {
      const s = get();
      const def = TOOLS[s.tool];
      if (!def) return;
      // A point or a relative point, unless the tool is reading free text.
      if (s.tool !== 'text' || !(s.toolState as { position: Vec2 | null } | null)?.position) {
        const rel = text.startsWith('@');
        const pt = parsePoint(rel ? text.slice(1) : text);
        if (pt && def.point) {
          const ref = def.reference?.(s.toolState, ctx()) ?? null;
          if (rel && !ref) {
            s.say({ kind: 'warn', text: t('A relative point (@dx,dy) needs a previous point.') });
            return;
          }
          after(def.point(s.toolState, rel && ref ? { x: ref.x + pt.x, y: ref.y + pt.y } : pt, ctx()));
          return;
        }
      }
      if (def.text) after(def.text(s.toolState, text, ctx()));
      else s.say({ kind: 'warn', text: t('This step expects a point.') });
    },
    toolEnter() {
      const s = get();
      const def = TOOLS[s.tool];
      if (!def) return;
      if (def.enter) after(def.enter(s.toolState, ctx()));
      else set({ tool: 'select', toolState: null });
    },
    prompt() {
      const s = get();
      const def = TOOLS[s.tool];
      if (!def) return t('Command (L line, C circle, M move, TR trim, U undo, ZE zoom extents)');
      return def.prompt(s.toolState, ctx());
    },
    toolPreview() {
      const s = get();
      const def = TOOLS[s.tool];
      if (!def?.preview) return [];
      return def.preview(s.toolState, s.snap?.point ?? s.cursor, ctx());
    },
    toolReference() {
      const s = get();
      const def = TOOLS[s.tool];
      return def?.reference?.(s.toolState, ctx()) ?? null;
    },
    toolWantsEntity() {
      const s = get();
      const def = TOOLS[s.tool];
      return def?.wantsEntity?.(s.toolState, ctx()) ?? false;
    },

    setView: (view) => set({ view }),
    setCanvasSize(size) {
      const prev = get().canvasSize;
      set({ canvasSize: size });
      if (prev.w === 0 && size.w > 0) get().zoomExtents();
    },
    zoomAt(screen, factor) {
      const v = get().view;
      const scale = Math.min(Math.max(v.scale * factor, 0.0005), 20_000);
      const k = scale / v.scale;
      set({ view: { scale, origin: { x: screen.x + (v.origin.x - screen.x) * k, y: screen.y + (v.origin.y - screen.y) * k } } });
    },
    panBy(dx, dy) {
      const v = get().view;
      set({ view: { ...v, origin: { x: v.origin.x + dx, y: v.origin.y + dy } } });
    },
    zoomExtents() {
      const s = get();
      const sheet = s.activeSheet ? s.editor.doc.sheets[s.activeSheet] : null;
      if (sheet) {
        const p = sheetPaper(sheet);
        set({ view: fitView({ min: { x: -5, y: -5 }, max: { x: p.width + 5, y: p.height + 5 } }, s.canvasSize) });
        return;
      }
      set({ view: fitView(documentBox(s.editor.doc), s.canvasSize) });
    },
    zoomTo(box) {
      set({ view: fitView(box, get().canvasSize) });
    },
    moveCursor(screen) {
      const s = get();
      if (!screen) {
        set({ cursor: null, snap: null, hover: null });
        return;
      }
      let world = screenToWorld(s.view, screen);
      if (s.activeSheet) {
        // Sheet mode: paper coordinates, no snaps or picking (views are edited in the Sheets tab).
        set({ cursor: world, snap: null, hover: null });
        return;
      }
      if (s.snapGrid) {
        const step = s.gridStep();
        world = { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step };
      }
      const def = TOOLS[s.tool];
      const drawing = s.tool !== 'select' && !(def?.wantsEntity?.(s.toolState, ctx()) ?? false);
      let snap: SnapResult | null = null;
      if (drawing) {
        const exclude = new Set(def?.exclude?.(s.toolState, ctx()) ?? []);
        snap = findSnap({ doc: s.editor.doc, index: s.index, cursor: world, tol: SNAP_PX / s.view.scale, settings: s.snaps, ref: def?.reference?.(s.toolState, ctx()) ?? null, exclude });
      }
      const hover = s.tool === 'select' || (def?.wantsEntity?.(s.toolState, ctx()) ?? false) ? s.pickAt(world) : null;
      set({ cursor: world, snap, hover });
    },
    toggleGrid: () => set({ gridOn: !get().gridOn }),
    toggleSnapGrid: () => set({ snapGrid: !get().snapGrid }),
    setSnaps: (patch) => set({ snaps: { ...get().snaps, ...patch } }),
    gridStep: () => gridStepFor(get().view.scale),
    visibleIds() {
      const s = get();
      if (s.canvasSize.w === 0) return s.editor.doc.entityOrder;
      const hit = new Set(s.index.query(viewBox(s.view, s.canvasSize)));
      if (hit.size === s.editor.doc.entityOrder.length) return s.editor.doc.entityOrder;
      return s.editor.doc.entityOrder.filter((id) => hit.has(id));
    },

    newDocument() {
      get().loadDocument(newDocument(t('Untitled')), null, t('New drawing'));
    },
    loadDocument(doc, path, label) {
      const { editor } = get();
      // Opening is a command too, so it is undoable (product rule 4). A fresh, untouched document
      // starts a clean history instead.
      if (editor.history.undo.length === 0 && !editor.dirty) setEditor(editorState(doc));
      else {
        const r = execute(editor, { kind: 'replaceDocument', doc });
        if (!r.ok) return;
        setEditor(path ? markSaved(r.state) : r.state);
      }
      set({ filePath: path, selection: [], tool: 'select', toolState: null, activeSheet: null, activePart: null, build: null, section: null, measure: false, measurePoints: [], diagnosis: null, freedom: {}, message: { kind: 'info', text: label } });
      get().zoomExtents();
      queueMicrotask(() => void get().solveNow());
    },
    async openFile(path) {
      const r = await api().files.open(path);
      if (!r.ok) {
        get().say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      if (!r.value) return;
      if (/\.dxf$/i.test(r.value.path)) {
        await importDxfText(get, r.value.text, r.value.path);
        return;
      }
      const p = parse(r.value.text);
      if (!p.ok) {
        get().say({ kind: 'error', text: p.error.message, hint: p.error.hint });
        return;
      }
      get().loadDocument(p.doc, r.value.path, p.migratedFrom !== undefined ? t('Opened {name} (upgraded from format {v})', { name: p.doc.name, v: p.migratedFrom }) : t('Opened {name}', { name: p.doc.name }));
      set({ settings: await api().settings.get() });
    },
    async saveFile(saveAs = false) {
      const { editor, filePath } = get();
      const r = await api().files.save(saveAs ? null : filePath, serialize(editor.doc), editor.doc.name);
      if (!r.ok) {
        get().say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      if (!r.value) return;
      set({ editor: markSaved(get().editor), filePath: r.value.path, message: { kind: 'info', text: t('Saved {path}', { path: r.value.path }) }, settings: await api().settings.get() });
      void api().files.clearAutosave();
    },
    async openSample(id) {
      const r = await api().samples.read(id);
      if (!r.ok) {
        get().say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      const p = parse(r.value);
      if (!p.ok) {
        get().say({ kind: 'error', text: p.error.message, hint: p.error.hint });
        return;
      }
      get().loadDocument(p.doc, null, t('Opened sample {name}', { name: p.doc.name }));
    },
    async importDxf() {
      const r = await api().files.openDxf();
      if (!r.ok) {
        get().say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      if (!r.value) return;
      await importDxfText(get, r.value.text, r.value.path);
    },
    async exportDxf(version) {
      const s = get();
      const { writeDxf, dxfExportNotes } = await import('@shared/dxf');
      const notes = dxfExportNotes(s.editor.doc, version);
      const r = await api().files.saveDxf(writeDxf(s.editor.doc, { version }), s.editor.doc.name);
      if (!r.ok) {
        s.say({ kind: 'error', text: r.error.message, hint: r.error.hint });
        return;
      }
      if (!r.value) return;
      s.say({ kind: notes.length ? 'warn' : 'info', text: t('Exported {path} (DXF {v}).', { path: r.value.path, v: version }), hint: notes.map((n) => n.message).join(' ') });
    },
    async autosave() {
      const s = get();
      if (!s.editor.dirty) return;
      await api().files.autosave(serialize(s.editor.doc), s.filePath);
    },
    async recover() {
      const rec = get().recovery;
      if (!rec) return;
      const r = await api().files.readAutosave();
      set({ recovery: null });
      if (!r.ok || !r.value) return;
      const p = parse(r.value.text);
      if (!p.ok) {
        get().say({ kind: 'error', text: p.error.message, hint: p.error.hint });
        return;
      }
      get().loadDocument(p.doc, r.value.originalPath, t('Recovered {name} from the autosave. Save it to keep it.', { name: p.doc.name }));
      set({ editor: { ...get().editor, dirty: true } });
    },
    async dismissRecovery() {
      set({ recovery: null });
      await api().files.clearAutosave();
    },

    async init() {
      const [settings, samples, version, rec] = await Promise.all([api().settings.get(), api().samples.list(), api().app.version(), api().files.autosaveInfo()]);
      applyTheme(settings);
      set({ settings, samples, version, recovery: rec });
      // Fresh start: the untitled document gets its translated name.
      if (!get().editor.dirty && get().editor.history.undo.length === 0) setEditor(editorState(newDocument(t('Untitled'))));
      // #sample=<id> opens a sample at start (screenshots, demos, tests).
      const sample = /[#&]sample=([\w-]+)/.exec(window.location.hash)?.[1];
      if (sample) await get().openSample(sample);
      // #sheet=1 shows the first sheet (screenshots and tests).
      const sheetNo = Number(/[#&]sheet=(\d+)/.exec(window.location.hash)?.[1] ?? 0);
      const sheetId = get().editor.doc.sheetOrder[sheetNo - 1];
      if (sheetId) get().setActiveSheet(sheetId);
      setInterval(() => void get().autosave(), 20_000);
    },
    async updateSettings(patch) {
      const settings = await api().settings.set(patch);
      applyTheme(settings);
      set({ settings });
    },

    say: (message) => set({ message }),

    runCommandLine(text) {
      const s = get();
      const raw = text.trim();
      if (!raw) {
        if (s.tool !== 'select') s.toolEnter();
        return;
      }
      const upper = raw.toUpperCase();
      // While a tool runs, everything goes to it first, except the universal commands.
      if (s.tool !== 'select' && !['U', 'UNDO', 'REDO', 'ESC', 'CANCEL', 'ZE'].includes(upper)) {
        s.toolText(raw);
        return;
      }
      const alias = ALIASES[upper];
      if (alias) {
        s.setTool(alias);
        return;
      }
      switch (upper) {
        case 'U':
        case 'UNDO':
          return s.undo();
        case 'REDO':
          return s.redo();
        case 'E':
        case 'ERASE':
        case 'DEL':
        case 'DELETE':
          return s.deleteSelection();
        case 'ZE':
        case 'ZOOM E':
        case 'ZOOM EXTENTS':
          return s.zoomExtents();
        case 'ZW':
        case 'ZOOM W':
          if (s.selection.length) {
            let box: Box | null = null;
            for (const id of s.selection) {
              const b = entityBox(s.editor.doc.entities[id]);
              box = box ? { min: { x: Math.min(box.min.x, b.min.x), y: Math.min(box.min.y, b.min.y) }, max: { x: Math.max(box.max.x, b.max.x), y: Math.max(box.max.y, b.max.y) } } : b;
            }
            if (box) s.zoomTo(box);
          }
          return;
        case 'GRID':
          return s.toggleGrid();
        case 'SNAP':
          return s.toggleSnapGrid();
        case 'OSNAP': {
          const on = !s.snaps.end;
          s.setSnaps({ end: on, mid: on, center: on, quadrant: on, intersection: on, perpendicular: on, tangent: on });
          s.say({ kind: 'info', text: on ? t('Object snaps on.') : t('Object snaps off.') });
          return;
        }
        case 'ESC':
        case 'CANCEL':
          return s.cancelTool();
        case 'SA':
        case 'SELECT ALL':
          return s.select(s.editor.doc.entityOrder);
        case 'PART':
          return s.setActivePart(s.addPart());
        case 'REBUILD':
          return void s.rebuild();
        case 'STEP':
        case 'IMPORT STEP':
          return void s.importStepFile();
        case 'EXPORT STEP':
          return void s.exportPart('step');
        case 'EXPORT STL':
          return void s.exportPart('stl');
        case 'EXPORT 3MF':
          return void s.exportPart('3mf');
        case 'MEASURE':
          return s.toggleMeasure();
        default: {
          if (s.runPartCommand(upper)) return;
          const n = parseLength(raw);
          if (n !== null) {
            s.say({ kind: 'info', text: t('Start a tool first (for example L, C or O), then type values.') });
            return;
          }
          s.say({ kind: 'warn', text: t('Unknown command "{cmd}".', { cmd: raw }), hint: t('Try L, PL, REC, C, A, EL, SPL, T (draw); M, CO, RO, SC, MI, O, TR, EX, F, CHA, AR (edit); SKETCH, EXTRUDE, REVOLVE, HOLE, FILLET, CHAMFER, SHELL (3D); U, E, ZE, GRID, SNAP, OSNAP.') });
        }
      }
    },

    /** 3D commands with arguments: SKETCH [XY|XZ|YZ] [offset], EXTRUDE <mm> [CUT|BOTH], REVOLVE [deg], HOLE <M6|6.6> [depth], FILLET <r>, CHAMFER <d>, SHELL <t>, MIRROR3D [XY|XZ|YZ] [offset], PATTERN <nx> <ny> <dx> <dy> | PATTERN C <n> [axis]. */
    runPartCommand(upper: string): boolean {
      const s = get();
      const [cmd, ...args] = upper.split(/\s+/);
      const num = (i: number, fallback: number | null = null): number | null => {
        const v = args[i] === undefined ? null : parseLength(args[i]);
        return v === null ? fallback : v;
      };
      const plane = (i: number): SketchPlane | null => (args[i] === 'XY' || args[i] === 'XZ' || args[i] === 'YZ' ? args[i] : null);
      const needPart = (): Part | null => {
        const doc = s.editor.doc;
        const id = s.activePart ?? doc.partOrder[doc.partOrder.length - 1];
        const part = id ? doc.parts[id] : null;
        if (!part) s.say({ kind: 'warn', text: t('No part yet. Select a closed outline in Model and type SKETCH first.') });
        return part;
      };
      const lastSketch = (part: Part): Id | null => {
        const sk = part.features.filter((f) => f.kind === 'sketch');
        if (!sk.length) s.say({ kind: 'warn', text: t('Add a sketch first: select a closed outline in Model and type SKETCH.') });
        return sk.length ? sk[sk.length - 1].id : null;
      };
      const count = (part: Part, kind: Feature['kind']) => part.features.filter((f) => f.kind === kind).length + 1;
      const done = (part: Part, f: Feature) => {
        s.addFeature(part.id, f);
        if (s.activePart !== part.id) s.setActivePart(part.id);
        s.say({ kind: 'info', text: t('{name} added. Change its values in the Features tab; U undoes it.', { name: f.name }) });
        return true;
      };
      switch (cmd) {
        case 'SKETCH': {
          const p = plane(0) ?? 'XY';
          s.makeSketch(p, num(plane(0) ? 1 : 0, 0) ?? 0);
          return true;
        }
        case 'EXTRUDE':
        case 'EXT': {
          const part = needPart();
          if (!part) return true;
          const sk = lastSketch(part);
          if (!sk) return true;
          const d = num(0);
          if (d === null || d <= 0) {
            s.say({ kind: 'warn', text: t('EXTRUDE needs a distance in mm, for example EXTRUDE 10 or EXTRUDE 5 CUT.') });
            return true;
          }
          const cut = args.includes('CUT');
          return done(part, { id: randomId(), name: t('Extrude {n}', { n: count(part, 'extrude') }), kind: 'extrude', sketch: sk, distance: d, direction: args.includes('BOTH') ? 'both' : args.includes('REVERSE') ? 'reverse' : 'normal', op: cut ? 'cut' : 'add' });
        }
        case 'REVOLVE':
        case 'REV': {
          const part = needPart();
          if (!part) return true;
          const sk = lastSketch(part);
          if (!sk) return true;
          const angle = num(0, 360) ?? 360;
          return done(part, { id: randomId(), name: t('Revolve {n}', { n: count(part, 'revolve') }), kind: 'revolve', sketch: sk, axis: { a: { x: 0, y: 0 }, b: { x: 0, y: 1 } }, angle, op: args.includes('CUT') ? 'cut' : 'add' });
        }
        case 'HOLE': {
          const part = needPart();
          if (!part) return true;
          const sk = lastSketch(part);
          if (!sk) return true;
          const a0 = args[0] ?? '';
          let spec: HoleSpec;
          if (/^M\d+(\.\d+)?$/.test(a0)) spec = args.includes('TAP') ? { kind: 'tapped', thread: a0 } : { kind: 'clearance', thread: a0, series: args.includes('FINE') ? 'fine' : args.includes('COARSE') ? 'coarse' : 'medium' };
          else {
            const d = parseLength(a0);
            if (d === null || d <= 0) {
              s.say({ kind: 'warn', text: t('HOLE needs a thread or a diameter: HOLE M6, HOLE M8 TAP, HOLE 6.6 [depth].') });
              return true;
            }
            spec = { kind: 'simple', diameter: d };
          }
          const depth = args.slice(1).map((a) => parseLength(a)).find((v): v is number => v !== null && v > 0);
          return done(part, { id: randomId(), name: t('Hole {n}', { n: count(part, 'hole') }), kind: 'hole', sketch: sk, spec, depth: depth ?? 'through' });
        }
        case 'FILLET3D':
        case 'FILLET': {
          const part = needPart();
          if (!part) return true;
          const r = num(0);
          if (r === null || r <= 0) {
            s.say({ kind: 'warn', text: t('FILLET needs a radius in mm, for example FILLET 2.') });
            return true;
          }
          return done(part, { id: randomId(), name: t('Fillet {n}', { n: count(part, 'fillet') }), kind: 'fillet', edges: { kind: 'all' }, radius: r });
        }
        case 'CHAMFER3D':
        case 'CHAMFER': {
          const part = needPart();
          if (!part) return true;
          const d = num(0);
          if (d === null || d <= 0) {
            s.say({ kind: 'warn', text: t('CHAMFER needs a distance in mm, for example CHAMFER 1.') });
            return true;
          }
          return done(part, { id: randomId(), name: t('Chamfer {n}', { n: count(part, 'chamfer') }), kind: 'chamfer', edges: { kind: 'all' }, distance: d });
        }
        case 'SHELL': {
          const part = needPart();
          if (!part) return true;
          const th = num(0);
          if (th === null || th <= 0) {
            s.say({ kind: 'warn', text: t('SHELL needs a wall thickness in mm, for example SHELL 2.') });
            return true;
          }
          return done(part, { id: randomId(), name: t('Shell {n}', { n: count(part, 'shell') }), kind: 'shell', thickness: th, faces: [{ kind: 'normal', direction: 'Z+' }] });
        }
        case 'MIRROR3D': {
          const part = needPart();
          if (!part) return true;
          return done(part, { id: randomId(), name: t('Mirror {n}', { n: count(part, 'mirror') }), kind: 'mirror', plane: plane(0) ?? 'YZ', offset: num(plane(0) ? 1 : 0, 0) ?? 0 });
        }
        case 'PATTERN': {
          const part = needPart();
          if (!part) return true;
          if (args[0] === 'C') {
            const n = num(1, 6) ?? 6;
            const axis = args[2] === 'X' || args[2] === 'Y' || args[2] === 'Z' ? args[2] : 'Z';
            return done(part, { id: randomId(), name: t('Pattern {n}', { n: count(part, 'pattern') }), kind: 'pattern', mode: 'circular', axis, count: Math.max(1, Math.round(n)), angle: 360 });
          }
          const nx = num(0, 2) ?? 2;
          const ny = num(1, 1) ?? 1;
          return done(part, { id: randomId(), name: t('Pattern {n}', { n: count(part, 'pattern') }), kind: 'pattern', mode: 'linear', counts: [Math.max(1, Math.round(nx)), Math.max(1, Math.round(ny))], spacing: [num(2, 20) ?? 20, num(3, 20) ?? 20], axes: ['X', 'Y'] });
        }
        default:
          return false;
      }
    },
  };
});

async function importDxfText(get: () => Store, text: string, path: string): Promise<void> {
  const { readDxf } = await import('@shared/dxf');
  const r = readDxf(text, { name: path.replace(/^.*[\\/]/, '').replace(/\.dxf$/i, '') });
  if (!r.ok) {
    get().say({ kind: 'error', text: r.error.message, hint: r.error.hint });
    return;
  }
  const s = get();
  const label = r.warnings.length ? t('Imported {name} with {n} notes.', { name: r.doc.name, n: r.warnings.length }) : t('Imported {name}.', { name: r.doc.name });
  s.loadDocument(r.doc, null, label);
  if (r.warnings.length) s.say({ kind: 'warn', text: label, hint: r.warnings.map((w) => w.message).join(' ') });
}

export function toolName(tool: ToolId): string {
  switch (tool) {
    case 'select':
      return t('Select');
    case 'line':
      return t('Line');
    case 'polyline':
      return t('Polyline');
    case 'rect':
      return t('Rectangle');
    case 'circle':
      return t('Circle');
    case 'arc':
      return t('Arc');
    case 'ellipse':
      return t('Ellipse');
    case 'spline':
      return t('Spline');
    case 'text':
      return t('Text');
    case 'move':
      return t('Move');
    case 'copy':
      return t('Copy');
    case 'rotate':
      return t('Rotate');
    case 'scale':
      return t('Scale');
    case 'mirror':
      return t('Mirror');
    case 'offset':
      return t('Offset');
    case 'trim':
      return t('Trim');
    case 'extend':
      return t('Extend');
    case 'fillet':
      return t('Fillet');
    case 'chamfer':
      return t('Chamfer');
    case 'array':
      return t('Array');
    case 'dim-linear':
      return t('Linear dimension');
    case 'dim-aligned':
      return t('Aligned dimension');
    case 'dim-angular':
      return t('Angular dimension');
    case 'dim-radius':
      return t('Radius dimension');
    case 'dim-diameter':
      return t('Diameter dimension');
    case 'dim-ordinate':
      return t('Ordinate dimension');
    case 'note':
      return t('Note with leader');
    case 'balloon':
      return t('Balloon');
    case 'surface':
      return t('Surface texture');
    case 'gdt':
      return t('Geometrical tolerance');
    case 'datum':
      return t('Datum');
    case 'c-coincident':
      return t('Coincident');
    case 'c-point-on-line':
      return t('Point on line');
    case 'c-horizontal':
      return t('Horizontal');
    case 'c-vertical':
      return t('Vertical');
    case 'c-parallel':
      return t('Parallel');
    case 'c-perpendicular':
      return t('Perpendicular');
    case 'c-tangent':
      return t('Tangent');
    case 'c-equal':
      return t('Equal');
    case 'c-symmetric':
      return t('Symmetric');
    case 'c-fixed':
      return t('Fix');
    case 'c-distance':
      return t('Distance constraint');
    case 'c-angle':
      return t('Angle constraint');
    case 'c-radius':
      return t('Radius constraint');
  }
}
