# Progress

Short entries after each milestone: what works, what is left, anything the owner must do by hand.
Newest first.

## 2026-10-22 — M4 3D parts done; website built (M8-Website pulled forward)

**What works**

- 3D parts: select a closed outline in Model, `SKETCH`, then `EXTRUDE` / `REVOLVE` / `HOLE` /
  `FILLET` / `CHAMFER` / `SHELL` / `MIRROR3D` / `PATTERN` on the command line or from the
  Features tab. A 3D tab per part shows the body (three.js): orbit, view cube, section plane,
  point-to-point measure, volume / surface / size / centre of mass. The feature tree shows which
  feature built, failed (with the reason in plain words) or was skipped; reorder, suppress, edit any
  value and the part rebuilds in the kernel worker (replicad on opencascade.js, LGPL, in
  `app/workers/kernel`), never freezing the window; unchanged leading features are reused from a
  per-part cache. Undo covers every feature edit. File format 5.
- STEP, STL and 3MF export, STEP import as a part's base body. Library: ISO 273 clearance holes,
  ISO 2306 tap drills (ISO 261 pitches), materials with density and source (primary where a
  standard gives it, supplier datasheets marked secondary). Samples: stepped shaft, sheet-metal
  cover. 308 unit tests, 7 end-to-end tests (parts: sketch → extrude → hole → undo → failed
  fillet explained → both samples build).
- Website (`site/`, 70 pages, English and Italian): landing with real screenshots, feature
  status read from the roadmap, download buttons (release not out yet, said on the page), honest
  comparison table, "For companies", docs and changelog pages rendered from `docs/`, one page
  per standard table in the library (ISO 286 fits per class, sheets, line types, lettering,
  GD&T, surface, scales, holes, materials), two guides (ISO fits, first vs third angle), sitemap,
  robots, 404, strict headers, no JavaScript, no third-party requests. `scripts/check-site.mjs`
  checks links, titles, hreflang and the sitemap at every build. `docs/website.md` explains the
  build and the Cloudflare Pages setup.

**Plan change (owner's request).** The next work is the AI assistant (M7-AI in the roadmap: a
complex part designed step by step from written requests, a face / part / corner picked in the
viewer or drawing dropped into the chat as a reference, changes requested on it, previews with
Accept / Reject, the PDF drawing at the end), with the same walkthrough as a demo page on the
website. Then M5, M6, M7-Checks, M8-Release.

**What's left in M4**

- Edge and face picking in the viewer for fillets and chamfers (today: selectors by axis, plane,
  length or box, set in the Features tab). Planned with the assistant's "select a face" work.
- Hidden-line projection exists in the kernel (`project`) and is used by M5.

**For the owner to do by hand**

- Cloudflare Pages: connect the repo (Git integration, production branch `main`, build command
  empty, output directory `site`, root `/`) and add the custom domain
  `mechpilot.agentflowbind.com`; the steps and the header checks are in `docs/website.md`.
- The assistant's real-key test will read `ANTHROPIC_API_KEY` from `.env.local` (git-ignored).

## 2026-10-22 — M3 Parametric sketches done

**What works**

- Sketch constraints solved by planegcs (FreeCAD's solver as WebAssembly, LGPL, in its own
  worker, `app/workers/solver`): coincident, point on line, horizontal, vertical, parallel,
  perpendicular, tangent (including endpoint tangency for fillet-style corners), equal, symmetric,
  fixed, distance, point–line distance, angle, radius; tools `CC CPL CH CV CPA CPE CT CE CS CF CD
  CA CR`.
- Driving dimensions (tick "Driving" in a dimension's properties), inferred constraints while
  drawing lines (snapped ends, polar 0°/90°, consecutive segments), degrees-of-freedom colouring
  (green/amber), constraint glyphs, the DOF count in the status bar, and conflicts or
  redundancies explained in plain words in the Checks tab with one-click removal.
- The solver's moves join the user's edit as one undo step; deleting an entity deletes its
  constraints and undo restores both in order. File format 4 with a migration. The sample's
  outline is a constrained sketch (fixed bottom edge, tangent R10 corners, equal radii, the 80
  height driving) and solves cleanly on open.
- 249 unit tests (including the solver against the real WebAssembly engine) and 6 end-to-end
  tests. The M2 CI failure (a synthetic mouse drag under xvfb) is fixed: the window-selection step
  of the drafting test goes through the store API in CI.

**What is left for M4** (see `docs/roadmap.md`)

- replicad / opencascade.js in a worker, sketch on a plane, extrude, revolve, cut, holes, fillet,
  chamfer, shell, mirror, pattern, the feature tree, materials with mass properties, section view
  and measuring in 3D, STEP and STL/3MF export, STEP import, the stepped shaft and sheet-metal
  cover samples.
- Known limits recorded in `docs/decisions.md` and `docs/sketches.md`: planegcs's fixed memory
  caps one connected group at about 150 joined lines (a plain message says so); rotated linear
  driving dimensions are skipped and reported; no dragging of points with the mouse yet
  (constraints and driving values move the geometry).

**For the owner to do by hand**

- Nothing is required.

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
