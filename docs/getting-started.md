# Getting started

MechPilot is in development (milestone M1 of M8). Today you build it from source; installers for
macOS, Windows and Linux come with M8.

## Build and run

```bash
git clone https://github.com/mojeee/mechpilot
cd mechpilot
npm install
npm run dev
```

Node 24 is required. The first `npm install` downloads Electron (about 100 MB).

## First ten minutes

1. **File > Open sample > Mounting bracket** loads a 120 × 80 mm plate with holes and centre lines.
2. **Pan** with the middle or right mouse button, **zoom** with the wheel, double-click the canvas
   to zoom to extents (or type `ZE`; `ZW` zooms to the selection).
3. **Draw a line:** type `L`, then click two points, or type them: `0,100` then `@50,0` (relative
   to the last point). Enter or Esc finishes; `C` closes the shape; `U` undoes the last segment.
4. **Draw a circle:** `C`, click the centre, then a point on the circle or type a radius: `12.5`
   (`D 25` for a diameter).
5. **Object snaps** light up as you move near end points, midpoints, centres, quadrants,
   intersections, and (from the previous point) perpendicular and tangent points. Polar tracking
   locks the cursor every 15°. `OSNAP` toggles the object snaps, `SNAP` snaps to the grid.
6. **Select** by clicking an entity; drag a window left to right to select what is fully inside,
   right to left to select what it crosses. Shift adds. Delete removes. Edit values in the
   Properties panel on the right.
7. **Edit:** `M` move, `CO` copy, `RO` rotate, `SC` scale, `MI` mirror, `O` offset, `TR` trim,
   `EX` extend, `F` fillet (`R=3` sets the radius), `CHA` chamfer (`D=2,3`), `AR` array. Every
   tool tells you what it needs in the command line.
8. **Undo** with `U` or Ctrl+Z, redo with `REDO` or Ctrl+Y. Everything is undoable, including
   opening a file and importing a DXF.
9. **Layers:** the Layers tab shows each layer's colour, ISO 128-2 line type and width, visibility
   and lock. The dot on the left marks the active layer.
10. **Save** with Ctrl+S as `name.mechpilot.json`: plain JSON, documented in
    [file-format.md](file-format.md). **File > Export DXF** writes a DXF 2000 or R12 for other CAD
    tools; **File > Import DXF** reads one (see [dxf.md](dxf.md)).

**View menu:** dark or light interface, dark or white canvas, English or Italian.

If MechPilot ever closes unexpectedly, the next start offers to recover the autosaved drawing.

## Keyboard

| Key | Action |
| --- | --- |
| `L`, `PL`, `REC`, `C`, `A`, `EL`, `SPL`, `T` | line, polyline, rectangle, circle, arc, ellipse, spline, text |
| `M`, `CO`, `RO`, `SC`, `MI`, `O`, `TR`, `EX`, `F`, `CHA`, `AR` | move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array |
| `U`, `REDO` | undo, redo |
| `E` or Delete | erase the selection |
| `ZE`, `ZW` | zoom extents, zoom to the selection |
| `GRID`, `SNAP`, `OSNAP` | toggle the grid, grid snap, object snaps |
| Esc | finish the tool, clear the selection |
| Ctrl+N / O / S / Shift+S | new, open, save, save as |
| Ctrl+A | select all |

Typing a letter anywhere on the canvas goes to the command line.
