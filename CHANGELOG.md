# Changelog

All notable changes to MechPilot. The format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

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
