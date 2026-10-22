# Changelog

All notable changes to MechPilot. The format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.4.0 — 2026-10-22 — M3 Parametric sketches

### Added

- Sketch constraints solved by planegcs (FreeCAD's solver as WebAssembly, LGPL, in its own
  worker): coincident, point on line, horizontal, vertical, parallel, perpendicular, tangent, equal,
  symmetric, fixed, distance, point–line distance, angle, radius. Tools `CC`, `CPL`, `CH`, `CV`,
  `CPA`, `CPE`, `CT`, `CE`, `CS`, `CF`, `CD`, `CA`, `CR`.
- Driving dimensions: tick "Driving" on a dimension and the geometry follows its value.
- Inferred constraints while drawing lines: snapped end points become coincident, polar-tracked
  0°/90° segments become horizontal or vertical, consecutive segments share their corner.
- Degrees-of-freedom colouring (green fully constrained, amber free), constraint glyphs on the
  drawing, the DOF count in the status bar, and conflicts or redundancies explained in plain words
  in the Checks tab with one-click removal.
- The solver's result joins the user's edit as one undo step; deleting an entity deletes its
  constraints (undo restores both). File format 4 with a migration.
- Sample: the mounting bracket outline is a constrained sketch driven by its 120 and 80 dimensions.

## 0.3.0 — 2026-10-22 — M2 Dimensions and sheets

### Added

- Dimensions to ISO 129-1: linear (`DLI`), aligned (`DAL`), angular (`DAN`), radius (`DRA`),
  diameter (`DDI`), ordinate (`DOR`). The value is measured from the geometry when drawn, never
  stored; decimal comma on ISO drawings, ⌀ and R prefixes, override text with `<>`.
- Tolerances: deviations, symmetric, limits, and ISO 286 classes (H7, g6 …) whose deviations come
  from the library (`shared/fits.ts`); the Properties panel edits them.
- Notes with leaders (`LE`), balloons (`BAL`), ISO 21920-1 surface texture symbols (`SURF`),
  ISO 1101 geometrical tolerance frames (`TOL`, symbols drawn as lines) and datums (`DAT`).
- Dimension style (ISO 3098 3.5 mm lettering, 30° closed filled arrowheads of length h, 8 × line
  width extension overshoot, annotation scale) in the Properties panel.
- Sheets: A0 to A4 to ISO 5457 (frame, zones, centring and trimming marks), ISO 7200 title block
  with all 19 data fields, views at ISO 5455 scales; a Model / Sheet tab strip and a Sheets panel.
- Vector PDF export at true scale (pdf-lib, Helvetica, black, 0.13 mm minimum line width), one
  page per sheet, with ISO line widths printed as they are whatever the view scale.
- Library data verified on the standards' own text: `sheets/iso-5457`, `title-blocks/iso-7200`,
  `scales/iso-5455`, `lettering/iso-3098`, `dimensioning/iso-129-1`, `fits/iso-286` (IT01–IT18,
  fundamental deviations, Δ), `gdt/iso-1101`, `surface/iso-21920-1`; `docs/standards.md`.
- File format 3 (annotations, dimension style, sheets) with a migration from format 2.
- Annotations are exploded into lines, arcs and text on DXF export.
- Sample: the mounting bracket now carries dimensions with ±, deviations and an H7 fit, a
  surface symbol, flatness and position frames, datums, a note, a balloon and an A3 sheet.

## 0.2.0 — 2026-10-22 — M1 2D drafting

### Added

- Entities: polyline (with arc segments as DXF bulges; rectangle as a closed polyline), ellipse,
  spline (B-spline through fit points), text. File format 2 with a migration from format 1.
- Drawing tools by mouse or command line: `L` line (`C` closes, `U` undoes a segment), `PL`
  polyline, `REC` rectangle, `C` circle (radius or `D` diameter), `A` three-point arc, `EL`
  ellipse, `SPL` spline, `T` text (`H=` sets the height).
- Object snaps with markers: end, mid, centre, quadrant, intersection, perpendicular, tangent,
  nearest (`OSNAP` toggles them), and polar tracking every 15°.
- Edit tools: `M` move, `CO` copy, `RO` rotate, `SC` scale, `MI` mirror, `O` offset, `TR` trim,
  `EX` extend, `F` fillet (`R=`), `CHA` chamfer (`D=`), `AR` array (rectangular or polar).
  Window (left to right) and crossing (right to left) selection; hover highlight; grips.
- ISO 128-2 dashed, long-dashed dotted and double-dotted line types render with the Table 4
  element lengths (verified against the standard's text; see `docs/to-verify.md`).
- Spatial index for picking, snapping and view culling, with a 100,000-entity budget test.
- Autosave every 20 s while the drawing is dirty, and a recovery banner after a crash.
- DXF import and export (R12 and 2000 subsets, `docs/dxf.md`): File > Import DXF, Export DXF.
  Round-trip tests, blocks expanded on import, units converted, unsupported entities reported.
- `ZW` zooms to the selection; `SA` selects all.

## 0.1.0 — 2026-10-22 — M0 Scaffold

### Added

- The project: `CLAUDE.md`, `docs/roadmap.md` (M0 to M8 as checklists), `docs/decisions.md`,
  `docs/to-verify.md`, `docs/file-format.md`, `docs/progress.md`.
- Open source: Apache-2.0 `LICENSE` and `NOTICE`, `CONTRIBUTING.md` (DCO sign-off),
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull-request templates, "contribute in 30
  minutes" in the README. `THIRD_PARTY_LICENSES.md` is generated before every build.
- CI: typecheck, unit tests, licence check (fails on GPL or AGPL), library check, build, site
  build with an up-to-date check, end-to-end tests.
- The app (Electron + electron-vite, React, Zustand, TypeScript strict) with its main layout:
  top bar with in-app menus, tool palette, Canvas 2D drawing canvas with grid, pan and zoom,
  properties and layers panels, command line, status bar. Dark and light interface, dark or
  white canvas, English and Italian.
- The document model and file format v1 (`.mechpilot.json`): millimetres in double precision,
  stable ordering, migrations, plain-language errors.
- The command layer with do/undo for every edit, including opening a document.
- Line and circle drawing by mouse or command line (`L`, `C`, absolute and `@relative` points),
  selection, delete, properties editing, layer management with ISO 128-2 line types and widths.
- Worker harness with a typed protocol and a smoke worker (the solver and kernel plug in later).
- Library: ISO 128-2 line types and the line-width series, with sources, validated by
  `scripts/check-library.mjs`.
- Sample project: the mounting bracket (outline, holes, centre lines).
- Website skeleton (`site/`): landing page and "For companies" in English and Italian, sitemap,
  robots, security headers.
