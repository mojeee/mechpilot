// The renderer's one store. The document is only ever changed through run(command): undo, autosave,
// scripting and AI share that path (CLAUDE.md, Architecture). Tools (app/renderer/tools) are state
// machines the store drives with points, text, entity picks and Enter.

import { create } from 'zustand';
import type { Command } from '@shared/commands';
import { canRedo, canUndo, editorState, execute, markSaved, redo as redoState, undo as undoState, type EditorState } from '@shared/commands/history';
import { documentBox, entityBox, pick } from '@shared/doc/document';
import { newDocument } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import type { Document, Entity, Id } from '@shared/doc/types';
import { type Box, type Vec2 } from '@shared/geometry/vec2';
import { randomId } from '@shared/ids';
import { setLanguage, t } from '@shared/i18n';
import { DEFAULT_SETTINGS, type SampleInfo, type Settings } from '@shared/api';
import { contains, overlaps, SpatialIndex } from '@shared/spatial/index';
import { parseLength, parsePoint } from '@shared/units';
import { DEFAULT_SNAPS, findSnap, type SnapResult, type SnapSettings } from '../snap';
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

export const useStore = create<Store>((set, get) => {
  const ctx = (): ToolCtx => {
    const s = get();
    return {
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
    set({ editor, index: s.editor.doc === editor.doc ? s.index : buildIndex(editor.doc), selection: s.selection.filter((id) => ids.has(id)), hover: s.hover && ids.has(s.hover) ? s.hover : null, ...extra });
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

    run(cmd) {
      const r = execute(get().editor, cmd);
      if (!r.ok) {
        set({ message: { kind: 'error', text: r.error.message, hint: r.error.hint } });
        return false;
      }
      setEditor(r.state);
      return true;
    },
    undo() {
      const s = undoState(get().editor);
      if (!s) return;
      setEditor(s, { message: { kind: 'info', text: t('Undo') } });
    },
    redo() {
      const s = redoState(get().editor);
      if (!s) return;
      setEditor(s, { message: { kind: 'info', text: t('Redo') } });
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
      if (def.point) after(def.point(s.toolState, p, ctx()));
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
      set({ view: fitView(documentBox(get().editor.doc), get().canvasSize) });
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
      set({ filePath: path, selection: [], tool: 'select', toolState: null, message: { kind: 'info', text: label } });
      get().zoomExtents();
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
        default: {
          const n = parseLength(raw);
          if (n !== null) {
            s.say({ kind: 'info', text: t('Start a tool first (for example L, C or O), then type values.') });
            return;
          }
          s.say({ kind: 'warn', text: t('Unknown command "{cmd}".', { cmd: raw }), hint: t('Try L, PL, REC, C, A, EL, SPL, T (draw); M, CO, RO, SC, MI, O, TR, EX, F, CHA, AR (edit); U, E, ZE, GRID, SNAP, OSNAP.') });
        }
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
  }
}
