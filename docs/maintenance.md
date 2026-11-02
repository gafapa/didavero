# Repository maintenance

This is the maintained source tree for Didavero. Start with the root README for installation, development and distribution commands. Project documentation, new identifiers and code comments are written in English; application translations are separate.

## Source layout

| Path | Purpose |
| --- | --- |
| `web/` | React interface, local preview renderers and bundled map assets |
| `server/` | Local HTTP/WebSocket API, storage, jobs, source retrieval and exports |
| `shared/` | Shared types, validation and curriculum/programme contracts |
| `electron/` | Desktop process, storage compatibility and update policy |
| `tests/` | Regression suites and reusable fictional fixtures |
| `scripts/` | Build, asset generation and reusable evaluation tools |
| `build/` | Required icon sources and packaging assets; keep this directory |
| `website/` | Canonical public website generator, assets and download metadata |
| `docs/` | Maintained feature, architecture, safety and evaluation documentation |

The initial Apuntes IA plan and handwritten `docs/index.html` have been superseded by the feature guides and `website/`. They are available in Git history. Historical release notes belong to the corresponding GitHub release; the repository documents the current implementation.

## Generated files and retained evidence

`dist/` and `dist-web/` are recreated by `npm run build`. `output/didavero-site/` is recreated by `npm run build:site`. Old unpacked applications, installer attempts, root `.qa-*` scripts/logs, temporary previews and `tmp/` are disposable after their useful findings have been recorded.

Do not remove `release/` indiscriminately: `website/site.config.json` identifies an exact approved installer by path, size and SHA-256. Preserve that file byte for byte. A newly compiled installer is not interchangeable with it. Other local installers and unpacked directories can be discarded when no running process uses them. `resources-bin/` contains checksum-verified export binaries used by builds and integration tests; `node_modules/` is the active dependency installation.

Retain the local evaluation directories under `output/agent-evidence-*`, `output/context-evaluation-*`, `output/context-policy-*`, `output/procedural-search-*` and `output/programme*-validation-*`, plus publication receipts. They contain request fingerprints, model receipts, source checks, generated examples and validation limits that cannot be recreated by an ordinary build. They are ignored local evidence, not files supplied by a fresh clone. Tests use committed fixtures instead. Historical evidence is not a current qualification result.

Application settings, documents, job journals, recovered sections and subject `.agentes/` snapshots are user state. They are outside repository cleanup. In particular, legacy application identifiers and `APUNTES_*` environment variables remain compatibility contracts.

## Cleanup status — 2026-11-01

The initial plan, superseded website, dated review documents, intermediate design-session records, session-specific programme recovery scripts and 38 root `.qa-*` files were removed after consolidating their useful information. The icon generator no longer creates the obsolete documentation favicon.

The remaining local cleanup is complete. Removed the obsolete `docs/icono.png`, old top-level installers/update metadata in `release/`, `release/win-unpacked*`, unused unpacked contents beside the approved preview installer, the duplicate `output/didavero-live-download.exe`, the root output source-manager fixture, `tmp/` and empty retired documentation/design directories. This follow-up removed another 166 files and approximately 1.75 GB of obsolete local artifacts.

The approved installer remains at the path configured in `website/site.config.json`; its size and SHA-256 were verified after cleanup. Current generated application/site output, active dependencies, export binaries and evaluation/publication evidence are retained. The preceding source cleanup passed type checking, 157 tests and application/site builds; the artifact-only follow-up verifies the website and approved download again without rerunning unchanged application tests.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run build:site
node scripts/verify-site.mjs
```

The website checks require the approved installer. Integration tests require the platform's Pandoc/Typst resources (`npm run fetch-bin`). These commands do not authorize publishing or live model calls. Packaging and hosted CI remain separate checks.
