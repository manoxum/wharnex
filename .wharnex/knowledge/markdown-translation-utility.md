# Markdown translation utility

- Markdown translation is a non-executing application capability behind `internal/utility.Engine` and protocol `harness.utility/v1`; do not route it through planner execution operations.
- The initial provider adapter is the configured OpenAI Responses client. It may serve utility work even when the primary planner is manual, provided `OPENAI_API_KEY` is configured.
- Global language settings live in `language-settings.json` beside the Wharnex state documents and currently admit only `pt`, `en`, and `fr`; viewer translation targets come from that persisted list.
- Session-owned Markdown previews use the shared `TranslatableMarkdown` path. A translation is viewer state only: original project files, artifact entries, and project-knowledge Markdown remain unchanged.
- If no utility adapter is configured, translation fails explicitly as unavailable instead of falling back to project mutation or ChatGPT web-response scraping.
