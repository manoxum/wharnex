# Changelog

## v1.2.8 — Per-project Protected/Unprotected execution + patch diagnostics

- Adds a project-scoped Protected/Unprotected Agent execution switch directly in the workspace UI and persists it per project.
- Protected remains the default sandbox-first flow with a separate host Apply step.
- Unprotected executes validated/policy-approved Agent plan patches, commands, and verification directly in the real project after explicit per-execution confirmation; successful runs end in `applied`.
- Keeps the interactive Editor terminal sandboxed regardless of Agent execution mode.
- Propagates the project execution preference across multiple Harness chat sessions and restores it after reopen/backend restart.
- Replaces generic `git apply --check failed` failures with Git stderr diagnostics.
- Adds conservative patch retries using `git apply --recount` and checked `--3way` when blob index metadata is present; fallback mutation runs only after its check succeeds.
- Uses the same patch strategy for Protected sandbox execution, later host Apply, and Unprotected direct host execution.

## v1.2.7 — Resilient manual JSON patch transport

- Repairs the narrow, common ChatGPT transport failure where source-code double quotes inside an otherwise valid `patch` JSON string were not escaped.
- Repair is limited to `patch` values that clearly start with a supported patch dialect and are immediately followed by the operation `command` field; strict protocol validation and policy still run afterward.
- Accepts JSON wrapped in a Markdown `json` fence for manual import.
- Returns a clearer syntax error with the approximate byte offset when malformed JSON cannot be safely repaired.
- Strengthens the manual planner contract: every source-code quote inside the JSON `patch` string must be escaped as `\"`.

## v1.2.6 — Multi-chat + ChatGPT conversation affinity

- Adds multiple Harness chats per workspace with independent local histories and backend session IDs.
- Persists the active Harness chat and restores it after reload/reopen.
- Stores one ChatGPT conversation URL per Harness chat and automatically navigates the embedded ChatGPT view when chats are switched.
- New Harness chats start from the ChatGPT home/new-chat surface and automatically bind the first concrete `/c/...` conversation created for them.
- Prevents accidental silent rebinding: if the user manually opens a different ChatGPT conversation after a link already exists, the UI asks for an explicit “Vincular esta conversa” action.
- Adds a narrowly validated Desktop IPC navigation capability that accepts only trusted HTTPS `chatgpt.com` URLs.
- Migrates the legacy single-chat local transcript into the first multi-chat conversation.

## v1.2.5 — Git bootstrap + resilient manual plan import

- Automatically initializes a Git repository at every opened project root when `.git` is absent.
- Re-checks Git before host apply.
- Creates an isolated Git baseline inside every sandbox copy so `git diff`, `git diff --check`, and other allowed read-only Git verification commands work reliably.
- Requires `git` in root `make build` dependency checks.
- Normalizes the common manual ChatGPT alias `schema` -> `protocol`, fills conservative missing command defaults, accepts wrapped verification commands, and converts only the safe `*** Add File` patch dialect to a standard unified diff.
- Keeps strict validation/policy authoritative after normalization. Unsupported patch dialects remain rejected.
- Strengthens the manual planner prompt with the exact required JSON wire shape and standard `git apply` unified-diff requirement.

## v1.2.4 — ChatGPT clipboard permission

- Allow `clipboard-sanitized-write` only for the embedded `https://chatgpt.com` origin so ChatGPT's Copy button works in Electron.
- Keep `clipboard-read` denied to remote content; response import remains an explicit trusted Wharness action.
- Add allowlist regression coverage for clipboard permission origins.

## v1.2.3 — ChatGPT stream compatibility

- Presents the isolated ChatGPT session with a Chrome-compatible UA matching Electron 44 Chromium 152.
- Clears HTTP cache at Desktop startup without removing cookies/login state.
- Adds sanitized ChatGPT load/network/HTTP diagnostics to lifecycle logs.
- Keeps the remote surface sandboxed and does not read ChatGPT DOM or response content.


## 1.2.1 — Unified build/start/stop lifecycle (2026-09-02)

### Added
- Root `make build` installs dependencies, builds backend/frontend/desktop checks, and builds the Docker runner.
- Root `make start`, `make stop`, `make restart`, `make status`, and `make logs`.
- Runtime PID tracking under `.harness/run` and combined desktop logs under `.harness/logs`.
- Compiled backend runtime preference (`dist/bin/wharness-backend`) and built frontend preview preference.
- Linux Electron ozone selection with X11/XWayland preference and Wayland Vulkan fallback.

### Fixed
- Docker runner builds no longer depend on the caller being in the repository root.
- Electron launcher no longer inherits an incompatible automatic Wayland/Vulkan combination when XWayland is available.
- Coordinator shutdown terminates only the child process groups it created.

## 1.2.0 — Wharness Desktop / ChatGPT composition (2026-09-02)

### Added
- Electron `WebContentsView` desktop shell with ChatGPT in the same native window.
- Persistent isolated ChatGPT web session.
- Native copied-file context ZIP clipboard.
- Explicit context refresh API before desktop bundle copying.
- Desktop browser controls and state telemetry limited to URL/title/loading/navigation state.
- Clipboard JSON import.
- Desktop security tests and one-command development launcher.

### Security
- Remote ChatGPT renderer has no Node integration and no Wharness preload.
- IPC is sender-checked and capability-specific.
- Context bundle URL is derived in the main process from a local backend and validated session ID.
- Remote permissions are deny-by-default except notifications.
- No ChatGPT DOM/cookie/output extraction was introduced.


## 0.2.0 — Workspace IDE / Agent (2026-09-02)

### Added
- Editor / Agent mode switch.
- Workspace recovery after frontend reload and backend restart fallback.
- Recent workspace memory and per-project local chat history.
- Safe project Explorer.
- UTF-8 text editor with Ctrl+S and SHA-256 optimistic locking.
- Persistent per-session sandbox terminal with argv execution, optional network, and reset.
- ChatGPT/OpenAI provider tab.
- Context refresh before every Agent request.
- OpenAI context attachment on continued Responses conversations, deduplicated by snapshot hash.
- File API and terminal API endpoints.
- Security tests for traversal, symlink parent/file escape, executable-mode preservation, stale writes, and terminal shell denial.

### Changed
- Manual Bridge is now presented inside the ChatGPT tab.
- Agent planner message wording now distinguishes manual provider from automatic OpenAI provider.
- Frontend package version is 0.2.0.

### Deliberately excluded
- Consumer ChatGPT web iframe login inspection, prompt injection into the ChatGPT DOM, scraping, and automated Output extraction.

## 1.2.2 - External OAuth routing

- Route Google/Microsoft/Apple OAuth popups from the embedded ChatGPT surface to the system browser.
- Add an explicit Open in browser control to the ChatGPT toolbar.
- Keep Chrome/Electron cookie stores isolated; no browser-profile or cookie import is performed.
