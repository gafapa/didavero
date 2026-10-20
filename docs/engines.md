# Agent engines

Apuntes supports Claude Code, Codex CLI and OpenCode 2. Install at least one and configure its account or provider. Missing-engine cards link to the official installation instructions independently of the installation-command API. In Electron, these external links open in the system browser.

- Claude Code: <https://code.claude.com/docs/en/setup>
- Codex CLI: <https://developers.openai.com/codex/cli/>
- OpenCode 2: <https://dev.opencode.ai/v2/docs/cli/>

Choose one engine for all agents, or select **Por agente** to assign engines individually. Tasks fall back to another available engine when their preferred engine is unavailable. AI image generation continues to require Codex.

## OpenCode

The integration targets the `@opencode/cli` 2.x command contract. Version 1 is detected but requires an update. On Windows, npm installations resolve directly to the native executable when available.

Models are discovered with `opencode models --standalone`, without requesting inference, and cached for one minute. An empty model selection uses OpenCode's configured default. Explicit identifiers support `provider/model#variant`. OpenCode retains its own model selection when applying spending presets; no provider or paid model is chosen automatically. Its reasoning settings depend on the provider and variant rather than Claude/Codex effort flags.

Each task runs `opencode run --standalone --format json --agent apuntes`, with prompts on stdin and optional `--model` and `--session` arguments. Per-process configuration supplies the role instructions and permissions; user configuration files are never edited. Project configuration and Claude compatibility are disabled. Provider and other global OpenCode configuration remain available: this is not an isolated OpenCode installation or an OS sandbox.

The task agent denies unspecified actions, including shell commands, subagents and skills. It permits file reads/searches, edits inside the task directory, explicitly supplied extra directories, task-enabled web tools and the application sources MCP server when needed. Global MCP servers are not explicitly removed; agent permissions deny calling unrelated tools. Review global OpenCode configuration when using sensitive material.

JSON text, tool, error and step-finish events feed the existing queue. A step finish does not complete the task: successful process exit and normal application postprocessing are required. Token accounting adds non-cached input, cache reads and cache writes to input, and reasoning to output. Repeated step identifiers are counted once per invocation. Provider rate-limit errors use the existing queue pause/retry mechanism. No common OpenCode subscription quota is assumed. A configured-model status is not proof of a successful inference or sufficient provider credit.

## Validation

Synthetic CLI regression tests exercise queue execution, session continuation, tool events, step deduplication, failures, cancellation, settings persistence, profile preservation and legacy token counters. The installed OpenCode 2.0.32 CLI also accepted the invocation/configuration and returned a structured error for a deliberately nonexistent model without inference. No paid generation or real teaching data was used for these checks.
