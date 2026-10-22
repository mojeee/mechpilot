# MechPilot

Open-source 2D/3D mechanical design for machine builders, fabrication shops, fixture designers and
small engineering offices: production drawings to ISO standards, with 3D parts built in. Free,
local-first, no account, no cloud. Your files stay yours.

Website: https://mechpilot.agentflowbind.com · Licence: Apache-2.0 · Status: in development,
milestone by milestone (see [docs/roadmap.md](docs/roadmap.md) and [docs/progress.md](docs/progress.md)).

## What it does (and will do)

- **2D first.** Draw, dimension and annotate production drawings to ISO 128, ISO 129-1, ISO 7200,
  ISO 1101, ISO 286 and ISO 21920-1 (ASME as an option), on sheets with frames and title blocks.
  Export vector PDF and DXF.
- **3D where it helps.** Turn a sketch into a part (extrude, revolve, holes, fillets), change a
  parameter and the part rebuilds, and the drawing views follow. STEP in and out.
- **Checks on every change.** Under-constrained sketches, missing dimensions, fits that do not
  exist, empty title-block fields, each with a one-click fix.
- **Honest, optional AI.** An assistant with your own API key that proposes changes as a preview
  you accept or reject, and cites its sources. The app is fully usable without it.

Milestone M0 (scaffold) is done: the app runs with its main layout, draws lines and circles,
saves and opens its own format, and ships a sample. Drafting, dimensions, sheets, sketches, 3D and
the rest arrive with M1 to M8.

## Run it

```bash
npm install
npm run dev
```

Requires Node 24. `File > Open sample > Mounting bracket` loads the sample project. Type `L` for a
line, `C` for a circle, `U` to undo, `ZE` to zoom to extents; points can be typed as `10,20` or
`@50,0` (relative to the last point).

## Contribute in 30 minutes

1. `git clone https://github.com/mojeee/mechpilot && cd mechpilot && npm install` (about 5 min).
2. `npm run dev` and open the sample project to see what exists.
3. Pick an issue labelled `good first issue`, or fix a translation in `shared/i18n/it/`, or add a
   library value with its source under `library/`.
4. `npm run typecheck && npm test && npm run check:licenses && npm run check:library` (about
   1 min). Add a test when you touch geometry or the file format.
5. Add a line under "Unreleased" in `CHANGELOG.md`, commit with `git commit -s` (DCO sign-off),
   open a pull request.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the rules and [CLAUDE.md](CLAUDE.md) for the product
rules and the architecture. Questions and ideas: [GitHub Discussions](https://github.com/mojeee/mechpilot/discussions).

## Repository layout

| Folder | What |
| --- | --- |
| `app/main`, `app/preload`, `app/renderer`, `app/workers` | the Electron app: main process, typed bridge, UI, workers |
| `shared/` | types, geometry, the document model, the command layer, the file format, i18n |
| `library/` | standard data (line types, later title blocks, fits, materials, parts) with sources |
| `samples/` | sample projects shipped with the app |
| `docs/` | brief, roadmap, decisions, progress, file format |
| `site/` | the generated website |
| `tests/`, `e2e/` | unit tests (Vitest) and end-to-end tests (Playwright) |

## Licence

Apache-2.0, copyright Mojtaba Amini. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party
licences are listed in `THIRD_PARTY_LICENSES.md`, generated at build time; no GPL or AGPL
dependencies are accepted.
