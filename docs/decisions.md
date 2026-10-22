# Decisions

Choices made while building, with the reasons, as `docs/brief.md` asks ("When you would have to ask
me"). Newest at the bottom of each section.

## Dependencies

All under MIT, Apache-2.0, BSD or ISC unless noted. `npm run check:licenses` verifies the whole tree.

| Package | Licence | Why |
| --- | --- | --- |
| electron, electron-vite, electron-builder | MIT | the decided desktop shell and build tooling (same as BoardPilot) |
| vite, @vitejs/plugin-react, typescript | MIT / Apache-2.0 | build and type checking |
| react, react-dom, zustand | MIT | the decided UI and state stack |
| vitest, @playwright/test | MIT / Apache-2.0 | unit and end-to-end tests |
| @types/node, @types/react, @types/react-dom | MIT | type definitions only |

Planned (added in the milestone that needs them, each as a separate, replaceable worker module):

| Package | Licence | Milestone | Notes |
| --- | --- | --- | --- |
| @salusoft89/planegcs | LGPL-2.0-or-later | M3 | FreeCAD's solver as WebAssembly; loaded only inside `app/workers/solver`, notice shipped |
| replicad | MIT | M4 | the decided kernel API |
| opencascade.js | LGPL-2.1-only | M4 | OCCT as WebAssembly, pulled in by replicad; loaded only inside `app/workers/kernel`, notice shipped |
| three, @react-three/fiber, @react-three/drei | MIT | M4 | the 3D viewer |
| @anthropic-ai/sdk | MIT | M7 | Claude provider; OpenAI and Gemini via `fetch` |

## 2026-10-22 M0

- **No web fonts.** The app is local-first and must work offline, so the UI uses the system font
  stack (and a monospace stack for numbers and the command line) instead of loading IBM Plex from
  Google Fonts as BoardPilot does. The website may use web fonts later; the app does not.
- **No native Node modules in M0.** Everything is pure JavaScript or WebAssembly. This machine is
  Windows on ARM64 without MSVC, so a native module without an arm64 prebuilt binary would not
  install. The two heavy pieces (planegcs, OpenCascade) are WebAssembly, so nothing native is
  expected before M8's packaging either.
- **Licence check is our own script.** `scripts/check-licenses.mjs` walks `node_modules` and reads
  each package's `license` field (falling back to its LICENSE file heading). It fails on GPL and
  AGPL, allows LGPL only for packages listed in `scripts/lgpl-allowlist.json` (empty until M3),
  and writes `THIRD_PARTY_LICENSES.md` before every build. A third-party checker would be one more
  dependency to audit for the same result.
- **Document model: ordered maps keyed by id.** Entities and layers are stored in plain objects
  keyed by a short random id, plus an explicit `order` array. The serializer writes keys in a fixed
  order and entities in `order`, so a saved file diffs well in Git (rule 3) while lookups by id stay
  O(1).
- **Commands are pure functions over the document.** A command's `apply(doc)` returns a new
  document and an inverse command; the history keeps both. Pure data in, pure data out, so the same
  path serves undo, autosave, scripting, imports and AI proposals (rule 4). Structural sharing
  keeps this cheap: a command copies only the maps it touches.
- **Canvas 2D renderer with a world transform.** Pan and zoom are a single affine transform
  applied by the renderer; entities are stored in millimetres and never transformed in the model.
  WebGL stays a later option if the 100,000-entity budget (rule 8) is missed.
- **Worker harness now, solvers later.** `shared/worker-protocol.ts` and a smoke worker prove that
  electron-vite builds and loads workers in the sandboxed renderer, so planegcs (M3) and replicad
  (M4) plug into a path that already works.
- **ISO 128-2 dash lengths kept out of the library until verified.** The line *types* and the
  width series are in `library/line-types/iso-128-2.json` with their clauses; the dash, gap and dot
  element lengths are listed in `docs/to-verify.md` and not yet in code (rule 2).
- **ISO 128-2 dash lengths now verified.** The line element lengths (Table 4) and the width
  series (5.1) were read in the standard's own preview text on 2026-10-22, so the patterns are in
  `library/line-types/iso-128-2.json` with their clause; the line type application numbers of
  Annex D remain in `docs/to-verify.md`.

## 2026-10-22 M1

- **Own spatial index, no dependency.** `shared/spatial/index.ts` is a uniform grid of buckets
  with a "large items" list, rebuilt on every document change. It is ~80 lines, O(n) to build and
  cheap to query, which is all picking, snapping and culling need; an R-tree package (flatbush) was
  considered and skipped because the model rebuilds the index wholesale anyway.
- **DXF and geometry operations are separate pure modules.** `shared/dxf` and
  `shared/geometry/{transform,intersect,ops}.ts` know nothing about the UI or the command layer;
  the tools turn their results into commands. This keeps them unit-testable and reusable by the AI
  assistant and scripting later.
- **Splines are stored as B-splines with their fit points.** The DXF SPLINE entity carries
  control points and knots, so the file format does the same (exact DXF round trips, no
  re-approximation); the fit points the user picked are kept so editing can re-interpolate.
- **Ellipses as in DXF** (centre, major-axis vector, ratio, parameters), for the same reason.
- **Text width is estimated** (0.7 × height per character) for bounds and picking until real font
  metrics arrive with the PDF export (M2).
- **DXF mapping choices** (`shared/dxf`, details in `docs/dxf.md`): HIDDEN/DASHED and CENTER read as
  the wide variants 02.2 / 04.2 when the layer lineweight is ≥ 0.5 mm, else narrow, the same rule as
  CONTINUOUS, so wide types survive a 2000 round trip; the acadiso.lin names ACAD_ISO02W100 /
  04W100 / 05W100 map to ISO 02 / 04 / 05; a negative layer colour ("off") reads as hidden and
  hidden layers export as frozen; ACI 7 is reserved for "auto", so pure white exports as ACI 255;
  true colour (420) is written in AC1015 files (older readers ignore it); MTEXT rotation (50) is
  read in degrees as AutoCAD writes it; block entities on layer 0 take the INSERT's layer; an
  INSERT with |41| = |42| and opposite signs is a mirror; (0,0,−1) extrusions are mirrored to plan
  view; rational splines become polylines with a warning; paper-space entities are skipped;
  per-entity colour/line type/lineweight overrides are dropped with one grouped warning; layer
  names are cleaned on export (invalid characters → `_`, case-only duplicates → `_2`); binary DXF
  gets its own error code.
- **Fillet with radius 0 returns no arc.** `fillet()` types its arc as `ArcEntity | null`: with
  radius 0 two lines are only trimmed to their corner, which is what drafters expect from "fillet
  R0".
- **Mirrored text stays readable.** `transformEntity` under a mirror reflects the text baseline
  and keeps the glyphs unmirrored (rotation π when a horizontal text is mirrored across a vertical
  axis). Placing it inside the mirrored box would need the text width, which arrives with real
  font metrics in M2.
- **Polyline offset handles the common cases.** Convex corners get an arc, concave corners are
  trimmed, inverted segments are dropped; global self-intersections of the result (a narrow neck
  offset by more than half its width) are not removed. Recorded as a known limit.
- **Site output is committed.** As in BoardPilot, `scripts/build-site.mjs` writes `site/` and the
  result is committed so Cloudflare Pages can serve the folder as it is without a build step.
