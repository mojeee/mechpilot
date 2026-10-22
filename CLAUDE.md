# MechPilot: project context for Claude

Read this file fully before any work. It says what we are building, the rules that never change, the
stack and structure already decided, and how every milestone ends. If a request conflicts with this
file, point it out before coding. The full original brief is in `docs/brief.md`; the milestone
checklists are in `docs/roadmap.md`; choices made along the way are in `docs/decisions.md`.

## What we are building

MechPilot is an open-source (Apache-2.0), local-first desktop app for macOS, Windows and Linux for
2D mechanical drafting with 3D built in for parts:

- **2D first.** Draw, dimension and annotate production drawings to ISO standards (ASME as an
  option), on sheets with frames and title blocks. Export PDF and DXF.
- **3D where it helps.** Turn a 2D sketch into a 3D part (extrude, revolve, holes, fillets), change
  a component by editing its parameters, and see the 2D drawing views update from the 3D model.
- **No account, no cloud.** Everything runs on the user's computer. An optional AI assistant uses
  the user's own API key.
- **A marketing website** generated from the repo into `/site`, with screenshots from the real app.

Out of scope for v1: CAM and toolpaths, FEA, photorealistic rendering, cloud collaboration, writing
DWG (DXF covers exchange; LibreDWG is GPL).

## Who it is for

Mechanical design companies: machine builders, sheet-metal and fabrication shops, fixture and jig
designers, small engineering offices and freelance designers. They make manufacturing drawings
every day, exchange DXF and STEP with customers and suppliers, and today pay for AutoCAD,
SolidWorks or Inventor, or struggle with FreeCAD. The app must feel professional in the first ten
minutes: fast, precise, drawings to standard, files that open everywhere.

## Product rules (never break these)

1. **Precision.** Geometry is stored in millimetres as double precision. Nothing is rounded on
   save, load or export. Units are always explicit in the UI and in files. Every import and export
   has a round-trip test.
2. **Standards, with sources.** ISO by default: ISO 128 (lines), ISO 129-1 (dimensions),
   ISO 5456-2 (projections; first angle by default, third angle as an option), ISO 5455 (scales),
   ISO 7200 (title block), ISO 1101 (geometrical tolerances), ISO 286 (limits and fits),
   ISO 21920-1 (surface texture, formerly ISO 1302). ASME Y14.5 and Y14.3 as an option. Every rule
   and every table value in code cites its standard and clause in a comment. Never invent a table
   value: if you cannot verify it, leave it out and list it in `docs/to-verify.md`.
3. **The files belong to the user.** An open, documented file format (`docs/file-format.md`):
   versioned JSON with a schema and migrations, stable key and entity ordering so it diffs well in
   Git. Autosave and crash recovery. DXF and STEP in and out. No lock-in.
4. **Undo everything.** Every edit is undoable, including AI edits and imports. Parametric history
   is never destroyed silently.
5. **Look before asking, no dead ends.** Smart defaults: snaps, inferred constraints, a suggested
   next dimension. When something fails (a constraint conflict, a fillet that cannot be built, an
   import with unsupported entities), say what happened in plain words, show where on the drawing,
   and offer a way out.
6. **Continuous checks.** A drawing checker runs on every change: under- or over-constrained
   sketches; features with no dimension for manufacture; duplicate or contradictory dimensions;
   fits that do not exist in ISO 286; a sheet-metal bend radius below what the material allows;
   empty title-block fields. Each finding appears on the drawing and in a list, with a one-click
   fix when the fix is a plain edit.
7. **Honest AI (optional).** The assistant proposes changes as a preview that the user accepts or
   rejects; it never edits silently. Every claim shows its source: measured on this model, a
   standard and clause, a library entry, or "suggestion". The app is fully usable without AI.
8. **Fast.** 2D: 60 fps pan and zoom with 100,000 entities. 3D: rebuilds run in a worker and never
   freeze the UI. Performance budgets have tests.
9. **Professional, still clear.** Keyboard-first, with a command line (L for line, D for dimension)
   and the shortcuts CAD users expect. Errors in plain language. English and Italian from day one.
10. **Demo mode.** Sample projects ship with the app (`/samples`), so every feature can be shown and
    tested without user files.

## Stack (decided; same as BoardPilot so conventions carry over)

- **Shell and UI:** Electron + electron-vite, TypeScript strict, React, Zustand, plain CSS with
  design tokens (`app/renderer/styles/tokens.css`). Dark UI by default with a light theme; the
  drawing canvas can be dark or white; print preview is always white. No component library.
- **2D:** our own renderer on Canvas 2D (WebGL later only if the budgets need it), with a spatial
  index for picking and snapping.
- **Sketch constraints:** planegcs (FreeCAD's solver compiled to WebAssembly, LGPL) in a worker.
- **3D kernel:** OpenCascade through replicad (on top of opencascade.js, LGPL) in a worker: B-rep
  solids, fillets, STEP import and export, hidden-line projection for drawing views. Switch to
  opencascade.js directly only if replicad blocks a feature, and record why in `docs/decisions.md`.
  Viewer: three.js through `@react-three/fiber`.
- **AI (optional):** the user picks Claude (`@anthropic-ai/sdk`, default `claude-sonnet-5-5`, fast
  `claude-haiku-4-5-20251001`), OpenAI or Gemini (both via `fetch`, no SDK). Called only from the
  main process (`app/main/ai/providers/`). Keys are entered in the app and stored encrypted with
  Electron `safeStorage`. No key is available during development: build and test against the fake
  provider; the real-key test is skipped when no key is set.
- **Tests:** Vitest for logic (geometry, solver wrapper, file format, DXF, checks, i18n);
  Playwright for end-to-end tests of the built app (`e2e/`).
- **Security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a typed API
  through the preload script. The renderer never sees API keys or the file system directly.
- **Languages:** English and Italian. Every user-facing string goes through `t()` from
  `shared/i18n` with an Italian entry in `shared/i18n/it/*.ts`, enforced by `tests/i18n.test.ts`.

### Licences

- Our code: Apache-2.0 (`LICENSE`, `NOTICE`). Copyright holder: Mojtaba Amini.
- No GPL or AGPL dependencies, ever. `npm run check:licenses` lists every dependency's licence and
  fails on GPL or AGPL; CI runs it. `THIRD_PARTY_LICENSES.md` is generated at build time.
- LGPL libraries (opencascade.js, planegcs) only as separate, replaceable modules under
  `app/workers/`, with their licence notices.
- Small, well-maintained dependencies under MIT, Apache-2.0, BSD or ISC need no approval; list each
  one with its reason in `docs/decisions.md`.

## Folder structure

```
/app
  /main         Electron main: files, DXF/STEP/PDF export, AI provider calls, settings (safeStorage)
  /preload      contextBridge API (typed through shared/api.ts)
  /renderer     UI: components, canvas, panels, state (zustand), styles (tokens.css)
  /workers      the constraint solver (planegcs) and the OCCT kernel (replicad), LGPL modules
/shared         types, geometry, document model, command layer, file format, i18n
/library        standard parts, materials, title blocks, line types as data files with sources
/samples        sample projects shipped with the app (demo mode)
/docs           brief, roadmap, decisions, progress, to-verify, file format, user docs
/site           the generated static website (committed; Cloudflare Pages serves it as is)
/scripts        build-site.mjs, check-licenses.mjs, check-library.mjs, e2e.mjs
/tests          Vitest unit tests
/e2e            Playwright end-to-end tests of the built app
```

## Architecture

- **One command layer.** The document model is pure data in `/shared` (`shared/doc`). Every user
  action, import and AI proposal is a command with do/undo (`shared/commands`), so undo, autosave,
  scripting and AI all go through one path. Nothing in the UI mutates the document directly.
- **Workers.** The solver and the kernel run in Web Workers with a typed request/response protocol
  (`shared/worker-protocol.ts`). The UI never waits synchronously on them.
- **Main process.** Owns the file system, exports, settings and AI calls. The renderer asks through
  the typed API in `shared/api.ts`; every call returns errors as `{ code, message, hint }` in a
  result object, never raw exceptions.
- **Library data.** Every file under `/library` carries its `source` (standard and clause, or
  catalogue) and is checked by `scripts/check-library.mjs`.

## Design tokens

Dark UI (default) and light UI, switched with `data-theme` on `<html>`; the canvas theme is
separate (`data-canvas="dark" | "white"`). Fonts: system UI stack for text, a monospace stack for
coordinates, the command line and numbers (no web fonts: the app works offline).

```css
--bg: #15191e;     --chrome: #11151a;   --panel: #1b2027;   --raised: #272e38;
--line: #2b333e;   --text: #e8ecf0;     --muted: #a3afbb;   --dim: #76828f;
--accent: #4da3ff; --ok: #52c98b;       --warn: #f0a63a;    --err: #ff5a4f;
--canvas-dark: #0f1216;  --canvas-white: #ffffff;
--sel: #ffb020;    --snap: #3fe0c8;     --construction: #8a7bff;
```

Layout: top bar 44px, tool palette 56px on the left, properties/layers/checks panel 320px on the
right, command line and status bar 28px each at the bottom, the canvas in the centre.

## Conventions

- TypeScript strict; no `any` in `/shared`, `/app/main` or `/app/workers`.
- Every user-facing string goes through `t()` with an Italian entry (the i18n test enforces it).
  UI text is for professionals, in plain words.
- Geometry and file-format code has unit tests; every bug fix gets a test.
- Every rule and table value from a standard cites standard and clause in a comment; unverifiable
  values go to `docs/to-verify.md`, never into code.
- Secrets never go in the renderer or in git.
- Native Node modules without prebuilt binaries for Windows ARM64 are avoided (this machine builds
  without MSVC); record any such choice in `docs/decisions.md`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## How every milestone ends

1. The app runs with `npm run dev`.
2. `npm run typecheck`, `npm test`, `npm run check:licenses` and `npm run check:library` pass.
3. The sample projects open and work.
4. A `CHANGELOG.md` entry, one commit, pushed to `main`.
5. A short entry in `docs/progress.md`: what works, what is left, anything the owner must do by hand.
6. The checklist in `docs/roadmap.md` is ticked.

## When to stop and ask

Only for: a GPL or AGPL licence, a paid service, anything that writes outside the repository, or
anything that publishes (releases, tags, posts). For a choice between reasonable options, take the
conservative one, write it with the reasons in `docs/decisions.md` and carry on.

## Website

`https://mechpilot.agentflowbind.com`, static, built by `scripts/build-site.mjs` into `/site`
(English and Italian; canonical links, sitemap and Open Graph use that URL). Companies get in touch
through GitHub Discussions and issues; no email address is published anywhere.
