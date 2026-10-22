# Workers

Heavy work runs off the UI thread (product rule 8) in Web Workers that talk to the renderer through
the typed protocol in `shared/worker-protocol.ts`: one request kind per operation, a promise with a
timeout on the renderer side, errors as `{ code, message }`.

| Folder | What | Licence of the engine | Since |
| --- | --- | --- | --- |
| `smoke/` | ping and a CPU burn, to prove the harness | none | M0 |
| `solver/` | sketch constraints through planegcs (FreeCAD's solver as WebAssembly) | LGPL-2.0-or-later | M3 |
| `kernel/` | B-rep solids, STEP, hidden-line projection through replicad on opencascade.js | LGPL-2.1 (OCCT) | M4 |

The LGPL engines are used only here, as separate and replaceable modules: the rest of the app
depends on the worker protocol, never on the engine's API. Each folder ships the engine's licence
notice, and `scripts/lgpl-allowlist.json` names the packages the licence check accepts.
