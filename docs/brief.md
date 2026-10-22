# New project: MechPilot — open-source 2D/3D mechanical design app

You are starting a new open-source product in an empty repository. Read this whole brief before doing
anything. The open decisions are already made (see "Decisions already made" near the end): turn this
brief into the project's CLAUDE.md and roadmap, then build it milestone by milestone.

If the repository mojeee/boardpilot is attached to this session, read it as a reference only: its
CLAUDE.md, scripts/build-site.mjs, .github/workflows/, e2e/, shared/i18n/ and app/main/ai/ show the
conventions I want here (same stack, same way of working). Do not copy its product code.

## Who it is for

Mechanical design companies: machine builders, sheet-metal and fabrication shops, fixture and jig
designers, small engineering offices and freelance designers. They make manufacturing drawings every
day, exchange DXF and STEP files with customers and suppliers, and today pay for AutoCAD, SolidWorks or
Inventor, or struggle with FreeCAD. The app must feel professional to them in the first ten minutes:
fast, precise, drawings to standard, files that open everywhere.

## What we are building

A local desktop app (macOS, Windows, Linux) for 2D mechanical drafting with 3D built in for parts:

- **2D first:** draw, dimension and annotate production drawings to ISO standards (ASME as an option),
  on sheets with frames and title blocks; export PDF and DXF.
- **3D where it helps:** turn a 2D sketch into a 3D part (extrude, revolve, holes, fillets), change a
  component by editing its parameters, and see the 2D drawing views update from the 3D model.
- **Open source** (Apache-2.0), local-first, no account, no cloud needed. An optional AI assistant that
  uses the user's own API key.
- **A marketing website** generated from the repo, with screenshots taken from the real app.

Out of scope for v1: CAM and toolpaths, FEA, photorealistic rendering, cloud collaboration, writing DWG
(DXF covers exchange).

## Product rules (never break these)

1. **Precision.** Geometry is stored in millimetres as double precision. Nothing is rounded on save,
   load or export. Units are always explicit in the UI and in files. Every import and export has a
   round-trip test.
2. **Standards, with sources.** Drawing conventions follow ISO by default: ISO 128 (lines), ISO 129-1
   (dimensions), ISO 5456-2 (projections; first angle by default, third angle as an option), ISO 5455
   (scales), ISO 7200 (title block), ISO 1101 (geometrical tolerances), ISO 286 (limits and fits),
   ISO 21920-1 (surface texture, formerly ISO 1302). ASME Y14.5 and Y14.3 as an option. Every rule and
   every table value in code cites its standard and clause in a comment. Never invent a table value: if
   you cannot verify it, leave it out and list it in docs/to-verify.md.
3. **The files belong to the user.** An open, documented file format: versioned JSON with a schema and
   migrations, stable ordering so it diffs well in Git. Autosave and crash recovery. DXF and STEP in
   and out. No lock-in.
4. **Undo everything.** Every edit is undoable, including AI edits and imports. Parametric history is
   never destroyed silently.
5. **Look before asking, no dead ends.** Smart defaults: snaps, inferred constraints, a suggested next
   dimension. When something fails (a constraint conflict, a fillet that cannot be built, an import
   with unsupported entities), say what happened in plain words, show where on the drawing, and offer a
   way out.
6. **Continuous checks.** A drawing checker runs on every change. It finds:
   - under- or over-constrained sketches;
   - features with no dimension for manufacture;
   - duplicate or contradictory dimensions;
   - fits that do not exist in ISO 286;
   - a sheet-metal bend radius below what the material allows;
   - empty title-block fields.

   Each finding appears on the drawing and in a list, with a one-click fix when the fix is a plain edit.
7. **Honest AI (optional).** The assistant proposes changes as a preview that the user accepts or
   rejects; it never edits silently. Every claim shows its source: measured on this model, a standard
   and clause, a library entry, or "suggestion". The app is fully usable without AI.
8. **Fast.**
   - 2D: 60 fps pan and zoom with 100,000 entities.
   - 3D: rebuilds run in a worker and never freeze the UI.
   - Performance budgets have tests.
9. **Professional, still clear.** Keyboard-first, with a command line (L for line, D for dimension) and
   the shortcuts CAD users expect. Errors in plain language. English and Italian from day one.
10. **Demo mode.** Sample projects ship with the app, so every feature can be shown and tested without
    user files.

## Stack

Use the same stack as BoardPilot, so the conventions carry over.

- **Shell and UI:** Electron + electron-vite, TypeScript strict, React, Zustand, plain CSS with design
  tokens. Provide dark and light themes; CAD users often want a white canvas.
- **2D:** our own renderer on Canvas 2D (WebGL later, if the budgets need it), with a spatial index for
  picking and snapping.
- **Sketch constraints:** planegcs (FreeCAD's solver compiled to WebAssembly), in a worker.
- **3D kernel:** OpenCascade through replicad or opencascade.js, in a worker. It provides B-rep solids,
  fillets, STEP import and export, and hidden-line projection for drawing views. The viewer is three.js
  through @react-three/fiber.
- **Tests:** Vitest for logic (geometry, solver wrapper, file format, DXF, checks); Playwright for
  end-to-end tests of the built app.
- **Licences:**
  - Our code is Apache-2.0.
  - No GPL or AGPL dependencies. LibreDWG is GPL, so there is no DWG support for now.
  - LGPL libraries (OpenCascade, planegcs) only as separate, replaceable modules, with their licence
    notices.
  - A CI step lists every dependency's licence and fails on GPL or AGPL.
- **Other dependencies:** see "When you would have to ask me" under the decisions below.

## Architecture

- **Folders:**
  - `/app/main`: files, DXF/STEP/PDF export, AI provider calls, settings with keys encrypted by Electron
    safeStorage.
  - `/app/preload`: typed API.
  - `/app/renderer`: UI.
  - `/app/workers`: the constraint solver and the OCCT kernel.
  - `/shared`: types, geometry, file format.
  - `/library`: standard parts, materials, title blocks and line types as data files, checked by a
    validation script.
  - Also: `/samples`, `/docs`, `/site` (the generated website), `/tests`, `/e2e`.
- **One command layer:** the document model is pure data in `/shared`. Every user action, import and AI
  proposal is a command with do/undo, so undo, autosave, scripting and AI all go through one path.
- **Security:** contextIsolation on, nodeIntegration off. The renderer never sees API keys or the file
  system directly.

## Milestones

Every milestone ends the same way: the app runs with `npm run dev`, the tests pass, the sample project
works, there is a CHANGELOG entry, and one commit.

- **M0 Scaffold:**
  - repo, CLAUDE.md, roadmap, licence files;
  - CI: typecheck, unit tests, licence check;
  - the app with its main layout: top bar, tool palette, canvas, properties panel, command line, layers
    panel;
  - website skeleton.
- **M1 2D drafting:**
  - entities: line, polyline, rectangle, circle, arc, ellipse, spline, text;
  - object snaps (end, mid, centre, intersection, perpendicular, tangent, nearest) and polar tracking;
  - edits: select, move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, array;
  - layers, ISO 128 line types and widths, grid;
  - save and open;
  - DXF import and export (R12 and 2000+ subset, documented).
- **M2 Dimensions and sheets:**
  - dimensions: linear, aligned, angular, radius, diameter, ordinate;
  - tolerances and ISO 286 fits; surface texture symbols; GD&T frames;
  - notes and balloons;
  - sheets A4–A0 with frame, zones and an ISO 7200 title block;
  - views at standard scales;
  - vector PDF export at true scale.
- **M3 Parametric sketches:**
  - constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, symmetric,
    fixed, distance, angle, radius;
  - driving dimensions;
  - degrees-of-freedom colouring;
  - conflicts explained in plain words.
- **M4 3D parts:**
  - sketch on a plane;
  - features: extrude, revolve, cut, hole (ISO clearance and tapped holes), fillet, chamfer, shell,
    mirror, pattern;
  - a feature tree; edit any parameter and the part rebuilds;
  - a material library with density and its source; mass, volume and centre of gravity;
  - section view and measuring in 3D;
  - STEP and STL/3MF export, STEP import.
- **M5 Drawings from 3D:**
  - front, top, side and isometric views, first or third angle;
  - section and detail views, hidden lines, centre lines and marks;
  - the views stay linked: change the part and the drawing updates; a dimension that lost its geometry
    is flagged.
- **M6 Library and assemblies:**
  - standard parts as parametric data with sources: ISO 4762 screws, ISO 4032 nuts, ISO 7089 washers,
    ISO 15 bearings, common aluminium profiles;
  - simple assemblies: place parts and mate them (coincident, concentric, distance, angle);
  - interference check;
  - BOM with part numbers, a BOM table on the drawing, exploded view.
- **M7 Checks and AI:**
  - the drawing checker (rule 6) with a warnings banner and fixes;
  - the optional AI assistant:
    - providers: Claude, OpenAI or Gemini with the user's key, called only from the main process;
    - it sees the model, sketches, dimensions and check results;
    - tools to read the model, measure, run the checks and propose commands, for example "make the
      plate 5 mm thicker", "add four M6 clearance holes on an 80 mm square", "check this drawing for
      manufacture";
    - each proposal shows as a highlighted preview with Accept / Reject and goes into undo;
    - tested against a fake provider in CI; a test against a real key is written but skipped until a
      key is set.
- **M8 Release:**
  - release builds from a git tag: macOS dmg (arm64 and x64), Windows installer, Linux AppImage
    (unsigned at first, ready for signing);
  - the website (below), with screenshots from the real app;
  - docs: getting started, the file format, DXF and STEP notes;
  - end-to-end tests of every main workflow;
  - a launch checklist.

## Website (generated from the repo into /site, static, English and Italian)

- **Landing page for engineering companies:**
  - what the app does, in one sentence;
  - real screenshots and a short clip;
  - "free and open source, runs on your computer, your files stay yours";
  - DXF, STEP and PDF compatibility;
  - download buttons per OS;
  - an honest comparison with the tools they know, with no claim we cannot back.
- **"For companies" page:** support, training and custom features, with a contact link.
- **Also:** docs, changelog, GitHub link.
- **SEO pages generated from the library:** one page per standard part with its dimensions and source,
  plus short guides (ISO fits explained, first vs third angle).
- **Performance and privacy:** fast pages, no tracking without consent.

## Open source

- Apache-2.0 LICENSE and NOTICE; THIRD_PARTY_LICENSES generated at build time.
- CONTRIBUTING with DCO sign-off, CODE_OF_CONDUCT, SECURITY.md.
- Issue and PR templates, good-first-issue labels.
- A "contribute in 30 minutes" section in the README.

## Conventions

- TypeScript strict; no `any` in `/shared`, `/app/main` or `/app/workers`.
- Every user-facing string goes through `t()` with an Italian entry, enforced by a test.
- Geometry and file-format code has unit tests; every bug fix gets a test.
- Secrets never go in the renderer or in git.
- UI text is for professionals, in plain words.

## Decisions already made (do not ask again)

- **Name:** MechPilot (repo `mojeee/mechpilot`, npm name `mechpilot`). Public on GitHub from day one.
- **Copyright holder:** Mojtaba Amini (LICENSE, NOTICE, title-block defaults, About box). Do not publish
  any email address. Companies get in touch through GitHub Discussions and issues; the "For companies"
  page links there.
- **Website:** https://mechpilot.agentflowbind.com, a static site built into `/site` like BoardPilot's
  (Cloudflare Pages serves it; I will connect the repo myself). Use that URL for canonical links,
  sitemap and Open Graph tags.
- **AI models:** Anthropic default `claude-sonnet-5-5`, fast model `claude-haiku-4-5-20251001`; OpenAI and
  Gemini through `fetch` like BoardPilot. No API key is available yet: build and test the assistant
  against a fake provider; a test with a real key comes later and must be skipped when no key is set.
- **Theme:** dark UI like BoardPilot, with a light theme; the drawing canvas can be dark or white, and
  print preview is always white.
- **3D kernel:** start with replicad (on top of opencascade.js). Switch to opencascade.js directly only
  if replicad blocks a feature, and record why in `docs/decisions.md`.
- **Sample projects:** a mounting bracket (2D drawing with fits and tolerances), a stepped shaft with a
  bearing seat (3D part and its drawing), a sheet-metal cover (3D with bends and flat pattern later),
  and a small bearing-housing assembly with a BOM (M6).
- **Scope:** build every milestone, M0 to M8, one after the other, without stopping for review. End
  each milestone as described (runs, tests pass, sample works, CHANGELOG, one commit) and push it.
- **When you would have to ask me:** if the question is only a choice between reasonable options,
  choose the conservative one, write it with your reasons in `docs/decisions.md` and carry on. Small,
  well-maintained dependencies under MIT, Apache-2.0, BSD or ISC need no approval; list each one with
  its reason in `docs/decisions.md`. Stop and ask only for a GPL or AGPL licence, a paid service,
  anything that writes outside the repository, or anything that publishes (releases, tags, posts).
- **Keep me informed:** after each milestone, add a short entry to `docs/progress.md` (what works, what
  is left, anything I must do by hand).

## Start here

1. Write CLAUDE.md from this brief and the decisions above (product, users, rules, stack, structure,
   conventions) and docs/roadmap.md with the milestones as checklists.
2. Build M0, then continue through M8 as described in the decisions above.
