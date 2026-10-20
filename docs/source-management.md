# Source management

Subject and Notes source managers share a compact, filterable file list. Each row shows its filename, size and text-search availability, with visible edit and delete controls. Selecting the filename opens a details dialog showing its modification time, index information and a link to the original file.

**Añadir fuentes** opens a multi-file picker/drop zone with an explicit upload action. **Editar nombre** renames the stored file while retaining its extension. The server rejects invalid names, destination collisions and edits made against an older modification timestamp. The rename copies to an exclusively created destination before removing the original, so a failed copy cannot discard the source or overwrite another file. File bodies are not edited by the rename action. To edit file contents, use the original document's editor and the source folder. Changes to an original file can make previously authored filename citations outdated; existing authored documents are not rewritten automatically.

Web source discovery and indexed material search open in separate dialogs. Deletion requires confirmation and updates the list. Index preparation follows mutations, so renamed source references are available to subsequent searches. Errors remain visible, loading failures can be retried and closing a dialog with pending edits requires explicit discard. Keyboard focus and modal stacking use the shared dialog component.

The HTTP regression exercises both subject and Notes scopes, upload/list/rename/delete, content preservation, collisions, invalid and stale edits, concurrent renames and refreshed index filenames. No real AI calls or personal data are required.
