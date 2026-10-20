# Context and token strategy evaluation — 2026-10-18

## Decision

Use different context strategies according to the operation. Keep local lexical retrieval for targeted discovery, add explicit document/version/course filtering, and use exact structural selection for operations whose input scope is already known. Complete extraction, transcription, diagnosis, and coverage review must account for every relevant section; a top-k retrieval result is not evidence of completeness.

Prioritize deterministic work, exact-identity caches, scoped tool responses, and capability-specific prompts before introducing another model, vector database, neural compressor, or additional reviewer agents. These are development decisions supported by the bounded evaluation below, not a claim that production routing has already changed.

The evaluation adds two reproducible scripts and persisted measurements. It does not modify application runtime code, application settings, teaching documents, or the active agent queue.

## What was inspected in the application

| Surface | Current behavior | Consequence |
| --- | --- | --- |
| Shared agent prompts | `server/agents/agentes.ts` gives most roles the same approximately 5,460–5,758-character system prompt, including graphical schemas and editorial rules | Text-only roles receive capabilities unrelated to their immediate work |
| Source retrieval | `server/rag.ts` uses local BM25/MiniSearch, fragment provenance, per-file extraction caches, and reusable in-memory indexes | Reuse the existing machinery; retrieval by itself does not enforce normative version or task coverage |
| Note drafting | `server/fases/escritura.ts` already supplies a section plan, a document map, selected sections, dossier retrieval, glossary, and source fragments | Improve selection and deduplication rather than replacing the whole flow |
| Shared references | `server/fases/base.ts` injects selected section text only while its total is at most 90,000 characters; above that threshold the inline section text is omitted and the agent must read files | Add an explicit coverage manifest and bounded reads instead of relying on implicit recovery |
| Global review and diagnosis | Review/diagnosis can receive many sections; curriculum context is sliced to 30,000 or 40,000 characters in several flows | Prefix limits can conceal tail content; structured selection or complete batching is needed |
| Exams | `server/fases/examenes.ts` assembles material up to 160,000 characters and supplies truncated curriculum context | Keep the full intended assessment scope while reducing unrelated material and repeated metadata |
| Exam adaptations | A source snapshot and selected IDs are available, but the task currently includes the complete source exam | Selected questions, their solutions/rubrics, scoring rules, and necessary dependencies can form a much smaller packet |
| Import | Local conversion and image extraction already exist; scanned or complex PDFs can still require model transcription | Preserve the local path and reserve model work for layout/OCR/structure that local conversion cannot resolve |
| Export and curriculum/source editing | Existing deterministic code performs rendering, validation, persistence, numbering, and source-reference changes | Continue without model calls |
| Engine usage | Claude and Codex are CLI/subscription engines, not a uniform direct-API billing surface | Measure reported input/output/cache tokens separately; do not infer quota or monetary savings from API prices |

The old performance benchmark was rerun without a historical checkout comparison: listing 80 sections took 98.99 ms cold and a 4.30 ms warm median; searching 1,200 source paragraphs took 145.05 ms cold and a 9.04 ms warm median. This measures local processing, not model-token savings.

## Internet strategies reviewed

1. **Task-scoped context and just-in-time tools.** Load precise files, identifiers, and query results as needed. Return filtered results and useful provenance instead of large raw collections. The application can implement these principles through its existing MCP tools; direct-API-only features are not assumed available. [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [effective tool design](https://www.anthropic.com/engineering/writing-tools-for-agents).
2. **Lexical, semantic, and hybrid retrieval.** BM25 helps with exact identifiers and terminology; embeddings can help paraphrases. Contextual metadata and reranking can improve retrieval, but add preprocessing or runtime work. Use explicit scope filters first. No embedding or reranker was benchmarked here. [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval).
3. **Long context.** Larger windows do not remove the need to test whether all relevant information is used. The older Lost in the Middle study motivates coverage tests; its results are not treated as a measured failure rate for the current model. [Original paper](https://arxiv.org/abs/2307.03172).
4. **Learned prompt compression.** LLMLingua-2 is a trained token-selection method with published downstream evaluations. It is materially different from the lead-summary negative control in this battery. Defer deployment until exact wording, numbers, negation, formulas, tables, and Spanish/Galician material have dedicated evaluations. No neural compressor was downloaded or tested. [LLMLingua-2 paper](https://arxiv.org/abs/2403.12968).
5. **Prompt caching versus result caching.** Provider prompt caching can affect repeated-prefix cost and latency; those tokens still form part of the model input. Exact result reuse can avoid a call entirely when reuse is semantically appropriate. They require separate metrics and invalidation rules. [Claude prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
6. **GraphRAG.** Graph indexing and community summaries target relationship-heavy and global corpus queries. That is not the same problem as retaining every section of one assessment or curriculum. Its extra indexing stages are not justified as the first optimization for this application; this is a deferral, not a negative local benchmark result. [Microsoft GraphRAG indexing methods](https://microsoft.github.io/graphrag/index/methods/).
7. **Additional agents.** Extra agents can help independent research branches, but duplicate context and coordination are real costs. Preserve deliberate section parallelism; do not add automatic reviewers merely as a token-saving measure. Published multi-agent ratios are not used to forecast this application's consumption. [Anthropic multi-agent research architecture](https://www.anthropic.com/engineering/multi-agent-research-system).
8. **Evaluation discipline.** Combine verifiable outcomes with token, latency, and failure measurements. Separate context retention from final pedagogical quality and measure tool-using trajectories before claiming end-to-end gains. [Agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## Battery and limits

All material was fictional and generated by the harness. It did not open application documents or application settings. Model calls ran in a temporary directory with tools prohibited by the task; the harness rejects Codex runs that actually invoke tools. No model workers were delegated repository work.

The local battery has 88 scenarios over eight deterministic seeds and six strategies: **528 context evaluations**. Each corpus has 240 blocks across five topics, two versions, and two courses. Cases represent targeted research, section drafting, local editing, global review, curriculum extraction, selected-question adaptation, visual evidence, activities, version selection, transcription, and an ordinary lookup control. Facts include numbers, negations, exceptions, and exact relationships. Retention requires the complete original fact sentence, not merely its identifier.

Four seeds were designated holdout seeds. They vary identifiers and numerical values, not the document structure. They are not independent real-world documents. Explicit structural selection uses task-visible profile metadata or user-selected IDs, never the expected answer strings. A policy cannot assume that unknown document metadata is already reliable.

The live battery has six representative context requirements and three strategies: **18 successful calls**, one sample per condition, using Codex CLI with `gpt-6.1-sol` at low effort. A smaller 120-block corpus retained both versions and all required facts. Requests asked for exact fact copying into JSON, with absent facts omitted. This probes fidelity under context reduction; it is **not** an end-to-end evaluation of note writing, teaching quality, exam difficulty, diagram generation, tool-use planning, or legal completeness.

Claude was attempted twice and returned a usage-limit rejection before inference, reporting zero input/output tokens. Therefore the live results do not qualify Claude. No local Ollama service was available. Embeddings, GraphRAG, learned compression, model routing, true agentic search, and multi-agent execution were researched but not experimentally compared.

## Local context results

| Strategy | Cases retaining every required fact | Mean characters sent | Interpretation |
| --- | ---: | ---: | --- |
| Entire corpus | 88/88 | 127,989 | Complete but includes unrelated versions/courses |
| First 90,000 characters | 64/88 | 90,000 | Tail loss is unsafe for complete tasks |
| Current unfiltered BM25, top 6 | 32/88 | 3,522 | Version/course collisions and incomplete coverage |
| Scope-filtered BM25, top 6 | 56/88 | 3,497 | Passes targeted cases; fails the four complete-coverage families |
| Structural selection | 88/88 | 7,212 | Complete when exact input scope is known |
| Simple lead-summary control | 0/88 | 30,038 | Introductory prose omits the tested detail; not a neural compression benchmark |
| Selected policy by task | 88/88 | 6,167 | Scoped BM25 for lookup/discovery; structural selection for selected or complete input |

These figures are **characters, not tokens**. The selected policy reduces the supplied characters by approximately 95.2% in these deliberately distractor-heavy fixtures. That number must not be advertised as a production token-saving percentage.

Scope-filtered BM25 passed all eight cases each of research, drafting, local edit, adaptation, visual evidence, version filtering, and ordinary lookup. It failed complete coverage in all eight cases each of global review, curriculum extraction, activities, and transcription. This is a top-6 fixed-context result, not a claim that an iterative RAG agent cannot retrieve additional material.

## Real model-token results

Input totals include cached input. Output tokens are kept separate. Each strategy contains the same six tasks and the same 80 required facts.

| Strategy | Input tokens | Output tokens | Exact facts retained | Complete cases |
| --- | ---: | ---: | ---: | ---: |
| Entire corpus | 133,387 | 2,621 | 80/80 | 6/6 |
| Scope-filtered BM25, top 6 | 95,231 | 705 | 20/80 | 4/6 |
| Structural selection | 97,526 | 2,621 | 80/80 | 6/6 |
| Selected policy by task | 97,310 | 2,621 | 80/80 | 6/6 |

The selected policy uses **27.05% fewer input tokens** than full context in this small battery. Structural selection alone reduces input by 26.88%. The smaller BM25 output is mostly missing information, not an efficiency improvement.

| Probe | Full-context input | Structural input | Reduction | Retention |
| --- | ---: | ---: | ---: | ---: |
| Targeted research | 22,109 | 15,971 | 27.76% | 3/3 |
| Local edit evidence | 22,089 | 15,330 | 30.60% | 1/1 |
| Complete global review | 22,761 | 19,351 | 14.98% | 60/60 |
| Complete curriculum subset | 22,234 | 16,084 | 27.66% | 12/12 |
| Selected-question adaptation | 22,098 | 15,393 | 30.34% | 2/2 |
| Selected visual evidence | 22,096 | 15,397 | 30.32% | 2/2 |

For global review, top-6 BM25 retained 6/60 facts. For curriculum extraction it retained 6/12. It did not fabricate the missing facts under this constrained copying instruction; production hallucination rates were not measured.

The 18 calls consumed **326,144 input tokens and 5,947 output tokens** in total. Of the input, 28,416 tokens were reported as cache reads. Those cache reads occurred in the full-context and BM25 conditions, not in the structural condition; cache timing/order is not controlled. The selected policy's six calls took 57.19 seconds in aggregate versus 59.08 seconds for full context. Structural selection alone took 60.09 seconds. This provides **no reliable latency-win claim**. CLI/model overhead remains substantial even when the supplied text shrinks markedly. No euro cost or subscription-quota saving is inferred.

## Cache and shared-prompt findings

An isolated exact-key cache prototype returned 20/20 hits for identical requests and missed when source content, task, or model identity changed. The key includes a source hash and prompt version. This is an identity/invalidation probe, not a production cache implementation or a semantic-equivalence guarantee. A production key must additionally include all effective inputs, permissions/scope, model settings, output schema, source revisions and dependency identities, with freshness rules for fetched public sources.

Cache local PDF/HTML extraction, parsing, indexing, validated structural outputs, and deterministic exports. For model-generated results, reuse must respect user intent: **Regenerate**, creative variations, changed instructions, and changed source/version must not silently return a previous answer. Do not reuse results merely because an embedding says two requests are similar. Do not replay state-changing tool operations from a cache.

The system-prompt audit found that a small role-only candidate could remove 87–92% of the shared system-prompt characters for the eight sampled roles. This is not a measured token or quality gain: that candidate omits editorial capabilities and is not production qualified. The implementation direction is selective capability loading, not wholesale deletion of caption, formula, solution, import-style, or safety rules. Mandatory data-integrity and user-scope rules always remain.

## Strategy by application operation

| Operation | Decision | Coverage and correctness gate |
| --- | --- | --- |
| Import of text-bearing documents | Local conversion, parsing and image extraction; hash cache | Preserve original text, tables, formulas, footnotes and assets |
| OCR or difficult PDF layout | Bounded page batches with original page references; model fallback only where needed | Every page and required image accounted for; no summary substitution |
| Official curriculum acquisition | Cache fetched source/text with freshness checks, select the complete relevant annex/module, then structured extraction | Source inventory, continuation pages, original wording and hierarchy |
| Curriculum already structured | Query JSON by version and element/parent IDs | Retain parent relationships and exact original text; no embeddings required |
| Research and open source lookup | Scope-filtered existing BM25; citations; fetch/expand adjacent text on insufficient evidence | Explicit source/version/course filtering; uncertainty when evidence is absent |
| Section drafting | Section plan, document outline, relevant dossier/source evidence, exact current section | Preserve dependencies and user requirements; evaluate prose quality before rollout |
| Full diagnosis or curriculum-coverage review | Manifest of all selected sections; bounded exhaustive batches plus compact issue ledger if one packet is too large | Every selected section processed once; retain original quotations for suggested edits |
| Local edit or selected-text chat | Exact selected span plus a small necessary surrounding context and expected revision | Unselected content unchanged; no lossy compression of edit anchors |
| Exam generation and activities | Complete selected teaching scope, compact curriculum references, planned distribution by section | Every intended topic included; scoring, answers and rubrics coherent |
| Exam adaptation | Selected original questions, solutions/rubrics, scoring rules and necessary dependencies; local merge with immutable snapshot | Unselected questions byte-equivalent; preserve type, points and assessment criteria |
| Visual creation | Exact anchor paragraph, required entities/relationships, existing visual inventory, only the relevant visual schema | Anchor must still match; assets and captions valid |
| Glossary | Incremental changed-section scan plus a complete retained term index | No disappearance of existing terms; invalidation on changed definitions |
| Long chat and retries | Structured state/decisions, exact pending constraints, bounded relevant history and concise tool results | Do not summarize away commitments, revisions or original edit text |
| Source editing, numbering, validation and export | Deterministic application code | Atomic persistence, revision conflicts, rendering checks; no model tokens |

Batch/reduce, incremental glossary updates and role-specific prompt loading are selected architectural directions, not end-to-end qualifications from these probes. Extra calls can outweigh smaller contexts. A separate implementation slice must compare the complete workflow, including every retrieval, batch, reducer, retry and output token.

## Rejected or deferred defaults

- **One global RAG policy:** rejected. The fixed top-k variant loses required information on exhaustive operations.
- **Blind prefix truncation:** rejected. It hides relevant tail material in the fixture and is inappropriate as a completeness policy.
- **Summaries as replacements for normative/author text:** rejected. Summaries can be navigation aids, while exact evidence remains accessible.
- **Universal vector/hybrid RAG or reranking:** deferred until a Spanish/Galician paraphrase suite demonstrates a retrieval gap and a local model clears latency, storage and privacy constraints.
- **GraphRAG as the main token optimization:** deferred; no measured application need currently justifies the added extraction/indexing stages.
- **LLMLingua or other learned compression as a default:** deferred; this run did not test the actual model or downstream educational quality.
- **Semantic result caching:** rejected as an automatic default for curricula, assessments, and mutations; exact identity and freshness are required.
- **Automatic additional reviewers or a blanket weaker model:** rejected as token-saving defaults. Independent review remains useful when its quality gain justifies its measured full cost.
- **Provider prompt caching as the only solution:** rejected. It is complementary, provider-dependent, and does not correct missing evidence or remove tokens from the input context.

## Rollout order and acceptance criteria

1. Introduce explicit operation scope, coverage requirements, provenance and section manifests. Add per-operation prompt/tool/input/output/cache telemetry without logging private document text externally.
2. Improve the existing retrieval with scope filters and add exact structural selectors for already-known files/questions/curriculum IDs. Preserve the full-context fallback when selection cannot be established safely.
3. Add exact-identity caches for deterministic preprocessing, with tests for changed content, preserved timestamps, changed permissions/model/schema, explicit regeneration, and stale public sources.
4. Split capability-specific instructions and bound tool responses. Qualify each role separately with its real output validator, including imported-format and visual-format rules.
5. Qualify complete batching for large-document workflows before removing prefix limits or replacing agent file reads. Count the full trajectory, not only the first prompt.
6. Consider local semantic retrieval or learned compression only if the remaining measured bottleneck calls for it.

Hard gates: complete-task source coverage, exact critical facts/negations/formulas, correct references, unchanged unselected text, valid schema and revisions. Cost goals come after those gates. A reasonable implementation target is a measured reduction in total tokens per completed operation, without claiming the 27.05% probe result will apply universally.

## Reproduction and evidence

```powershell
# Local battery only; no model calls.
node --import tsx scripts/evaluate-context-strategies.mts

# Explicit live experiment; spends the selected engine's quota on fictional data.
node --import tsx scripts/evaluate-context-strategies.mts --live --engine=codex --max-tokens=400000

# Continue an interrupted live run without repeating completed case files.
node --import tsx scripts/evaluate-context-strategies.mts --live --engine=codex --resume --max-tokens=400000

# Rebuild the summary and CSV without model calls.
node --import tsx scripts/summarize-context-evaluation.mts

# Existing application regression suite and local performance probe.
npm test
node --import tsx scripts/benchmark-performance.mjs
```

Do not use `--live` again merely to read results. Live resumption intentionally reuses existing completed measurement files; use a different `--output=...` directory for an independent repetition. The ceiling is checked between calls, so the final in-flight call can overshoot it. Each child process is bounded by a 90-second timeout and only its own process tree is terminated on timeout.

Machine-readable evidence is in `output/context-evaluation-2026-10-18/`: `offline-results.json`, individual `codex-*.json` records, `live-results-codex.json`, `decision-summary.json`, and `live-metrics.csv`. The three early unprefixed JSON records preserve the blocked Claude attempt; they are not successful samples and do not contribute to the numerical tables. No real document or student data is present in these fixtures.

Validation: all 85 existing application tests passed after adding the evaluation scripts. The summary generator independently checks that 18 successful live records, all six complete structural cases, and all 88 selected-policy context cases are present before writing the decision summary. Timing results are descriptive; there are no confidence intervals or independent document/model replications. Future agent-quality evaluation must use natural requests, unfamiliar document structures, realistic tool trajectories, representative languages, and human review of educational outputs.
