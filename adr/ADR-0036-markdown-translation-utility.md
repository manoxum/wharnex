# ADR-0036 — Markdown translation utility engine

Status: Accepted

## Context

Wharnex needs global language preferences and on-demand translation in every session-owned Markdown viewer. Translation is application utility work, not project planning or execution: routing it through the planner would consume the execution protocol, create unnecessary bundle round trips and risk confusing untrusted document text with instructions. Translated text must also never overwrite the project file, artifact or knowledge record being viewed.

## Decision

Wharnex introduces a separate application utility port with protocol `harness.utility/v1`. Version 1 supports the `translate_markdown` task and returns a strict structured result containing protocol, task, target language and translated Markdown. The Markdown source is always treated as untrusted data. Utility results cannot contain commands, plans or patches and never enter Policy, sandbox execution or host Apply.

The first infrastructure adapter uses the OpenAI Responses API with `store=false` and a strict JSON schema. It is configured independently through `OPENAI_UTILITY_MODEL`, falling back to the normal OpenAI model setting. When no OpenAI API key is configured, the capability fails explicitly as unavailable rather than falling back to the planner or Desktop scraping channel.

Global language preferences are stored in `language-settings.json` beside the existing state files. Version 1 allows only Portuguese (`pt`), English (`en`) and French (`fr`) for both the interface locale and translation targets. At least one translation target is required. The selected interface locale is applied to the browser document and the settings shape is intentionally extensible so more languages can be admitted in a future version.

Session-scoped Markdown translation is exposed through `POST /api/sessions/{id}/translate-markdown`. The backend verifies that the session exists and that the target is enabled by the global language settings before invoking the utility engine.

Frontend Markdown file/document viewers use one shared `TranslatableMarkdown` surface. Selecting a target and requesting translation changes viewer state only. The original Markdown remains the immutable render source and is immediately recoverable with the original-view action; no project write, artifact write or knowledge mutation is performed.

## Consequences

- Markdown translation remains isolated from planner/execution semantics and can host future non-executing GPT utility tasks behind the same application boundary.
- Translation requires configured provider credentials and can incur provider latency/cost.
- Adding languages requires an intentional settings/protocol compatibility change rather than accepting arbitrary language identifiers.
- Viewer integrations share one translation control and preserve the source by construction.
