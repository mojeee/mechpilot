# Contributing to MechPilot

Thanks for helping. The most valuable contributions, in order of how easy they are:

1. **Bug reports** with the steps, your OS, and the `.mechpilot.json` or DXF file that shows the
   problem (strip anything confidential first).
2. **Library data**: standard parts, materials, title blocks and line types live in `library/` as
   JSON with their `source` (standard and clause, or catalogue). `npm run check:library` validates
   them. Never add a table value you cannot verify: list it in `docs/to-verify.md` instead.
3. **Italian and English texts**: every UI string is in `shared/i18n/it/*.ts` (English is the key).
4. **Code**: see below. Issues labelled `good first issue` are a good start.

## Code

```bash
npm install
npm run dev
npm run typecheck && npm test && npm run check:licenses && npm run check:library
```

- TypeScript strict; no `any` in `shared/`, `app/main/` or `app/workers/`.
- The document model is pure data in `shared/doc`; every edit is a command with do/undo in
  `shared/commands`. The UI never mutates the document directly.
- User-facing text is short and plain, and goes through `t()` with an Italian entry (the i18n test
  enforces it).
- Geometry and file-format code has unit tests; every bug fix gets a test.
- Every rule and table value from a standard cites the standard and clause in a comment.
- No GPL or AGPL dependencies. LGPL only as a separate module under `app/workers/` with its notice.
- Read [CLAUDE.md](CLAUDE.md) for the product rules and the architecture.

## Developer Certificate of Origin

Every commit must be signed off (`git commit -s`), which adds a `Signed-off-by:` line stating that
you agree to the [Developer Certificate of Origin 1.1](https://developercertificate.org/): you wrote
the contribution or have the right to submit it under the project's licence (Apache-2.0).

## Pull requests

- One topic per pull request, with a short description of what changed and why.
- CI must pass: typecheck, unit tests, licence check, library check, build.
- Add a line to `CHANGELOG.md` under "Unreleased".
