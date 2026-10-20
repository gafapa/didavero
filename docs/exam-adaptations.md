# Exam adaptations

Open an exam with questions and choose **Vista previa y exportar → Versiones adaptadas → Crear versión adaptada**. Select the adaptation, the questions to change, and optional teacher instructions.

- **Lectura fácil:** shorter, clearer wording while retaining the assessed content and difficulty.
- **Con apoyos:** instructions broken into steps and textual support for organizing answers, without revealing solutions.
- **Ampliación:** deeper reasoning about the same content, retaining the original scoring.

Generation uses the configured examiner agent and engine. Each request creates an independent exam with a reference to its source and an immutable question snapshot. Changes to either exam do not propagate to the other. Uploaded source files are copied; previously exported files are not.

The agent receives complete selected questions and the other questions' inputs for shared context. Unselected solution, explanation, rubric, and frequent-error prose is omitted from the initial prompt. The saved snapshot remains available for dependencies that require those details. Context preparation uses local code without an additional model call.

The server requires exactly one valid result for every selected question and preserves question IDs, types, order, points, assessment criteria, source references, and answer-space settings. Unselected questions are copied unchanged. Generated open questions must include a model answer and rubric; rubric scores are normalized to the original question score. Incomplete results remain unavailable for preview or export until corrected through the existing agent retry flow. A startup failure leaves a visible failed copy that can be deleted; create a new adaptation from the source to try again.

Once ready, review and edit the copy using the usual question editor. It has its own exam preview, answer key, rubric, PDF/Word/LibreOffice exports, Moodle export, and optional model B. Return to the source exam to generate another adaptation. Teacher review is necessary: structural validation does not prove that generated content preserves educational difficulty or avoids answer cues.

Use **Comparar con el original** in an adapted exam to compare a question's wording, answer key, or rubric with its saved source snapshot. The comparison includes subsequent edits to the adapted copy and still works when the source exam has changed or been deleted. Deleted questions remain visible on the original side. Newly added questions have no source counterpart and are reviewed through the regular question editor.

Do not include personal student information in the optional instructions. Adaptation generation has the same data handling as other examiner tasks.

Validation: `npm run typecheck`, `node --import tsx --test tests/exam-adaptations.test.ts tests/examenes.test.ts`, and `npm run build`.
