// The drawing canvas: pointer input (pick, draw, pan, zoom) and a redraw on every state change.

import { useEffect, useRef } from 'react';
import type { Entity } from '@shared/doc/types';
import { dist, type Vec2 } from '@shared/geometry/vec2';
import { readPalette, render } from '../canvas/render';
import { screenToWorld, useStore } from '../state/store';

export function Canvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

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
      const last = s.toolPoints[s.toolPoints.length - 1];
      let preview: Entity | null = null;
      if (s.cursor && last) {
        if (s.tool === 'line') preview = { id: '_', type: 'line', layer: s.editor.doc.activeLayer, a: last, b: s.cursor };
        if (s.tool === 'circle' && dist(last, s.cursor) > 0) preview = { id: '_', type: 'circle', layer: s.editor.doc.activeLayer, center: last, radius: dist(last, s.cursor) };
      }
      render(ctx, {
        doc: s.editor.doc,
        view: s.view,
        size: s.canvasSize,
        dpr,
        selection: new Set(s.selection),
        gridOn: s.gridOn,
        gridStep: s.gridStep(),
        cursor: s.cursor,
        preview,
        palette: readPalette(canvas),
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    const unsub = useStore.subscribe(schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-canvas'] });
    return () => {
      unsub();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const toScreen = (e: React.PointerEvent | React.WheelEvent): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    // Middle button, or right button, or space-less left drag on empty space: pan.
    if (e.button === 1 || e.button === 2) {
      drag.current = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (e.button !== 0) return;
    const s = useStore.getState();
    const world = s.snap(screenToWorld(s.view, toScreen(e)));
    if (s.tool === 'select') {
      const id = s.pickAt(world);
      if (id) s.select([id], e.shiftKey ? 'toggle' : 'set');
      else if (!e.shiftKey) s.clearSelection();
      return;
    }
    s.addToolPoint(world);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY, moved: true };
      s.panBy(dx, dy);
      return;
    }
    s.setCursor(s.snap(screenToWorld(s.view, toScreen(e))));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
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
        onPointerLeave={() => useStore.getState().setCursor(null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (e.button === 0 && useStore.getState().tool === 'select') useStore.getState().zoomExtents();
        }}
      />
    </div>
  );
}
