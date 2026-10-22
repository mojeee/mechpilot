// The drawing canvas: pointer input (pick, window selection, draw, pan, zoom) and a redraw on
// every state change, at most once per frame. The static scene (grid + entities) is rendered into
// an offscreen bitmap; while the view moves and a full render is expensive, that bitmap is blitted
// with the delta transform and the full render runs again once the view settles. That keeps pan
// and zoom at the display rate with 100,000 entities (product rule 8).

import { useEffect, useRef } from 'react';
import type { Vec2 } from '@shared/geometry/vec2';
import { readPalette, renderBase, renderOverlay, renderSheetBase, type Scene } from '../canvas/render';
import { screenToWorld, useStore, type ViewState } from '../state/store';

interface Cache {
  canvas: HTMLCanvasElement;
  view: ViewState;
  size: { w: number; h: number };
  dpr: number;
  /** What the bitmap was rendered from; any change forces a full render. */
  key: unknown[];
  /** How long the full render took, ms. */
  ms: number;
}

/** Above this cost per full render, view changes are blitted and re-rendered after a short idle. */
const BLIT_THRESHOLD_MS = 10;
const IDLE_MS = 120;

/** The ids in view as a Set, computed at most once per store state. */
let visibleCache: { state: unknown; set: Set<string> } | null = null;
function visibleSet(s: ReturnType<typeof useStore.getState>): Set<string> {
  if (!visibleCache || visibleCache.state !== s) visibleCache = { state: s, set: new Set(s.visibleIds()) };
  return visibleCache.set;
}

/** Render counters for the performance tests and the developer console (window.__mpPerf). */
export const perf = { full: 0, fullMs: 0, blit: 0, blitMs: 0, overlayMs: 0, frames: 0 };
Object.defineProperty(window, '__mpPerf', { get: () => perf });

export function Canvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const press = useRef<{ screen: Vec2; world: Vec2; shift: boolean; boxing: boolean } | null>(null);

  // Size follows the container; the store learns it for zoom-extents.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      useStore.getState().setCanvasSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Redraw on the next frame whenever anything in the store changes (one draw per frame at most).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let cache: Cache | null = null;
    let idle: ReturnType<typeof setTimeout> | null = null;
    let themeTick = 0;
    const draw = () => {
      raf = 0;
      const s = useStore.getState();
      const ctx = canvas.getContext('2d');
      if (!ctx || s.canvasSize.w === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(s.canvasSize.w * dpr);
      const h = Math.round(s.canvasSize.h * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const palette = readPalette(canvas);
      const sheet = s.activeSheet ? (s.editor.doc.sheets[s.activeSheet] ?? null) : null;
      const scene: Scene = {
        doc: s.editor.doc,
        view: s.view,
        size: s.canvasSize,
        dpr,
        visible: [],
        selection: new Set(s.selection),
        // A big selection (select all on a huge drawing) is culled to the view; a normal one is drawn as is.
        selected: s.selection.length > 2000 ? s.selection.filter((id) => visibleSet(s).has(id)) : s.selection,
        hover: s.hover,
        gridOn: s.gridOn,
        gridStep: s.gridStep(),
        cursor: s.cursor,
        preview: s.toolPreview(),
        snap: s.snap,
        tracking: s.snap?.tracking ?? null,
        selectBox: s.selectBox ? { ...s.selectBox, crossing: s.selectBox.b.x < s.selectBox.a.x } : null,
        palette: readPalette(canvas),
        freedom: s.freedom,
        showConstraints: !sheet && s.editor.doc.constraintOrder.length > 0,
      };
      // The constraint overlay needs the visible ids (sketches are small; the set is memoized per state).
      if (scene.showConstraints) scene.visible = [...visibleSet(s)];
      const key = [s.editor.doc, s.gridOn, themeTick, s.canvasSize.w, s.canvasSize.h, dpr, s.activeSheet, s.settings.lang];
      const sameKey = cache !== null && key.every((k, i) => k === cache!.key[i]);
      const sameView = cache !== null && cache.view.scale === s.view.scale && cache.view.origin.x === s.view.origin.x && cache.view.origin.y === s.view.origin.y;
      const canBlit = sameKey && !sameView && cache!.ms > BLIT_THRESHOLD_MS;

      perf.frames++;
      if (sameKey && sameView) {
        // Only overlays changed.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(cache!.canvas, 0, 0);
      } else if (canBlit) {
        // Blit the last full render with the delta transform; re-render when the view settles.
        const tb = performance.now();
        const c = cache!;
        const k = s.view.scale / c.view.scale;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = palette.background;
        ctx.fillRect(0, 0, w, h);
        ctx.setTransform(k, 0, 0, k, (s.view.origin.x - c.view.origin.x * k) * dpr, (s.view.origin.y - c.view.origin.y * k) * dpr);
        ctx.drawImage(c.canvas, 0, 0);
        perf.blit++;
        perf.blitMs += performance.now() - tb;
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => {
          idle = null;
          cache = null;
          schedule();
        }, IDLE_MS);
      } else {
        // Full render into the cache bitmap, then onto the screen.
        const off = cache?.canvas ?? document.createElement('canvas');
        if (off.width !== w || off.height !== h) {
          off.width = w;
          off.height = h;
        }
        const octx = off.getContext('2d')!;
        const t0 = performance.now();
        if (sheet) renderSheetBase(octx, scene, sheet, s.settings.lang);
        else {
          scene.visible = s.visibleIds();
          renderBase(octx, scene);
        }
        const ms = performance.now() - t0;
        perf.full++;
        perf.fullMs += ms;
        cache = { canvas: off, view: s.view, size: s.canvasSize, dpr, key, ms };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, 0, 0);
      }
      const to = performance.now();
      renderOverlay(ctx, scene);
      perf.overlayMs += performance.now() - to;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    const unsub = useStore.subscribe(schedule);
    const mo = new MutationObserver(() => {
      themeTick++;
      schedule();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-canvas'] });
    return () => {
      unsub();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (idle) clearTimeout(idle);
    };
  }, []);

  const toScreen = (e: React.PointerEvent | React.WheelEvent): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      pan.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const s = useStore.getState();
    const screen = toScreen(e);
    const world = screenToWorld(s.view, screen);
    // A press on empty space in select mode (or while a tool collects entities) may become a window.
    const boxing = (s.tool === 'select' || s.toolWantsEntity()) && s.pickAt(world) === null;
    press.current = { screen, world, shift: e.shiftKey, boxing };
    if (!boxing) {
      s.toolClick(world, e.shiftKey);
      press.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (pan.current) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      pan.current = { x: e.clientX, y: e.clientY };
      s.panBy(dx, dy);
      return;
    }
    const screen = toScreen(e);
    s.moveCursor(screen);
    if (press.current?.boxing) {
      const world = screenToWorld(s.view, screen);
      if (!s.selectBox) {
        if (Math.hypot(screen.x - press.current.screen.x, screen.y - press.current.screen.y) > 4) s.beginSelectBox(press.current.world);
      } else s.updateSelectBox(world);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    pan.current = null;
    const p = press.current;
    press.current = null;
    if (!p) return;
    const s = useStore.getState();
    if (s.selectBox) s.endSelectBox(p.shift);
    else if (p.boxing) {
      // A plain click on empty space.
      if (s.tool === 'select') {
        if (!p.shift) s.clearSelection();
      } else s.toolClick(p.world, p.shift);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.exp(-e.deltaY * 0.0015);
    useStore.getState().zoomAt(toScreen(e), factor);
  };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => useStore.getState().moveCursor(null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (e.button === 0 && useStore.getState().tool === 'select') useStore.getState().zoomExtents();
        }}
      />
    </div>
  );
}
