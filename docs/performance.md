# Performance

Section summaries are cached using file identity, modification/change time and size, without retaining section text. Store writes invalidate summaries; returned values are copied. Reads use bounded concurrency and a bounded cache. Independent document-state reads run concurrently.

Source searches reuse bounded MiniSearch indexes. Concurrent cold loads share source loading. File fingerprints detect external cache replacement, and invalidation during loading prevents stale publication. Source-cache JSON is atomically replaced; damaged extraction caches are rebuilt.

React views subscribe to relevant state, agent messages reuse memoized rendering, and live events have a bounded history. Preview caches enforce memory limits. The editor and FP catalogue load lazily; FP data is requested for FP selections. The build resolves a single KaTeX implementation. Concurrent engine-availability checks share a promise rather than keeping time-based stale results.

## Reproducible benchmark

```sh
node --import tsx scripts/benchmark-performance.mjs <baseline-checkout-path>
```

The optional baseline checkout needs compatible dependencies. The harness creates and removes fictional temporary fixtures and prints local processing timings without invoking a model.

The 2026-10-12 historical comparison against `9f70fe1` measured a warm median of 125.43 to 3.86 ms for listing 80 sections and 135.54 to 3.20 ms for searching 1,200 fictional paragraphs. Cold samples were 156.90 to 57.96 ms and 193.78 to 100.32 ms respectively. The then-current main bundle changed from about 1.64 to 0.93 MB. These are retained historical synthetic measurements; rerun for the current tree. They are not production latency guarantees or inference speedups.

Regression coverage includes external replacement with preserved timestamps, mutation isolation, invalidation, concurrent searches and source labels. Rebuilding static files while a test server is open requires restarting that server; missing asset routes must return 404 rather than the application shell.

Pagination, preview virtualization and parser workers require profiling and their own storage/export contracts before implementation. See [Context policy](context-policy.md) for context selection and its separate measurement limits.
