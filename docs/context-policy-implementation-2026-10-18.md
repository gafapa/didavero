# Production context policy — 2026-10-18

## Implemented behavior

The application now performs exact context selection locally before launching selected agent tasks. This is the first production slice of the procedural-search decision; it does not introduce vector retrieval, additional agents, automatic answer reuse, or model-written search programs.

### Role-specific instructions

Research, outline planning, exams, glossary, diagnosis, and visual planning use a compact system profile. Role instructions, including user customization, remain intact. Task output schemas, language, file scope, calculation checks, source integrity, and complete-scope reading instructions remain explicit. Detailed chart/map rendering schemas are retained for authoring, editing, illustration, transcription, and general chat, where they can be needed.

### Selected sections

`server/contextSelection.ts` reads only explicitly requested section files and deduplicates their filenames. Each included section is complete. Whole section bodies are packed within a 90,000-character budget; every deferred section remains in an explicit manifest with its path and length. A large section no longer prevents smaller sections from being included. Missing files reject preparation rather than disappearing silently. The manifest instructs agents to read every deferred section before making complete-scope conclusions. It is not a server-side proof that an agent followed that instruction.

### Exam adaptations

`server/examContext.ts` supplies all fields of selected questions, including solutions and rubrics. Other questions retain their inputs and shared material, but omit four grading-prose fields: solution, explanation, rubric, and frequent errors. They remain available as context, preserving cross-question input references. The task points to the saved exam snapshot for any dependency on omitted grading details. Existing server validation and merging still preserve exact unselected questions, source snapshots, points, IDs, criteria, types, and independent exports.

### Sources and fallback

Inline source retrieval uses the same explicit source-folder scope as the launched task and honors the source permission/disable flag. A long research dossier with no matching fragments falls back to actual source text with an explicit deferred-read notice. Oversized glossaries also expose the omitted remainder instead of presenting their prefix as complete. Retrieval instructions distinguish targeted lookup from exhaustive reading.

### Long curricula

Planning, curriculum review, diagnosis, and exam generation no longer silently cut off active curriculum text after 30,000 or 40,000 characters. Small contexts remain inline. Large contexts are captured through the existing atomic writer in a content-addressed `.agentes/curriculum-<sha256>.md` file under the subject. The inline preview ends at a paragraph boundary and supplies a path relative to the task's working directory, the full character count, and an explicit requirement to read the complete snapshot before selecting criteria or concluding coverage. Concurrent preparations use complete atomic writes. A changed version gets a new filename; previous task references remain valid. Snapshots currently follow the existing `.agentes` artifact lifecycle and are not automatically pruned.

## Measurements

Run `node --import tsx scripts/measure-context-policy.mts`. It calls the production prompt and exam-context builders using synthetic inputs and writes `output/context-policy-2026-10-18/measurements.json`. It makes zero inference calls.

Compact system instructions are 56.4–77.7% shorter in characters for the six selected roles. An illustrative twenty-question exam adapting two questions reduces source JSON payload from 37,636 to 5,381 characters (85.7%). The exam fixture has substantial repeated grading prose; it is not representative of every exam. Task wording, recovery pointers, provider overhead, and extra reads are excluded from that payload comparison. These are character measurements, not actual token savings or a forecast of application-wide consumption.

The earlier procedural evaluation remains a synthetic exact-fact benchmark. Its measured token reductions cannot be transferred directly to these production flows. Complete-scope reads may consume as much context as before, and fixing a previously missing tail may legitimately increase consumption. Educational quality and instruction-following still need real-flow evaluation with synthetic or explicitly approved material.

## Validation

Regression coverage verifies exact section content, deferred tail visibility, selected-only disk reads, source-folder isolation, disabled-source behavior, no-hit fallback, custom role instructions, unchanged authoring schemas, shared exam inputs, original grading preservation, snapshot paths, concurrent snapshot creation, and changed curriculum versions. Existing exam adaptation integration coverage still exercises all three variants and independent exports.

Commands: `npm test`, `npm run typecheck`, `npm run build`, and `node --import tsx scripts/measure-context-policy.mts`. No real teaching documents were sent to inference during this implementation.

Final checks: 90 tests passed, zero failed; application type checking and standalone checking of the new test/measurement script passed. The web build and final main-process build passed. The running local API returned `{"version":"en vivo"}` after the changes; this verifies availability, not a live model-generation outcome.
