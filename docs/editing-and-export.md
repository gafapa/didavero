# Editing and export reliability

## Implemented behavior

Note section saves run in request order. A slow earlier request cannot finish after a newer write and replace it. The saved indicator describes the current text, rather than merely the last completed request. Manual save is available while changes are pending. Switching sections, reordering or deleting sections stops when saving fails or more edits arrive during the save.

Loading a section makes its CodeMirror instance read-only until the response arrives. Obsolete section-load responses are ignored. The editor applies read-only changes dynamically and gives its content an accessible name.

Leaving the note editor flushes its debounce. Note export waits for the registered flush before reading section text or preparing diagrams. Failed flushes block export instead of producing an older document silently. Outstanding writes share a document-scoped queue across editor mounts.

Exam preview/export options update the preview immediately. Saves carry complete option snapshots and run serially. PDF, DOCX, ODT and Moodle export wait for the option-save queue. Failed option saves retain the local preview, show an error and offer **Reintentar guardado**. Export remains blocked by that failure until a subsequent save succeeds. Option controls are disabled during export.

## Validation — 2026-11-02

- Type checking and application web/Electron/MCP builds passed.
- The complete suite passed: 160 tests, zero failures or skipped tests.
- New regressions cover delayed write ordering, export waiting for additional queued snapshots, failed writes, explicit retry and editor-departure flushes.
- An isolated Electron/Chromium session used fictional notes and an exam, with deliberately delayed network writes. Both consecutive note edits reached disk; an edit made immediately before leaving the editor was also persisted. The exam export request began after the option PUT completed, and actual Word exam, answer-key and rubric files were produced. The answer-space option was read back from the server.
- Desktop and 1024-pixel window screenshots were inspected. The measured document width matched the viewport at the narrower size; no renderer console errors were recorded in the successful flow. This does not establish mobile or screen-reader qualification.

Local QA receipts and screenshots are retained under `output/editor-save-qa-*`. They contain fictional data only. No model call, production teaching data or publication was involved. The approved website installer is unchanged and does not include these source changes until a new release is built and approved.

## Next development priorities

1. Extend the same save/flush contract to the exam preparation form and other editable metadata. That form currently marks its debounce snapshot before the request succeeds and cancels its timer when unmounted; switching away quickly can therefore leave configuration unsaved.
2. Add recoverable local drafts for reload, offline operation and application shutdown. The current in-memory save barrier cannot guarantee completion after the process has closed or crashed.
3. Add optimistic revision checks to note/exam editing APIs. Ordered requests from one editor do not prevent another window, application version or agent from overwriting a newer edit.
4. Expose failed diagram/molecule/block conversion as an actionable export summary. The existing converter logs failures and the server can substitute placeholders; users need a clear choice before publishing incomplete visual material.
5. Add a discoverable Markdown editing toolbar and search/replace workflow while retaining the current document format and preview/export parity.

Broader application work remains separate: reusing programmes against a different curriculum version, qualifying signed updates and platform distributions, and validating additional live authoring scenarios. These are not prerequisites for using the locally tested editing improvements.
