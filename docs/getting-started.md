# Getting started

MechPilot is in development (milestone M0 of M8). Today you build it from source; installers for
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
   to zoom to extents (or type `ZE`).
3. **Draw a line:** type `L`, then click two points, or type them: `0,100` then `@50,0` (relative
   to the last point). Enter or Esc finishes.
4. **Draw a circle:** `C`, click the centre, then a point on the circle or type a radius: `12.5`.
5. **Select** by clicking an entity; Shift adds to the selection; Delete removes it; edit its
   values in the Properties panel on the right.
6. **Undo** with `U` or Ctrl+Z, redo with `REDO` or Ctrl+Y. Everything is undoable, including
   opening a file.
7. **Layers:** the Layers tab shows each layer's colour, ISO 128-2 line type and width, visibility
   and lock. The dot on the left marks the active layer.
8. **Save** with Ctrl+S as `name.mechpilot.json`: plain JSON, documented in
   [file-format.md](file-format.md).

**View menu:** dark or light interface, dark or white canvas, English or Italian.

## Keyboard

| Key | Action |
| --- | --- |
| `L`, `C` | line, circle |
| `U`, `REDO` | undo, redo |
| `E` or Delete | erase the selection |
| `ZE` | zoom extents |
| `GRID`, `SNAP` | toggle the grid, snap to the grid |
| Esc | finish the tool, clear the selection |
| Ctrl+N / O / S / Shift+S | new, open, save, save as |
| Ctrl+A | select all |

Typing a letter anywhere on the canvas goes to the command line.
