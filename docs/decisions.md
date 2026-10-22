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
- **Site output is committed.** As in BoardPilot, `scripts/build-site.mjs` writes `site/` and the
  result is committed so Cloudflare Pages can serve the folder as it is without a build step.
