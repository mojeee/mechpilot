# Progress

Short entries after each milestone: what works, what is left, anything the owner must do by hand.
Newest first.

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

**What is left for M1** (see `docs/roadmap.md`)

- The other entities (polyline, rectangle, arc tool, ellipse, spline, text), object snaps and polar
  tracking, the edit commands (move, copy, rotate, scale, mirror, offset, trim, extend, fillet,
  chamfer, array), dashed line rendering once the ISO 128-2 element lengths are verified
  (`docs/to-verify.md`), autosave and crash recovery, DXF import/export with round-trip tests, the
  spatial index and the 100,000-entity performance test.

**For the owner to do by hand**

- Nothing is required. When convenient: enable GitHub Discussions on the repository (the website
  and the issue templates link to it), and connect `site/` to Cloudflare Pages as planned.
- Note: the development machine is Windows on ARM64. Packaging for macOS and Linux (M8) will run
  in GitHub Actions, not here.
