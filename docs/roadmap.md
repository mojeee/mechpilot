# Roadmap

Milestones from `docs/brief.md`, as checklists. Every milestone ends the same way: the app runs with
`npm run dev`, `npm run typecheck` / `npm test` / `npm run check:licenses` / `npm run check:library`
pass, the sample projects work, there is a `CHANGELOG.md` entry, one commit, pushed, and a short
entry in `docs/progress.md`.

**Order of work (changed on 2026-10-22 for a demo).** The owner wants to demonstrate the AI
assistant (make a design from a sentence, select something and ask for a change) and the website
before the rest. So after M4 the order is: **M7-AI** (the assistant, previews with Accept / Reject)
→ **M8-Website** (screenshots from the real app, comparison, SEO pages, Cloudflare Pages) →
M5 → M6 → M7-Checks → M8-Release. Milestone numbers stay as in the brief so every document and the
website keep pointing at the same names.

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

- [x] Entities: line, polyline, rectangle, circle, arc, ellipse, spline, text
- [x] Object snaps: end, mid, centre, intersection, perpendicular, tangent, nearest; polar tracking
- [x] Edits: select, move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array
- [x] Layers, ISO 128 line types and widths, grid
- [x] Save and open (`.mechpilot.json`), autosave and crash recovery
- [x] DXF import and export (R12 and 2000+ subset, documented in `docs/dxf.md`) with round-trip tests
- [x] Spatial index for picking and snapping; 60 fps pan/zoom budget test with 100,000 entities

## M2 Dimensions and sheets

- [x] Dimensions: linear, aligned, angular, radius, diameter, ordinate (ISO 129-1)
- [x] Tolerances and ISO 286 fits; surface texture symbols (ISO 21920-1); GD&T frames (ISO 1101)
- [x] Notes and balloons
- [x] Sheets A4 to A0 with frame, zones and an ISO 7200 title block
- [x] Views at standard scales (ISO 5455)
- [x] Vector PDF export at true scale, print preview always white
- [x] Sample: mounting bracket with fits and tolerances

## M3 Parametric sketches

- [x] planegcs in a worker (LGPL notice, replaceable module)
- [x] Constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal,
      symmetric, fixed, distance, angle, radius
- [x] Driving dimensions
- [x] Degrees-of-freedom colouring
- [x] Conflicts explained in plain words, with a way out

## M4 3D parts

- [x] replicad/opencascade.js in a worker (LGPL notice, replaceable module); rebuilds never freeze
- [x] Sketch on a plane
- [x] Features: extrude, revolve, cut, hole (ISO clearance and tapped), fillet, chamfer, shell,
      mirror, pattern
- [x] Feature tree; edit any parameter and the part rebuilds
- [x] Material library with density and source; mass, volume, centre of gravity
- [x] Section view and measuring in 3D
- [x] STEP and STL/3MF export, STEP import, with round-trip tests
- [x] Samples: stepped shaft with a bearing seat; sheet-metal cover

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

## M7-AI Assistant (pulled forward for the demo)

- [x] Optional AI assistant: Claude, OpenAI or Gemini with the user's key, main process only;
      key stored in the OS keychain / app data, never in the renderer or in git
- [x] Context: model, sketches, dimensions, parts, check results; tools to read, measure, check,
      propose commands
- [x] "Make a design from a sentence": the assistant drafts a 2D outline or a 3D part from a
      description (for example "a 120 × 80 plate with four M6 holes on a 100 × 60 pattern and R10
      corners"), shown as a preview
- [x] "Select something and ask for a change": the selection is the context ("make this 5 mm
      thicker", "add a chamfer here", "dimension these"); the answer is a preview on the drawing
- [x] Proposals as highlighted previews with Accept / Reject, one undo step; every claim with its
      source (measured, standard and clause, library entry, or "suggestion")
- [x] Assistant panel with the conversation, the proposal list and the provider settings
- [x] Fake provider in CI; real-key test written and skipped without a key
- [x] Demo sample: a prompt-to-part walkthrough in `docs/getting-started.md`
- [x] Demo script (owner's request, 2026-10-22): default demo model Claude Opus 5.5 for the
      impression; a complex part built step by step from written requests; pick a face, part or
      corner in the viewer or the drawing and it appears as a reference chip in the chat; ask for
      a change on it; finish with the PDF drawing of the design. The same walkthrough goes on the
      website as a demo page with screenshots (and a clip when recorded).

## M7-Checks

- [ ] Drawing checker (rule 6) on every change, warnings banner, one-click fixes

## M8-Website (pulled forward for the demo)

- [x] Website with screenshots from the real app, comparison page, docs and changelog pages, SEO
      pages from the library, two guides, English and Italian
- [x] Cloudflare Pages: `site/` served as it is, `_headers`, `_redirects`, setup steps in
      `docs/website.md` (connecting the repo and the domain is the owner's action)

## M8 Release

- [ ] Release builds from a git tag: macOS dmg (arm64, x64), Windows installer, Linux AppImage
      (unsigned, ready for signing). Tagging is the owner's action.
- [ ] Docs: getting started, file format, DXF and STEP notes
- [ ] End-to-end tests of every main workflow
- [ ] Launch checklist
