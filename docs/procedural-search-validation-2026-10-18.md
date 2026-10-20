# Procedural search validation — 2026-10-18

## Decision

Prioritize predefined local procedures for known identifiers, heading selection, dependency traversal, and coverage checks. Keep lexical retrieval for discovery. When lexical/structural matching cannot locate the requested concept, explicitly widen the input scope rather than treating an empty result as proof of absence. Semantic retrieval remains an untested possible complement.

This experiment validates a disk-backed prototype, not a production rollout or a pedagogical quality claim. No runtime code, application settings, or user documents were changed.

## Design

Run `node --import tsx scripts/evaluate-procedural-search.mts --live` from the repository root. Without `--live`, only local evaluations run. Successful persisted model requests are reused on later runs; remove or change the output destination before an independent replication. The script has a 350,000-token between-request ceiling, a 90-second per-request timeout, bounded output, and cleans only its own verified temporary directory.

The generator writes fictional Markdown documents to disk: two versions, two courses, 30 sections each. Sections contain exact numerical restrictions, negations, exceptions, and explicit dependency references. All strategies receive the same trusted version/course filename. The procedure reads and parses files, selects headings or requested identifiers, recursively follows references with cycle detection, deduplicates, and returns complete selected sections. Expected answers are excluded from the procedure request and used only for scoring. Content is not reduced to answer sentences.

Five tasks cover a lookup with a cyclic dependency, a selected edit, complete review, a curriculum heading scan, and an unrecognized paraphrase. The latter deliberately widens to the whole scoped document. Ten seeds vary numerical values, not document structure: 50 task instances and 150 context evaluations. Fifty additional assertions exercise missing identifiers, duplicate identifiers, cycle termination, complete enumeration, and broken dependency references. Wrong-version fact exclusion is also asserted for each context evaluation.

Comparators are the complete scoped document and the application's actual BM25/MiniSearch implementation, filtered to that same file and limited to six fragments. This is a fixed top-six baseline, not the application's complete agentic workflow: an agent could search again or read more. The experiment does not establish that procedures outperform adaptive retrieval or embeddings.

Fifteen fresh CLI sessions using `gpt-6.1-sol`, low effort, compare the five tasks across three strategies on seed 21. Strategy order rotates by task. Each model receives the locally prepared context and copies requested facts to JSON; tools are prohibited and any actual tool execution rejects the run. Every model call, input/output token count, answer, and duration is persisted. No live retrieval agent or additional worker was spawned. Only synthetic data is sent to inference.

## Results

| Local strategy | Complete cases | Mean context characters | Mean local preparation time |
| --- | ---: | ---: | ---: |
| Complete scoped document | 50/50 | 17,635 | 1.82 ms |
| Scoped BM25, top six | 10/50 | 1,789 | 5.16 ms |
| Local procedure | 50/50 | 8,931 | 2.05 ms |

Local times include packet preparation after indexing; BM25 cold index creation is recorded separately in `offline.json`. These tiny, warm, structured fixtures do not qualify large-corpus throughput. Character reduction is not token reduction.

| Live strategy | Complete tasks | Correct required facts | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| Complete scoped document | 5/5 | 47/47 | 91,876 | 1,079 |
| Scoped BM25, top six | 1/5 | 14/47 | 77,826 | 365 |
| Local procedure | 5/5 | 47/47 | 84,100 | 1,079 |

The procedure used **8.46% fewer input tokens** than the complete scoped baseline while retaining all required facts in this battery. Input plus output fell from 92,955 to 85,179 tokens, or **8.37%**. Total evaluation usage was 253,802 input and 2,523 output tokens across 15 calls. Cached input is included in input, not subtracted: 14,208 full, 42,624 BM25, and 14,208 procedural cached tokens. This is token telemetry, not a subscription quota or financial estimate.

| Task | Full input | Procedural input | Interpretation |
| --- | ---: | ---: | --- |
| Lookup with dependency cycle | 18,353 | 15,413 | Retrieves both linked sections; BM25 retained only one |
| Selected edit | 18,350 | 15,299 | Exact selection saves context |
| Complete review | 18,437 | 18,437 | Complete reading has no context saving |
| Curriculum heading scan | 18,383 | 16,598 | All twelve criteria retained; BM25 retained six |
| Unknown paraphrase | 18,353 | 18,353 | Explicit full-scope fallback preserves facts at baseline token cost |

Model time totaled 37.42 seconds for full context and 37.04 seconds for the procedure; this single run provides no credible latency advantage. BM25's shorter answers reflect omitted evidence and are not a quality-preserving saving.

## Interpretation and limits

The local search and traversal stages make zero model calls. Their CPU work does not consume model tokens. The resulting context, model output, and any model-written search plan do consume tokens; this prototype uses predefined procedures and no model-written plan. Fixed CLI context contributes substantially to measured input, so a large source-character reduction produces a smaller total-token reduction.

The procedure does not infer hidden semantic relationships. Heading matches and dependency fields must exist and be trustworthy. Unknown terminology triggers an exhaustive fallback; without that fallback, the paraphrase case would have lost the relevant facts. Parsing arbitrary PDFs, recovering metadata, recognizing undisclosed dependencies, and semantic equivalence remain unqualified.

There is one model configuration and one inference per condition. Seeds share a handcrafted structure. Exact-copy fidelity is not evidence of editing quality, exam adaptation quality, or curriculum completeness on real regulations. No semantic retriever, autonomous procedural-search agent, OCR pipeline, or production tool-loop comparison was run. The previous evaluation's 27% result came from a different baseline and corpus; it must not be combined with this 8.46% result.

Next implementation should expose bounded domain operations, return provenance and unresolved references, and maintain explicit coverage manifests for exhaustive tasks. Validate each production flow before claiming an application-wide reduction.

## Evidence and checks

- Harness: `scripts/evaluate-procedural-search.mts`.
- Local cases: `output/procedural-search-2026-10-18/offline.json`.
- Aggregates: `output/procedural-search-2026-10-18/summary.json`.
- Individual inference evidence: the fifteen numbered strategy JSON files in that directory.
- Standalone strict TypeScript checking passed for the harness.
- Existing application suite: 85 passed, zero failures.

This is an implementation of the local filtering and bounded-context principles documented in [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) and [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). Published vendor savings are not used as forecasts for this application.
