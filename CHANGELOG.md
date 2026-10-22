# Changelog

All notable changes to MechPilot. The format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

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
