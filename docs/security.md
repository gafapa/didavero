# Security and data integrity

This guide consolidates the October 2026 security reviews into the maintained implementation contract. Source and regression tests are authoritative; earlier test totals and dependency-audit results were historical snapshots, not continuing guarantees.

## Storage and recovery

`server/atomicFiles.ts` serializes atomic file replacement. Missing state and corrupt state are distinct; invalid input must not replace valid content. Metadata read/modify/write operations share process-local locks. Creation reserves directories atomically, and shutdown flushes delayed queue/token state.

Section operations share a directory lock. Reordering records a durable staging/publishing journal and completes interrupted work on the next section operation. Duplicate entries and conflicting recovery states fail closed. Recognized legacy temporary sections are recovered without overwriting visible files. Cleanup must not delete those files or journals.

Archive imports validate original paths, Windows streams, symlinks and expanded sizes. Defaults cap entries at 10,000, each file at 200 MiB and total expansion at 1 GiB. Restore validates metadata, extracts into staging, publishes metadata last and rolls back owned destinations on reported failures. Uploads are staged and rejected when truncated; duplicate backup/import files are rejected. Data-file serving verifies the real target remains within the data root.

Atomic files do not make every multi-file operation power-loss atomic. Process-local locks do not coordinate external editors or older application versions. Close older versions before sharing their workspace with this server.

## Network and desktop boundaries

Public downloads validate and pin DNS answers, recheck redirects and enforce limits while streaming: 40 MiB for source documents, 20 MiB for images and 5 MiB for thumbnails. Private destinations remain blocked even when an official hostname resolves to them. Public content is still untrusted input.

HTTP/WebSocket access checks loopback host/origin and Fetch Metadata. Production responses include CSP and security headers. Electron navigation compares exact origins; Windows file opening avoids shell parsing. Unexpected HTTP 500 responses expose a generic client message while server logs retain details. Engine/profile lookup requires own keys.

## Jobs, indexes and connections

The server owns a loopback lease keyed by canonical job-directory identity. Conflicting ownership fails safely; stale PIDs are not trusted as identity. Queue recovery never kills a live process whose identity is uncertain. Token limits are checked immediately before queued/restored jobs start; they do not preempt running work or reserve its eventual usage.

Source-cache files are written atomically. Concurrent indexing shares in-flight work within a process; damaged caches rebuild from source and deleted sources lose stale cache entries. Separate processes may duplicate extraction. WebSocket recovery bounds and deduplicates history, merges REST snapshots and retains known jobs after failed refreshes. Invalid frames are ignored; reconnect uses capped backoff and jitter.

## Distribution and updates

Pandoc/Typst downloads require release SHA-256 digests and cached per-binary manifests. Check local resources with `node scripts/fetch-bin.mjs -- win --check` (select the appropriate platform). CI pins actions, disables persisted checkout credentials and checks types, dependencies, tests and builds. Release jobs keep artifacts in draft until all configured platform jobs pass.

Release preparation updates compatible dependencies and retains the full low-severity audit gate. The dependency lock uses patched `glob` (14.0.3 or later for consumers of version 9+) and `minimatch` (11.0.4 or later). ASAR is pinned to 4.0.1, whose modern glob API avoids the legacy crawler's incompatibility with the patched matcher. One build-tool import still expects minimatch's older callable export: `scripts/patch-build-dependencies.mjs` adapts only the known import in `dir-compare` 4.2.0 during installation. It checks the exact version and source text and fails closed when either changes. The official patched matcher performs the work; no advisory is suppressed. `tests/packaging-dependencies.test.ts` checks archive contents, real ASAR unpacking and directory include/exclude behavior, while platform release jobs qualify actual packages. These build tools use the existing Node 24 minimum.

Relevant upstream advisories: [Electron certificate mitigation](https://github.com/advisories/GHSA-jr5w-w6x2-84p9), [glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). Audit results remain point-in-time evidence.

Install-on-exit is disabled. Installed updates are enabled only for packaged Windows builds with a nonempty signing publisher and signature verification enabled. Installation requires an explicit action. Unsigned and other-platform packages use manual downloads. These policies do not supply a certificate or establish that existing artifacts are signed.

## Regression evidence and limits

Relevant suites include `security.test.ts`, `review-regressions.test.ts`, `section-summary.test.ts`, `frontend-recovery.test.ts`, `cola.test.ts`, `source-management.test.ts` and the curriculum/programme persistence suites. Run the checks in [Repository maintenance](maintenance.md); use `npm audit --audit-level=low` for a fresh dependency check.

Local checks do not establish hosted CI, signed update installation, cross-platform runtime behavior, screen-reader qualification or model-generated document accuracy. Local storage does not imply offline AI processing or automatic encryption. Application access and configured provider permissions remain separate boundaries.
