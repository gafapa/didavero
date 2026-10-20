# Didavero

A desktop workspace for preparing curriculum-linked notes, exams and teaching programmes with AI assistance and teacher review.

Website: https://didavero.com
Repository: https://github.com/gafapa/didavero

## Current distributions

The working tree is `0.7.0-beta.1`, a Didavero Windows portable preview. The older public GitHub `v0.6.0` releases retain their Apuntes IA names and do not include all current curriculum/programme features. See the website download section for exact versions, platform availability and checksums. No signed-installer or cross-platform qualification is implied by a local Windows build.

## Features

- Subject context, personal sources, glossary and reference templates.
- Structured curricula with provenance, editable drafts, immutable activated versions, branch review, drag-and-drop movement and source dialogs.
- Notes with research, outlines, parallel authoring, review, visual resources and export.
- Exams with solutions, rubrics, optional answer space and separately editable adaptation proposals.
- Teaching programmes driven by researched stage/territory/subject requirements, with curriculum-linked units and activities.
- Source indexing and bounded relevant-excerpt retrieval, respecting subject/document permissions.
- Configurable Claude Code, Codex and OpenCode engines, models and effort.
- Local data folders, backups, revision checks, optional presentation controls and document exports.

Generated material requires review. Provider/model availability, token costs and subscriptions depend on the tools and account configured by the user. Local storage does not mean that AI processing is local, encrypted automatically or suitable for identifiable learner data.

## Development

Use Node.js 24 or newer.

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

`npm run app` opens the live Electron app using existing installed settings/data. Close another app instance using those folders first. `npm run dev` uses a separate development folder. The legacy `APUNTES_*` environment variables remain supported.

## Desktop builds

```sh
npm run build
npm run fetch-bin
npm run dist:portable
```

Pandoc and Typst are checksum-verified build resources. Windows portable output is `release/Didavero-portable.exe`; platform-specific installer names are configured in `electron-builder.yml`. Signing requires a configured publisher/certificate. Unsigned builds use manual downloads; supported signed Windows updates require an explicit install action.

The established Electron application ID is retained for upgrade compatibility. Existing Apuntes IA settings, documents and portable folders are reused when present; new folders use Didavero. No rename migration deletes or moves user files. See [the website and rename notes](docs/didavero-website.md).

## Website

```sh
npm run build:site
node scripts/verify-site.mjs
```

The generator uses `website/` and emits the public tree to `output/didavero-site/`. The production build requires the exact portable artifact whose digest is recorded in `website/site.config.json`. Spanish/English pages include legal notice, privacy, cookies/storage, AI transparency, usage terms, contact and accessibility. Fonts and product screenshots are self-hosted; no browser analytics or persistent browser storage is used. Server logs and internal technical reports are disclosed separately.

Publishing targets the existing s1 static-site service on Oracle Cloud. Follow its canonical inventory/runbooks in `D:/gallego.top`; never copy credentials into this repository. Website notices are not a GDPR or AI Act conformity certificate. See [deployment and legal scope](docs/didavero-website.md).

## Documentation

- [Structured curricula](docs/structured-curriculum.md)
- [Teaching programmes](docs/teaching-programmes.md)
- [Unit and activity planning](docs/programme-unit-planning.md)
- [Source management](docs/source-management.md)
- [Exam adaptations](docs/exam-adaptations.md)
- [AI engines](docs/engines.md)
- [Security review follow-up](docs/security-review-follow-up-2026-10-19.md)

## Licence

MIT. See [LICENSE](LICENSE). Third-party components and bundled font licences retain their own terms.
