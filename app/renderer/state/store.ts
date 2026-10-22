// The renderer's one store. The document is only ever changed through run(command): undo, autosave,
// scripting and AI share that path (CLAUDE.md, Architecture).

import { create } from 'zustand';
import type { Command } from '@shared/commands';
import { canRedo, canUndo, editorState, execute, markSaved, redo as redoState, undo as undoState, type EditorState } from '@shared/commands/history';
import { documentBox, newDocument, pick } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import type { Document, Entity, Id } from '@shared/doc/types';
import { dist, type Vec2 } from '@shared/geometry/vec2';
import { randomId } from '@shared/ids';
import { setLanguage, t } from '@shared/i18n';
import { DEFAULT_SETTINGS, type SampleInfo, type Settings } from '@shared/api';
import { parseLength, parsePoint } from '@shared/units';

export type ToolId = 'select' | 'line' | 'circle' | 'arc' | 'rect' | 'polyline' | 'dimension' | 'text';
/** Tools that work in M0; the others announce their milestone. */
export const READY_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'line', 'circle']);

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

export interface Store {
  editor: EditorState;
  filePath: string | null;
  selection: Id[];
  view: ViewState;
  canvasSize: Size;
  cursor: Vec2 | null;
  gridOn: boolean;
  snapGrid: boolean;
  tool: ToolId;
  toolPoints: Vec2[];
  settings: Settings;
  samples: SampleInfo[];
  message: Message | null;
  version: string;

  run(cmd: Command): boolean;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  select(ids: Id[], mode?: 'set' | 'toggle' | 'add'): void;
  clearSelection(): void;
  deleteSelection(): void;
  pickAt(world: Vec2): Id | null;

  setTool(tool: ToolId): void;
  cancelTool(): void;
  /** A point from the canvas or the command line, in mm. */
  addToolPoint(p: Vec2): void;
  /** What the command line should ask for right now. */
  prompt(): string;

  setView(view: ViewState): void;
  setCanvasSize(size: Size): void;
  zoomAt(screen: Vec2, factor: number): void;
  panBy(dx: number, dy: number): void;
  zoomExtents(): void;
  setCursor(p: Vec2 | null): void;
  toggleGrid(): void;
  toggleSnapGrid(): void;
  /** Grid step in mm for the current zoom (the minor grid line spacing). */
  gridStep(): number;
  snap(p: Vec2): Vec2;

  newDocument(): void;
  openFile(path?: string): Promise<void>;
  saveFile(saveAs?: boolean): Promise<void>;
  openSample(id: string): Promise<void>;
  loadDocument(doc: Document, path: string | null, label: string): void;

  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  say(message: Message | null): void;
  runCommandLine(text: string): void;
}

const FIT_PADDING = 40;

function fitView(doc: Document, size: Size): ViewState {
  const box = documentBox(doc);
  if (!box || size.w === 0 || size.h === 0) return { scale: 4, origin: { x: size.w / 2 || 400, y: size.h / 2 || 300 } };
  const w = Math.max(box.max.x - box.min.x, 1e-6);
  const h = Math.max(box.max.y - box.min.y, 1e-6);
  const scale = Math.min((size.w - 2 * FIT_PADDING) / w, (size.h - 2 * FIT_PADDING) / h);
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

export const useStore = create<Store>((set, get) => ({
  editor: editorState(newDocument(t('Untitled'))),
  filePath: null,
  selection: [],
  view: { scale: 4, origin: { x: 400, y: 300 } },
  canvasSize: { w: 0, h: 0 },
  cursor: null,
  gridOn: true,
  snapGrid: false,
  tool: 'select',
  toolPoints: [],
  settings: DEFAULT_SETTINGS,
  samples: [],
  message: null,
  version: '',

  run(cmd) {
    const r = execute(get().editor, cmd);
    if (!r.ok) {
      set({ message: { kind: 'error', text: r.error.message, hint: r.error.hint } });
      return false;
    }
    const ids = new Set(Object.keys(r.state.doc.entities));
    set({ editor: r.state, selection: get().selection.filter((id) => ids.has(id)) });
    return true;
  },
  undo() {
    const s = undoState(get().editor);
    if (!s) return;
    const ids = new Set(Object.keys(s.doc.entities));
    set({ editor: s, selection: get().selection.filter((id) => ids.has(id)), message: { kind: 'info', text: t('Undo') } });
  },
  redo() {
    const s = redoState(get().editor);
    if (!s) return;
    const ids = new Set(Object.keys(s.doc.entities));
    set({ editor: s, selection: get().selection.filter((id) => ids.has(id)), message: { kind: 'info', text: t('Redo') } });
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
    const tol = 6 / get().view.scale;
    return pick(get().editor.doc, world, tol);
  },

  setTool(tool) {
    if (!READY_TOOLS.has(tool)) {
      set({ tool: 'select', toolPoints: [], message: { kind: 'info', text: t('{tool} arrives in a later milestone. Line and circle work now.', { tool: toolName(tool) }) } });
      return;
    }
    set({ tool, toolPoints: [], message: null });
  },
  cancelTool() {
    const { tool, toolPoints } = get();
    if (tool === 'select' && toolPoints.length === 0) set({ selection: [] });
    set({ tool: 'select', toolPoints: [], message: null });
  },
  addToolPoint(p) {
    const { tool, toolPoints, editor } = get();
    const layer = editor.doc.activeLayer;
    if (tool === 'line') {
      if (toolPoints.length === 0) {
        set({ toolPoints: [p] });
        return;
      }
      const a = toolPoints[toolPoints.length - 1];
      if (dist(a, p) === 0) {
        get().say({ kind: 'warn', text: t('The two points are the same; pick another point.') });
        return;
      }
      const e: Entity = { id: randomId(), type: 'line', layer, a, b: p };
      if (get().run({ kind: 'addEntities', entities: [e] })) set({ toolPoints: [p] });
      return;
    }
    if (tool === 'circle') {
      if (toolPoints.length === 0) {
        set({ toolPoints: [p] });
        return;
      }
      const r = dist(toolPoints[0], p);
      if (r === 0) {
        get().say({ kind: 'warn', text: t('A circle needs a radius greater than zero.') });
        return;
      }
      const e: Entity = { id: randomId(), type: 'circle', layer, center: toolPoints[0], radius: r };
      if (get().run({ kind: 'addEntities', entities: [e] })) set({ toolPoints: [] });
    }
  },
  prompt() {
    const { tool, toolPoints } = get();
    if (tool === 'line') return toolPoints.length === 0 ? t('Line: first point') : t('Line: next point (Esc to finish)');
    if (tool === 'circle') return toolPoints.length === 0 ? t('Circle: centre') : t('Circle: radius or a point on the circle');
    return t('Command (L line, C circle, U undo, ZE zoom extents)');
  },

  setView: (view) => set({ view }),
  setCanvasSize(size) {
    const prev = get().canvasSize;
    set({ canvasSize: size });
    if (prev.w === 0 && size.w > 0) get().zoomExtents();
  },
  zoomAt(screen, factor) {
    const v = get().view;
    const scale = Math.min(Math.max(v.scale * factor, 0.001), 10_000);
    const k = scale / v.scale;
    set({ view: { scale, origin: { x: screen.x + (v.origin.x - screen.x) * k, y: screen.y + (v.origin.y - screen.y) * k } } });
  },
  panBy(dx, dy) {
    const v = get().view;
    set({ view: { ...v, origin: { x: v.origin.x + dx, y: v.origin.y + dy } } });
  },
  zoomExtents() {
    set({ view: fitView(get().editor.doc, get().canvasSize) });
  },
  setCursor: (cursor) => set({ cursor }),
  toggleGrid: () => set({ gridOn: !get().gridOn }),
  toggleSnapGrid: () => set({ snapGrid: !get().snapGrid }),
  gridStep: () => gridStepFor(get().view.scale),
  snap(p) {
    if (!get().snapGrid) return p;
    const s = get().gridStep();
    return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
  },

  newDocument() {
    get().loadDocument(newDocument(t('Untitled')), null, t('New drawing'));
  },
  loadDocument(doc, path, label) {
    const { editor } = get();
    // Opening is a command too, so it is undoable (product rule 4). A fresh, untouched document
    // starts a clean history instead.
    if (editor.history.undo.length === 0 && !editor.dirty) set({ editor: editorState(doc) });
    else {
      const r = execute(editor, { kind: 'replaceDocument', doc });
      if (!r.ok) return;
      set({ editor: path ? markSaved(r.state) : r.state });
    }
    set({ filePath: path, selection: [], tool: 'select', toolPoints: [], message: { kind: 'info', text: label } });
    get().zoomExtents();
  },
  async openFile(path) {
    const r = await api().files.open(path);
    if (!r.ok) {
      get().say({ kind: 'error', text: r.error.message, hint: r.error.hint });
      return;
    }
    if (!r.value) return;
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

  async init() {
    const [settings, samples, version] = await Promise.all([api().settings.get(), api().samples.list(), api().app.version()]);
    applyTheme(settings);
    set({ settings, samples, version });
    // Fresh start: the untitled document gets its translated name.
    if (!get().editor.dirty && get().editor.history.undo.length === 0) set({ editor: editorState(newDocument(t('Untitled'))) });
    // #sample=<id> opens a sample at start (screenshots, demos, tests).
    const sample = /[#&]sample=([\w-]+)/.exec(window.location.hash)?.[1];
    if (sample) await get().openSample(sample);
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
      // Enter on an empty line: finish the current tool, like AutoCAD.
      if (s.tool !== 'select') s.cancelTool();
      return;
    }
    const upper = raw.toUpperCase();
    // A point or a number while a tool is waiting for one.
    if (s.tool !== 'select') {
      const rel = raw.startsWith('@');
      const pt = parsePoint(rel ? raw.slice(1) : raw);
      if (pt) {
        const last = s.toolPoints[s.toolPoints.length - 1];
        if (rel && !last) {
          s.say({ kind: 'warn', text: t('A relative point (@dx,dy) needs a previous point.') });
          return;
        }
        s.addToolPoint(rel && last ? { x: last.x + pt.x, y: last.y + pt.y } : pt);
        return;
      }
      if (s.tool === 'circle' && s.toolPoints.length === 1) {
        const r = parseLength(raw);
        if (r !== null) {
          s.addToolPoint({ x: s.toolPoints[0].x + r, y: s.toolPoints[0].y });
          return;
        }
      }
    }
    switch (upper) {
      case 'L':
      case 'LINE':
        return s.setTool('line');
      case 'C':
      case 'CIRCLE':
        return s.setTool('circle');
      case 'A':
      case 'ARC':
        return s.setTool('arc');
      case 'REC':
      case 'RECTANGLE':
        return s.setTool('rect');
      case 'PL':
      case 'POLYLINE':
        return s.setTool('polyline');
      case 'D':
      case 'DIM':
      case 'DIMENSION':
        return s.setTool('dimension');
      case 'T':
      case 'TEXT':
        return s.setTool('text');
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
      case 'GRID':
        return s.toggleGrid();
      case 'SNAP':
        return s.toggleSnapGrid();
      case 'ESC':
      case 'CANCEL':
        return s.cancelTool();
      default:
        s.say({ kind: 'warn', text: t('Unknown command "{cmd}".', { cmd: raw }), hint: t('Try L (line), C (circle), U (undo), E (erase), ZE (zoom extents), GRID, SNAP.') });
    }
  },
}));

export function toolName(tool: ToolId): string {
  switch (tool) {
    case 'select':
      return t('Select');
    case 'line':
      return t('Line');
    case 'circle':
      return t('Circle');
    case 'arc':
      return t('Arc');
    case 'rect':
      return t('Rectangle');
    case 'polyline':
      return t('Polyline');
    case 'dimension':
      return t('Dimension');
    case 'text':
      return t('Text');
  }
}
