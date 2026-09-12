# ADR-0036 — Markdown translation utility engine

Status: Accepted

## Context

Wharnex needs global language preferences and on-demand translation in every session-owned Markdown viewer. Translation is application utility work, not project planning or execution: routing it through the planner would consume the execution protocol, create unnecessary bundle round trips and risk confusing untrusted document text with instructions. Translated text must also never overwrite the project file, artifact or knowledge record being viewed.

## Decision

Wharnex introduces a separate application utility port with protocol `harness.utility/v1`. Version 1 supports the `translate_markdown` task and returns a strict structured result containing protocol, task, target language and translated Markdown. The Markdown source is always treated as untrusted data. Utility results cannot contain commands, plans or patches and never enter Policy, sandbox execution or host Apply.

`translate_markdown` is dispatched as a durable `TRANSLATE_MARKDOWN` task to the authenticated Desktop ChatGPT worker pool instead of calling the OpenAI Responses API directly. Its scheduler priority is above ordinary chat writes, while the worker still obeys residency, provider cooldown and process-wide submission pacing. Completion may carry a replacement JSON payload so the backend can recover the strict `harness.utility/v1` result from the durable task.

The worker never extracts translation prose from the remote DOM. It uploads one bounded Markdown file as untrusted data, asks ChatGPT for one exact task-scoped `whx_translation_<task_id>.md` result, and imports only that bounded UTF-8 download. Structural health/completion probes and the narrow exact-file affordance remain allowed; ambiguous/missing files, human gates, timeout or invalid UTF-8 fail explicitly. The generated Markdown is presentation data and never enters Policy, Runner or Apply.

Global language preferences are stored in `language-settings.json` beside the existing state files. Version 1 allows only Portuguese (`pt`), English (`en`) and French (`fr`) for both the interface locale and translation targets. At least one translation target is required. The selected interface locale is applied to the browser document and the settings shape is intentionally extensible so more languages can be admitted in a future version.

Session-scoped Markdown translation is exposed through `POST /api/sessions/{id}/translate-markdown`. The backend verifies that the session exists and that the target is enabled by the global language settings before enqueuing the utility worker task. Unavailable worker/auth/provider capacity is returned as an explicit unavailable state.

Frontend Markdown file/document viewers use one shared `TranslatableMarkdown` surface. Selecting a target and requesting translation changes viewer state only. The original Markdown remains the immutable render source and is immediately recoverable with the original-view action; no project write, artifact write or knowledge mutation is performed.

## Consequences

- Markdown translation remains isolated from planner/execution semantics and can host future non-executing GPT utility tasks behind the same application boundary.
- Translation requires configured provider credentials and can incur provider latency/cost.
- Adding languages requires an intentional settings/protocol compatibility change rather than accepting arbitrary language identifiers.
- Viewer integrations share one translation control and preserve the source by construction.
