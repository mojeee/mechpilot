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

## Dimensions, symbols and sheets

- **Dimensions:** `DLI` linear (two points, then where the dimension line goes; `H` or `V`
  forces the direction), `DAL` aligned, `DAN` angular (click two lines, then the arc position),
  `DRA` radius and `DDI` diameter (click the arc or circle, then the text position), `DOR`
  ordinate (origin, then feature points). The value is measured from the geometry; select a
  dimension to add a tolerance (deviations, ±, limits or an ISO 286 class such as H7) or an
  override text (`<>` stands for the measured value) in the Properties panel.
- **Symbols:** `LE` note with leader (`|` in the text starts a new line), `BAL` balloon, `SURF`
  surface texture (A / R / P for any process, removal required or prohibited, then `Ra 3.2`),
  `TOL` geometrical tolerance frame (`FLAT 0.05 A` style prompts), `DAT` datum.
- **Dimension style:** with nothing selected, the Properties panel shows the lettering height,
  arrowheads, decimals and the annotation scale (set it to the scale of your main view so the
  lettering prints at 3.5 mm).
- **Sheets:** the tab strip under the top bar switches between Model and the sheets; "+ Sheet"
  adds an A3 with a 1:1 view. The Sheets tab edits the size, orientation, the ISO 7200 title block
  fields and the views (scale, model centre, position and size on the paper).
- **File > Export PDF** prints every sheet as a vector PDF at true scale; without a sheet the
  model is printed at 1:1 on an A3.

## Sketch constraints

- **Constraints:** `CC` coincident (click near two points), `CPL` point on line, `CH` horizontal,
  `CV` vertical, `CPA` parallel, `CPE` perpendicular, `CT` tangent, `CE` equal, `CS` symmetric,
  `CF` fix, `CD` distance, `CA` angle, `CR` radius. The solver (FreeCAD's planegcs) moves the
  geometry at once; the result undoes together with the edit.
- **Inferred while drawing:** a line whose end snaps to another end point becomes coincident with
  it; a segment drawn along polar tracking at 0° or 90° becomes horizontal or vertical.
- **Driving dimensions:** select a dimension and tick "Driving" in Properties; change its value and
  the sketch follows.
- **Reading the sketch:** green entities are fully constrained, amber ones can still move; the
  status bar shows the degrees of freedom left; the Checks tab explains conflicting or redundant
  constraints in plain words and removes them with one click.

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
