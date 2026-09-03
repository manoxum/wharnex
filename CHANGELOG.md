# Changelog

## Unreleased — Monaco 0.56 Vite worker export-map hotfix

- Uses Monaco 0.56 public package-export worker specifiers (`monaco-editor/editor/...` and `monaco-editor/language/...`) instead of legacy `monaco-editor/esm/vs/...` deep imports.
- Restores Vite 7/Rollup worker resolution for the editor, JSON, CSS, HTML and TypeScript workers without externalizing Monaco or weakening the bundle.

## Unreleased — React 19 / Monaco build hotfix

- Fixes the Monaco editor ref initialization for React 19 typings by using an explicit nullable ref.
- Uses Monaco 0.56-compatible hover and lightbulb option values instead of incompatible boolean/string literals.
- Clears the disposed editor ref back to `null`, matching its React ref contract.

## Unreleased — rendered plans + IDE editor + terminal targets

- Plan summaries and result README content now render sanitized GitHub-flavoured Markdown instead of displaying raw Markdown syntax.
- The Editor replaces the plain textarea with Monaco, adds multi-file tabs, per-file undo/view state, syntax-aware models, minimap, folding, bracket guides, sticky scroll, search/navigation shortcuts, breadcrumbs, cursor/language/encoding status and explicit save handling.
- The Editor file tree adds path filtering while preserving the existing backend file-policy boundary.
- The interactive terminal now defaults to `Sandbox` but allows an explicit human-only `Host` target after a dedicated confirmation; a persistent HOST warning remains visible while selected.
- Host terminal commands execute argv directly through the host runner and the same executable Policy Engine. Sandbox-only network/reset controls are unavailable in Host mode.
- Switching project/session always resets the interactive terminal to Sandbox so Host selection never leaks into a different project.
- Normative execution, sandbox, security and UI documents plus ADR-0008 record the Host-terminal exception and its guardrails.

## Unreleased — ChatGPT submit acknowledgement hotfix

- Auto mode emits the native Enter submit gesture exactly once after attachments settle; an observation timeout is now diagnostic instead of triggering repeated Enter presses.
- A ChatGPT network-observation miss no longer turns an already-dispatched prompt into a `prepare-prompt` IPC failure or causes the attachment draft to be repeatedly disturbed.
- Confirmed conversation POST observation is still logged when available, while file-first result download remains the authoritative completion signal.

## Unreleased — intent-aware agent turns

- Adds the structured `harness.turn/v1` envelope with answer, clarification, investigation, change, and blocked outcomes.
- Questions and non-mutating analysis now return their complete message to the Harness transcript without entering execution or Apply.
- Manual ChatGPT result bundles use `turn.json`; only change bundles include `plan.json` and patches. Legacy plan-only bundles remain compatible.
- Supported provider results bypass browser downloads, and provider change plans complete the Auto sandbox/verification/Apply pipeline directly.
- A new request supersedes older pending manual requests so delayed stale bundles cannot execute later in Auto mode.
- The embedded ChatGPT UI now states that the remote surface must initiate the result download; Wharness imports it automatically after it starts.
- The Plan inspector now tolerates legacy persisted plans whose empty operation or verification arrays were serialized as `null`; new plans are normalized to arrays before persistence.

## v1.2.14.2 — Definitive ChatGPT conversation binding

- New Harness Chats no longer adopt whichever `/c/...` conversation happens to be visible while the ChatGPT view initializes.
- An unbound Harness Chat is armed only after the trusted ChatGPT new-chat/home surface is observed; the first subsequent concrete `/c/<id>` URL becomes the automatic link.
- Returning to an unbound cached chat preserves the home DOM/draft when already on the new-chat surface, while a stale concrete conversation is reset to home before binding can arm.
- Existing linked chats keep explicit mismatch handling: `Vincular esta conversa` appears only when the current concrete conversation differs from the stored link.

## Unreleased — Harness chat attachments

- The Desktop Harness composer accepts up to 10 user-selected files (25 MiB each, 100 MiB total).
- `Ctrl+V` in the Harness composer now converts files from the native clipboard into attachments.
- Enter prepares the linked ChatGPT draft with the refreshed project context ZIP, selected files, and planner prompt.
- A separate “Confirmar e enviar” action emits Enter only after the user visually confirms the attachments in ChatGPT; Wharness does not inspect the remote DOM.
- In explicit project Auto mode, Desktop now submits the prepared ChatGPT prompt after a bounded attachment settle delay and waits for the validated bundle download event.
- Manual planner prompts now require the final visible response to contain only the downloadable bundle, with no descriptive text, Markdown, inline JSON, or patches.
- Harness chat attachments are now persisted in private Desktop application storage before submission; transcript entries keep durable opaque references so reload/restart restores the files with the conversation.
- Image files get persisted thumbnails when Electron can decode them; other file types fall back to the native OS file icon. Persisted attachment cards can be opened explicitly from chat history.

## v1.2.12.1 — Baseline diagnostic fingerprints

- Protected verification now compares structured TypeScript diagnostics when raw output differs only by runner/npm noise.
- Existing TypeScript failures are tolerated only when the post-patch diagnostic set contains no new error fingerprint.
- Unstructured verification failures keep the previous strict output comparison.

## v1.2.12 — durable agent state + differential verification + ChatGPT DOM cache

- Persiste sessões do backend em `.harness/state/sessions.json`, incluindo plano validado, policy, request ids pendentes, último prompt e último resultado de execução.
- Reiniciar `make stop` / `make start` deixa de apagar o plano/requisição do Harness Chat.
- Protected Mode compara um gate que falhou com uma sandbox pristine; uma falha preexistente só é tolerada quando exit code e diagnóstico permanecem idênticos.
- Regressões novas ou diagnósticos diferentes continuam a bloquear a execução.
- ChatGPT Desktop mantém até 20 `WebContentsView` vivos em LRU, um por Harness Chat, preservando o DOM em memória nas trocas de chat. O botão Reload continua a forçar refresh do chat ativo.

## 1.2.11 — Protected sandbox dependency hydration (2026-09-03)

### Fixed
- Protected Node.js verification no longer fails with `tsc: not found` merely because `node_modules` is excluded from the context/sandbox snapshot.
- `npm run`, `npm test`, `npm exec`, `npx`, and equivalent pnpm/yarn/bun script execution lazily hydrate local `node_modules` into the isolated workspace before the command runs.
- Missing host dependencies now produce an actionable `sandbox node dependencies unavailable` error instead of a misleading package-script exit 127.

### Security
- `node_modules` remains excluded from model context and the initial sandbox copy.
- Dependencies are copied into the temporary sandbox only when a local Node command needs them; the real project is never mounted into the container.
- Dependency symlinks are rewritten only when their targets stay inside the project tree; symlinks escaping the project are rejected.

## 1.2.9 — File-first planner delivery (2026-09-02)

### Added
- Manual ChatGPT planner responses are delivered as downloadable `wharness-plan-<request_id>.json` files.
- Electron intercepts only matching plan downloads from the embedded ChatGPT WebContentsView.
- Downloaded plan files are limited to 2 MiB, validated as JSON, checked for `harness.execution/v1`, and must match the request id encoded in the filename.
- Plan downloads are imported automatically into the Harness Chat owning the pending request and the Inspector switches to the Plan tab after successful validation.

### Changed
- The planner prompt requires the model to serialize the plan with a real JSON encoder instead of hand-writing JSON, preventing TSX/CSS quotes from corrupting transport.
- Clipboard/manual JSON remains available only as a fallback.
- Harness Chat deletion remains local: removing a chat closes its backend session and unlinks its ChatGPT URL without deleting the remote ChatGPT conversation.

### Security
- Non-Wharness downloads remain normal downloads and are not read by the harness.
- Temporary plan files are deleted after import.
- The backend remains authoritative for request correlation, protocol validation, policy evaluation and execution.

## v1.2.8.4

- Repair malformed manual-plan quotes in both `summary` and `patch` string fields before strict v1 validation.
- Harness Chat conversations can be removed from the UI with explicit confirmation. Removing a Harness Chat deletes its local history/session/link but does not delete the remote ChatGPT conversation.
- Deleting the active/last chat automatically selects another chat or creates a fresh one.


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

## v1.2.10 — Chat affinity canonicalization + file-first hardening

- Canonicaliza URLs `/c/<id>` antes de comparar o chat atual com o chat vinculado, ignorando trailing slash, query, fragment e subdomínio ChatGPT.
- O aviso “Está a visualizar outra conversa” só aparece depois da navegação estabilizar e apenas quando os IDs de conversa realmente diferem.
- Reforça o planner manual para criar um ficheiro real `wharness-plan-<request_id>.json` com a ferramenta de geração de ficheiros/Python e proíbe fallback inline.
- O importador manual passa a reparar também patches unified diff que começam diretamente em `--- a/...`, além de `diff --git`.
