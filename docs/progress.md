# Progress

Short entries after each milestone: what works, what is left, anything the owner must do by hand.
Newest first.

## 2026-10-22 — M2 Dimensions and sheets done

**What works**

- Dimensions to ISO 129-1 (linear, aligned, angular, radius, diameter, ordinate) drawn by the
  command line or the palette; the value is measured from the geometry and never stored; decimal
  comma on ISO drawings, ⌀ and R prefixes, override text; tolerances as deviations, ±, limits or an
  ISO 286 class with the deviations looked up in the library (H7/g6 at 25 mm gives the standard's
  own worked example).
- Notes with leaders, balloons, surface texture symbols, geometrical tolerance frames (symbols
  drawn as lines so every font and PDF reader shows them), datums; a Properties panel for all of
  them and for the dimension style (3.5 mm lettering, 30° closed filled arrowheads, annotation
  scale).
- Sheets A0 to A4 (ISO 5457 frame, zones, centring and trimming marks), the ISO 7200 title block
  with its 19 fields, views at ISO 5455 scales, a Model / Sheet tab strip, and a vector PDF export
  at true scale (one page per sheet; without a sheet, the model at 1:1 on an A3).
- Standards data for all of the above verified on the standards' own text (previews and identical
  national adoptions) and recorded with sources in `library/` and `docs/standards.md`; what comes
  from an older edition is listed in `docs/to-verify.md`.
- File format 3 with a migration; annotations exploded on DXF export; the sample now carries
  dimensions, a fit, symbols and an A3 sheet.
- 207 unit tests and 5 end-to-end tests (the sheets one exports a PDF and parses it back).

**What is left for M3** (see `docs/roadmap.md`)

- planegcs in a worker, the sketch constraints, driving dimensions, degrees-of-freedom colouring,
  conflicts explained in plain words.
- Known limits recorded in `docs/decisions.md`: one annotation scale per drawing; text widths are
  estimated (0.7 × height) on screen while the PDF uses Helvetica's real metrics; DXF DIMENSION
  entities are neither read nor written (dimensions are exploded).

**For the owner to do by hand**

- Open the exported PDF (File > Export PDF on the sample) in your usual viewer and in a CAD
  program's PDF import once, and tell me if a line width or a text looks wrong.
- Several library values come from older editions (ISO 286-1:1988, ISO 129-1:2004, ISO 3098-0:1997,
  ISO 7083:1983, ISO 1302:1978); if you have the current editions, the rows in `docs/to-verify.md`
  say exactly what to confirm.

## 2026-10-22 — M1 2D drafting done

**What works**

- All M1 entities: line, polyline (with arc segments), rectangle, circle, three-point arc, ellipse,
  spline through fit points, text. File format 2 (format-1 files upgrade on open).
- Object snaps with on-screen markers (end, mid, centre, quadrant, intersection, perpendicular,
  tangent, nearest) and 15° polar tracking; `OSNAP` / `Osnap` and `Polar` toggles in the status bar.
- Edit tools: move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, rectangular
  and polar array, each driven from the command line with plain-word prompts and failure messages.
  Window and crossing selection, hover highlight, grips on the selection.
- ISO 128-2 dashed, long-dashed dotted and double-dotted lines render with the Table 4 element
  lengths (verified on the standard's own text; `docs/to-verify.md` keeps the record).
- Spatial index for picking, snapping and culling; the renderer caches the static scene as a
  bitmap while the view moves. The end-to-end budget test loads 100,000 entities and checks that
  pan and zoom stay at the display rate zoomed in, zooming, and at zoom extents (a full re-render
  at extents takes ~200 ms on this ARM laptop and runs only when the view settles).
- Autosave every 20 s while the drawing is dirty; a recovery banner after a crash (tested
  end-to-end by killing the app).
- DXF import and export (R12 and 2000 subsets), `docs/dxf.md`: round-trip tests, block
  expansion, unit conversion, grouped warnings for what was skipped. 23 DXF unit tests.
- 153 unit tests (file format, commands, geometry, transforms, intersections, operations,
  spatial index, DXF, library, i18n) and 4 end-to-end tests.

**What is left for M2** (see `docs/roadmap.md`)

- Dimensions (linear, aligned, angular, radius, diameter, ordinate) to ISO 129-1, tolerances and
  ISO 286 fits, surface texture symbols, GD&T frames, notes and balloons, sheets with frames and
  ISO 7200 title blocks, views at standard scales, vector PDF export at true scale, and the
  mounting-bracket sample with fits and tolerances.
- Known limits recorded in `docs/decisions.md`: polyline offset does not remove global
  self-intersections; text width is estimated until real font metrics arrive with the PDF export;
  mirrored text keeps its insertion point.

**For the owner to do by hand**

- Open an exported DXF (File > Export DXF) in AutoCAD, LibreCAD or DraftSight once and tell me
  what, if anything, looks wrong; the writer has only been checked by MechPilot's own reader
  (`docs/to-verify.md`).
- Nothing else is required.

## 2026-10-22 — M0 Scaffold done

**What works**

- `npm run dev` starts the app with its main layout: top bar with File / Edit / View / Help menus,
  tool palette, drawing canvas (grid, pan with the middle or right button, zoom with the wheel,
  double-click to zoom extents), Properties / Layers / Checks panel, command line, status bar.
  Dark or light interface, dark or white canvas, English and Italian, all from the View menu and
  remembered in settings.
- Drawing lines and circles by mouse or command line (`L`, `C`, points as `10,20` or `@50,0`,
  a radius as a number), selection by click (Shift adds), Delete, undo/redo (`U`, `REDO`, Ctrl+Z/Y),
  editing values in Properties, layers with ISO 128-2 line types and widths.
- File > Open sample > Mounting bracket; Save / Save as / Open of `.mechpilot.json`; recent files.
- The document model, the file format v1 with migrations and exact round trips, and the command
  layer with do/undo for every edit (including opening a file) live in `shared/` with 45 unit tests.
- Worker harness with a typed protocol; the status bar shows "Worker ready" when the smoke worker
  answers from its own thread.
- CI: typecheck, tests, licence check (GPL/AGPL fail the build), library check, app build, site
  build with an up-to-date check, end-to-end test of the built app (Playwright).
- Website skeleton in `site/` (landing and "For companies", English and Italian).

**For the owner to do by hand**

- Nothing is required. When convenient: enable GitHub Discussions on the repository (the website
  and the issue templates link to it), and connect `site/` to Cloudflare Pages as planned.
- Note: the development machine is Windows on ARM64. Packaging for macOS and Linux (M8) will run
  in GitHub Actions, not here.
