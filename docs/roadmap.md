# Roadmap

Milestones from `docs/brief.md`, as checklists. Every milestone ends the same way: the app runs with
`npm run dev`, `npm run typecheck` / `npm test` / `npm run check:licenses` / `npm run check:library`
pass, the sample projects work, there is a `CHANGELOG.md` entry, one commit, pushed, and a short
entry in `docs/progress.md`.

## M0 Scaffold

- [x] Repo: CLAUDE.md, this roadmap, `docs/decisions.md`, `docs/progress.md`, `docs/to-verify.md`
- [x] Licence files: Apache-2.0 `LICENSE`, `NOTICE`, `THIRD_PARTY_LICENSES.md` generated at build
- [x] Open source: CONTRIBUTING (DCO sign-off), CODE_OF_CONDUCT, SECURITY.md, issue and PR
      templates, "contribute in 30 minutes" in the README
- [x] CI: typecheck, unit tests, licence check (fails on GPL/AGPL), library check, build, site build
- [x] App skeleton: Electron main (settings, samples, open/save), typed preload, renderer
- [x] Main layout: top bar, tool palette, canvas, properties panel, command line, layers panel
- [x] Document model in `/shared` with the command layer (do/undo) and the file format v1
- [x] i18n: `t()` with Italian entries, enforced by a test
- [x] Worker harness (typed protocol) with a smoke worker, so M3/M4 plug in
- [x] Library folder with the ISO 128-2 line types and the validation script
- [x] Sample project: mounting bracket (outline; fits and tolerances come in M2)
- [x] Website skeleton: landing + "For companies" in English and Italian, sitemap, robots

## M1 2D drafting

- [ ] Entities: line, polyline, rectangle, circle, arc, ellipse, spline, text
- [ ] Object snaps: end, mid, centre, intersection, perpendicular, tangent, nearest; polar tracking
- [ ] Edits: select, move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array
- [ ] Layers, ISO 128 line types and widths, grid
- [ ] Save and open (`.mechpilot.json`), autosave and crash recovery
- [ ] DXF import and export (R12 and 2000+ subset, documented in `docs/dxf.md`) with round-trip tests
- [ ] Spatial index for picking and snapping; 60 fps pan/zoom budget test with 100,000 entities

## M2 Dimensions and sheets

- [ ] Dimensions: linear, aligned, angular, radius, diameter, ordinate (ISO 129-1)
- [ ] Tolerances and ISO 286 fits; surface texture symbols (ISO 21920-1); GD&T frames (ISO 1101)
- [ ] Notes and balloons
- [ ] Sheets A4 to A0 with frame, zones and an ISO 7200 title block
- [ ] Views at standard scales (ISO 5455)
- [ ] Vector PDF export at true scale, print preview always white
- [ ] Sample: mounting bracket with fits and tolerances

## M3 Parametric sketches

- [ ] planegcs in a worker (LGPL notice, replaceable module)
- [ ] Constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
      symmetric, fixed, distance, angle, radius
- [ ] Driving dimensions
- [ ] Degrees-of-freedom colouring
- [ ] Conflicts explained in plain words, with a way out

## M4 3D parts

- [ ] replicad/opencascade.js in a worker (LGPL notice, replaceable module); rebuilds never freeze
- [ ] Sketch on a plane
- [ ] Features: extrude, revolve, cut, hole (ISO clearance and tapped), fillet, chamfer, shell,
      mirror, pattern
- [ ] Feature tree; edit any parameter and the part rebuilds
- [ ] Material library with density and source; mass, volume, centre of gravity
- [ ] Section view and measuring in 3D
- [ ] STEP and STL/3MF export, STEP import, with round-trip tests
- [ ] Samples: stepped shaft with a bearing seat; sheet-metal cover

## M5 Drawings from 3D

- [ ] Front, top, side and isometric views, first (default) or third angle (ISO 5456-2)
- [ ] Section and detail views, hidden lines, centre lines and marks
- [ ] Views stay linked: change the part and the drawing updates; a dimension that lost its
      geometry is flagged

## M6 Library and assemblies

- [ ] Standard parts as parametric data with sources: ISO 4762 screws, ISO 4032 nuts, ISO 7089
      washers, ISO 15 bearings, common aluminium profiles
- [ ] Simple assemblies: place parts and mate them (coincident, concentric, distance, angle)
- [ ] Interference check
- [ ] BOM with part numbers, a BOM table on the drawing, exploded view
- [ ] Sample: bearing-housing assembly with a BOM

## M7 Checks and AI

- [ ] Drawing checker (rule 6) on every change, warnings banner, one-click fixes
- [ ] Optional AI assistant: Claude, OpenAI or Gemini with the user's key, main process only
- [ ] Context: model, sketches, dimensions, check results; tools to read, measure, check, propose
- [ ] Proposals as highlighted previews with Accept / Reject, in undo
- [ ] Fake provider in CI; real-key test written and skipped without a key

## M8 Release

- [ ] Release builds from a git tag: macOS dmg (arm64, x64), Windows installer, Linux AppImage
      (unsigned, ready for signing). Tagging is the owner's action.
- [ ] Website with screenshots from the real app, comparison page, SEO pages from the library
- [ ] Docs: getting started, file format, DXF and STEP notes
- [ ] End-to-end tests of every main workflow
- [ ] Launch checklist
