# Security review follow-up — 2026-10-19

The supplied review was checked against the current working tree, preserving existing curriculum, exam and teaching-programme changes. Its three reproducible small defects were fixed, followed by the confirmed storage, indexing, connection and queue problems. No release was published and no real teaching data or live AI job was used for these regressions.

## Critical findings

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Invalid section PUT silently empties the file | Reject bodies without a string `contenido` with HTTP 400 before any write; an explicitly supplied empty string remains a valid edit | HTTP tests cover empty objects, null, arrays, null/boolean/number/object content and preservation after each rejection |
| Portable binary argument separator breaks platform selection | Ignore npm's standalone `--` separator | Regression invokes the actual script with `-- win --check`; local Pandoc and Typst SHA-256 checks pass |
| History section names allow path traversal | Apply the same safe-component validation before deriving history and imported-original paths | Direct-store and HTTP list/read/restore tests reject encoded slash, backslash, hidden names and Windows stream syntax; legitimate history stays readable |
| Unsigned silent updates | Disable install-on-exit. Enable the installed updater only on Windows when packaged configuration contains a nonempty signing publisher and verification is not disabled. Explicitly enable Windows signature verification in builder configuration. Other/unsigned packages use manual downloads | Pure policy tests and inspection of installed electron-updater 6.8.9 signature verification; no signed production installation was exercised |

The installed updater's NSIS implementation returns without signature verification when `publisherName` is absent. The new policy closes that configuration path; it does not create a signing certificate, rotate keys, or prove existing releases are signed. Signed Windows packages retain the updater's certificate verification and require an explicit installation action. macOS/Linux and unsigned packages now use manual release downloads until their update trust policy is qualified. See the [version-26 Windows signing documentation](https://www.electron.build/v26/docs/win/).

## Storage and recovery

- Subject/document metadata updates serialize the whole read/modify/write operation across store instances in one server process. Context text uses atomic replacement.
- Section creation, reads, writes, deletion and reordering share a directory lock. Concurrent identical headings receive distinct numbered files.
- Reordering records a durable staging/publishing journal before renames. The first subsequent section operation completes an interrupted transaction. Conflicts fail closed and retain the journal/files. Duplicate order entries are rejected.
- Recognized legacy `.tmp-N-<section>.md` files are recovered without overwriting a visible destination. Colliding texts receive a visible recovered name; unrelated hidden files are not listed or deleted. This is recovery, not blind temporary-file cleanup.
- Section summaries include a file revision stamp. Complete-notes rendering reuses unchanged content and bounds read concurrency; stale effect results cannot publish after navigation.

Regression coverage includes 12 simultaneous section creations, crashes during both journal phases, legacy collision recovery and reordering after recovery. Locks are process-local; direct external edits and older application binaries do not participate. Close older application versions before upgrading or sharing a workspace with the new server.

## Indexing, connections and queues

- Source-cache JSON is written atomically. Concurrent indexing calls for the same folder share one in-flight operation within a process. Invalid cache JSON/shapes rebuild from the source. A source deleted between directory listing and stat is skipped and its stale cache removed. Separate MCP/server processes can still duplicate extraction work, while atomic replacement prevents partial cache publication.
- WebSocket handling ignores invalid JSON/non-object frames, reconnects with capped exponential backoff and jitter, retains early job events, deduplicates bounded history and reconciles live frames with REST snapshots. A failed REST refresh retains known jobs. Tests cover event/snapshot merging and backoff; malformed frames were not injected over a live socket.
- Token budgets are checked again immediately before each queued process starts, including restored jobs. This stops later queued work after the recorded threshold; it is not a strict reservation or preemption system. Already running jobs may overshoot.
- Server exclusivity uses an OS-owned loopback lease keyed by canonical job-directory identity instead of trusting a persisted PID. The lease is automatically released on process death and explicitly released on close/startup failure. Its deterministic local port can conflict with an unrelated listener; that case fails safely rather than stealing ownership. Tests cover simultaneous ownership, release/restart and stale PID files.
- Queue recovery no longer kills a live persisted PID whose identity cannot be established. It records an actionable error rather than killing an unrelated process or silently duplicating an uncertain old session. A fake-engine restart test verifies session continuation and that a reused live PID survives.

## Additional changes and review corrections

- Unexpected HTTP 500 responses use a generic message; detailed errors remain in server logs. A regression verifies that corrupt document metadata does not expose its underlying error to the client.
- Notices have a polite live region; exam icon buttons have explicit accessible names. Applied the `frontend-accessibility-best-practices` skill.
- Added ignored `output/`, `tmp/` and root `.qa-*.mts` paths. Existing evidence is retained locally.
- Main and MCP compilation targets now match the Node 24 minimum.
- Added macOS to the checks matrix. The current `macos-latest` runner is ARM64, matching the helper's macOS binaries; see [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). This configuration was not run on hosted CI during this task.
- The five map-data tooling packages named in the review were already development dependencies. No dependency move was necessary. Actual Word/ODT/PDF export regressions also already existed in the current tree; the review's coverage statement was older than this checkout.

Broader cleanup remains separate: splitting the large route module, unifying agent-result loaders with deliberately different retry policies, introducing API-wide cancellation, collection pagination, font chunk placement, a controlled audit exception policy, and reconciling js-yaml type declarations. No dependency or audit gate was weakened for those suggestions.

## Validation and limits

- `npm run typecheck`: passed.
- `npm test`: **146 passed, zero skipped**.
- `npm run build`: passed, web and Electron/MCP bundles.
- `npm audit --audit-level=low`: **0 vulnerabilities**.
- `node scripts/fetch-bin.mjs -- win --check`: Pandoc 3.12.1 and Typst v0.15.1 SHA-256 verified.
- Isolated Chrome QA opened four fictional sections in complete-notes view. One simulated agent save updated Section 3 while the other three remained visible; no console errors/warnings were observed. The pure cache regression separately verifies that only one changed revision requires a new read. Browser request counts were not retained.

Full portable installer packaging, signed update download/installation, hosted CI, macOS/Linux runtime behavior and screen-reader behavior were not qualified here. No claim of release readiness or production signing follows solely from the local checks.
