# Agent evidence policy

Policy revision: `2026-10-18.1`, exported as `PROMPT_POLICY_VERSION` in `server/agents/agentes.ts`.

## Applied changes

Existing research and source-verification roles now distinguish inspected original evidence from pages repeating the same origin. They preserve source disagreements and distinguish insufficient evidence from a demonstrated falsehood. Research remains bounded by the document objective and reuses consulted sources. The research task no longer requires at least five sources; its existing upper guideline of twelve remains. The dossier's existing Enfoque section records search limits instead of adding a separate large report.

Quality review and diagnosis require passages or identifiable omissions to support reported defects. The diagnostic task now permits zero to twenty-five problems instead of requiring at least five, and its summary must identify unverified scope. Source content is explicitly evidence rather than task instructions in the verifier role. Style review adds a brief check of understandable headings, descriptive links, and useful image alternatives while preserving normative meaning and export markup.

The changes apply to default role instructions. User-customized instructions retain their existing precedence. Task-level constraints, including the removal of source/problem minimum quotas, apply independently of role customization. Existing output JSON schemas and postprocessing remain unchanged.

No additional runtime agent, reviewer pass, retry, tool, dependency, source graph, or automatic model call has been introduced. Curriculum-specific extraction rules remain separate: this policy is not a replacement for official-source, applicability, literal-text, hierarchy, completeness, and human-review checks.

## Adaptation provenance

These compact rules adapt selected concepts from [agency-agents](https://github.com/msitarzewski/agency-agents), inspected on 2026-10-18 at upstream revision `652b2692f8d8ec2b1f1a38e559073e287dfdc469`:

- [Research Synthesist](https://github.com/msitarzewski/agency-agents/blob/652b2692f8d8ec2b1f1a38e559073e287dfdc469/research/research-synthesist.md): source origins, independent evidence, disagreements, and search limits.
- [Prompt Engineer](https://github.com/msitarzewski/agency-agents/blob/652b2692f8d8ec2b1f1a38e559073e287dfdc469/engineering/engineering-prompt-engineer.md): explicit output contracts, prompt revisions, and normal/edge/failure probes.
- [Evidence Collector](https://github.com/msitarzewski/agency-agents/blob/652b2692f8d8ec2b1f1a38e559073e287dfdc469/testing/testing-evidence-collector.md): reproducible deviations and evidence suited to the claim. The application does not require every diagnosis to produce defects.
- [Accessibility Auditor](https://github.com/msitarzewski/agency-agents/blob/652b2692f8d8ec2b1f1a38e559073e287dfdc469/testing/testing-accessibility-auditor.md): a small authoring-quality check. Prompt instructions do not establish WCAG conformance.

Upstream MIT attribution and permission notice are retained in [agency-agents-LICENSE.txt](third-party/agency-agents-LICENSE.txt). The collection's full personas, installation scripts, orchestration pipeline, example chain-of-thought output tags, and automatic development/QA loops are not imported.

## Verification procedure

For a prompt change, record the revision, model, effort, prompt/request fingerprint, fixture input, expected behavior, actual answer, usage, and limitations. Cover a normal case, an ambiguous or boundary case, and a failure or missing-evidence case. Use synthetic fixtures by default. Never claim complete verification from a screenshot, a valid schema, or an unqualified model response. A screenshot proves visual state; reload/readback proves saved data; behavioral probes test the specified output contract. Report untested scope and stop after bounded acceptance checks rather than adding review loops without a concrete failure.

Run `node --import tsx scripts/evaluate-agent-evidence.mts --live` for the opt-in model probes. Without `--live`, only request fingerprints are produced and no behavior is evaluated. The script uses the application's real default role and prompt builders with four fictional tasks, a fresh read-only Codex CLI session per request, low effort, prohibited tools, a 90-second timeout, bounded output, and a 100,000-token ceiling checked between requests. An in-flight request can exceed the remaining ceiling. Exact matching persisted requests are reused; use a fresh output directory or remove old evidence deliberately for an independent replication. This is evaluation tooling, not application result caching.

The four behavioral checks are:

| Case | Expected behavior |
| --- | --- |
| Original plus reprint | One independent original supporting the measurement |
| Conflicting originals | Both original values retained, status disputed |
| Missing original plus embedded instruction | No fabricated original or verified value; explicit limitation |
| Clean diagnosis under a supplied criterion | No invented defect; scope identified |

The measured run passed **4/4** using `gpt-6.1-sol` at low effort: 65,631 input tokens and 269 output tokens across four distinct requests. Input includes cached provider context where reported. Results and exact fingerprints are under `output/agent-evidence-2026-10-18/`. The initial diagnosis grader rejected a scope identifier annotated with a quotation, although the task did not require a bare identifier. The grader was corrected to accept an annotated identifier, the correction is recorded, and the unchanged response was rescored without another inference call.

These are one-shot, task-constrained probes of one model. They do not isolate the effect of role wording from the explicit test contract, qualify Claude, prove prompt-injection resistance, test real browsing, establish pedagogical quality, or verify a real curriculum. No token-saving or application-wide quality percentage is inferred. Production prompts still require evaluation as tasks and models change.

`tests/agent-evidence.test.ts` additionally verifies real diagnostic persistence with zero and one problem, and rejects a malformed result without replacing the last valid report. Existing context, curriculum, exam, import, and security tests remain applicable.

Implementation validation: 91 application tests passed with zero failures; application type checking, standalone checking of the evaluation harness and regression test, and the main-process build passed. The local live API remained available after the changes. No frontend rendering behavior changed in this policy update.
