# Context selection policy

Targeted lookup uses scoped local lexical retrieval; tasks with known inputs use exact structural selection. Extraction, transcription, diagnosis and coverage review must account for their complete relevant scope. A top-k match is not evidence of completeness. No vector store, learned compressor, automatic answer reuse or extra runtime reviewer is implied.

Research, outline, exam, glossary, diagnosis and visual-planning roles use compact system profiles. Customized role instructions retain their precedence. Authoring, editing, illustration, transcription and general chat retain detailed graphical schemas where needed.

`server/contextSelection.ts` reads only explicitly selected, deduplicated section files. Whole sections fit into a 90,000-character packet; deferred sections remain in a manifest with paths and lengths. A large section does not exclude smaller ones. Missing files reject preparation. Agents must read deferred material before complete-scope conclusions; the manifest cannot prove they complied.

`server/examContext.ts` includes all selected-question fields, solutions and rubrics. Other questions retain input/shared material but omit grading prose (solution, explanation, rubric and frequent errors). The captured exam remains available for dependencies. Postprocessing preserves unselected questions, IDs, points, criteria and immutable snapshots.

Inline sources use the task's permitted folders and source-disable flag. No-hit long dossiers fall back to actual source text with an explicit deferred-read notice. Oversized glossaries expose omitted scope. Large curricula are atomically captured in subject `.agentes/curriculum-<sha256>.md` snapshots with a paragraph-boundary preview, full length and task-relative path. Changed content gets a new name; earlier task pointers stay valid. Repository cleanup must not prune these user-workspace snapshots.

## Measurement and evidence

```sh
node --import tsx scripts/measure-context-policy.mts
```

This calls production prompt/context builders with fictional inputs and makes no inference calls. It writes `output/context-policy-2026-10-18/measurements.json`. The original fixture measured 56.4–77.7% shorter role instructions and 85.7% less exam-source JSON when adapting two of twenty questions with repeated grading prose. These are character counts excluding task/pointer/provider overhead, not token savings or representative application-wide estimates.

The retained 2026-10-18 evaluation compared 88 local exact-fact cases: full context and structural selection retained all required facts in 88/88 cases; prefix truncation passed 64/88, unfiltered top-6 BM25 32/88 and scoped top-6 BM25 56/88. The selected task policy passed 88/88. Complete reading and targeted discovery need different strategies.

A separate 18-call Codex exact-copy battery (`gpt-6.1-sol`, low effort, one sample per condition) retained 80/80 facts using full context or structural selection. Top-6 scoped BM25 retained 20/80. The combined task policy used 97,310 input tokens versus 133,387 for full context (27.05% fewer in that fixture), with 2,621 output tokens for each. Inputs include reported cached tokens. This is a constrained synthetic copying result, not evidence of educational quality, legal completeness or production savings. Claude attempts were blocked by quota and did not qualify that engine.

## Retained evaluation tools

| Tool | Purpose |
| --- | --- |
| `scripts/evaluate-context-strategies.mts` | Offline selection cases; optional `--live --engine=codex --max-tokens=400000` model battery |
| `scripts/summarize-context-evaluation.mts` | Aggregate retained context records |
| `scripts/evaluate-procedural-search.mts` | Deterministic procedural-search fixtures; optional `--live` inference |
| `scripts/evaluate-agent-evidence.mts` | Request fingerprints by default; optional `--live` behavioral probes |
| `scripts/measure-context-policy.mts` | Current prompt/context character measurements without inference |

Procedural-search and context-strategy raw results remain under their dated `output/` directories. In the separate procedural-search experiment, complete scope and predefined procedures passed 50/50 local cases; top-six scoped BM25 passed 10/50. Fifteen live exact-copy requests retained 47/47 facts for complete context and procedures versus 14/47 for BM25. Procedural input was 84,100 tokens versus 91,876 for full scope (8.46% fewer); exhaustive review and unknown-paraphrase fallback had no input saving. One sample per condition does not establish a latency advantage. This uses a predefined local search program, not a model-written algorithm. Do not combine its percentage with the earlier battery or transfer either to production.

Live modes spend provider quota and must be explicitly requested. They use fictional inputs, bounded requests and persisted fingerprints; cached request reuse is evaluation bookkeeping, not runtime answer caching. Use an independent output destination where supported for replication and retain previous evidence.

Relevant regressions cover selected-only disk reads, complete deferred tails, source isolation, disabled sources, fallback, custom instructions, exam dependencies and concurrent/changed snapshots. See [Agent evidence policy](agent-evidence-policy.md) for source attribution, behavioral probes and upstream licensing.
