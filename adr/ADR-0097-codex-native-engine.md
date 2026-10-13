# ADR-0097 — Native Codex engine

Status: Superseded for new requests by ADR-0098 (operator request, 2026-10-12).
The contract below remains only for already pending legacy planner bundles.

Wharnex provides two Agent engines: ChatGPT Scraper (the existing global
Supervisor/Worker pools) and Codex. The former remains the default. Engine and
model selection belong to a durable workspace chat's `extra`, independent of
the legacy `chat_transport_mode` scraper/manual compatibility field. Switching
is refused while the chat owns an unfinished request or prepared delivery.

Codex uses the official local `codex app-server` JSONL protocol, the same
runtime interface used by the official IDE extension. Wharnex renders its own
native React surface; it does not load a VS Code webview without its extension
host. The official SDK is for job automation; app-server supplies the account,
model, conversation, rate-limit and streaming APIs this interactive client needs.
The packaged CLI is pinned; no host CLI, VS Code installation or API key is
required. Existing Codex login is reused through the runtime's normal account
API; Wharnex never reads auth.json or exposes credentials to its renderer.

Codex is a planner adapter, never an executor. Threads have an empty runtime
cwd, read-only sandbox, disabled shell, exec, hooks, browser, apps, plugins and
configured MCP servers. Every unexpected server request is refused. The only
dynamic tools hash model-authored UTF-8 without execution, read a bounded entry from the engine-built request ZIP and create
the exact expected response ZIP from model-authored entries. Archive creation
is deterministic transport packaging, never command execution or host patching.
Only the resulting ZIP is ingested by the existing backend validator. Prose,
streaming status and tool arguments never acquire execution authority.

Code Mode compatibility: the local Code Mode host stays enabled. Disabling it
caused models that wrap dynamic tools in `functions.exec` to return the exact
error `code-mode host is disabled`, without reaching an archive handler. Direct
function-call tests did not cover that dispatch path. Code Mode evaluates
isolated JavaScript without Node, filesystem or network; archive ownership and
all disabled execution tools remain enforced. The regression test uses the
real packaged app-server with forced Code Mode, an isolated account-free home
and a local Responses fixture. It reads, hashes and creates a durable ZIP,
and verifies that shell, patch and Node bindings are unavailable. Runtime
shutdown sends stdin EOF and awaits process termination so app-server can stop
its Code Mode child and flush state before runtime-directory cleanup.

Follow-up verification: `node --test codex/code-mode.test.mjs` reproduced the
exact error before the fix and passed afterward. Desktop `npm run check`:
1,153 tests passed. This fix does not silently change the normative execution
contract into an unrestricted native host agent.

The request builder is reused unchanged with fresh context on every round.
Continuations, retry, cancellation and durable response retention use the same
selected engine. Persisted chat/thread/request bindings prevent repeat submits;
an uncertain or interrupted submission requires attention rather than a blind
retry. Completed ZIPs survive Desktop restart until backend acknowledgment.
Only a window owning the project may inspect a binding or receive its events.

Usage displays runtime-reported token counts and account limit windows. Missing
metrics remain unavailable; limits are not prices, and monetary cost is never
invented. Operational logs carry correlated lifecycle metadata through the
existing redacted, nonblocking 15-day log, never credentials or raw RPC bodies.

Compatibility: existing chats default to ChatGPT Scraper; persisted
`external-agents` drawer IDs remain accepted but display the native Codex panel.
There is no database migration and existing browser pools retain their roles.

References: https://learn.chatgpt.com/docs/app-server,
https://learn.chatgpt.com/docs/codex-sdk,
https://learn.chatgpt.com/docs/codex/ide.

Styling scope: the new Codex surface and switch use Tailwind and shared
WorkbenchTabs. Extracted existing ChatGPT chrome and composer child controls
retain their original styles as a scoped appearance-preserving exception;
no new legacy CSS rules are introduced. The retired launcher used only inline
styles, so it leaves no stylesheet rules to remove.

Verification (2026-10-12):

- Desktop `npm run check`: 1,151 tests passed, including the real pinned
  app-server against an isolated local Responses fixture. Its advertised tools
  contain only the three archive tools plus upstream `request_user_input`, which
  the RPC boundary refuses. No inference or account spend is used by that test.
- Frontend typecheck and production build passed. Focused engine, UI, delivery,
  restart recovery and existing bundle-routing tests: 44 passed.
- Playwright: both dark/light cases passed, including responsive width, live
  conversation updates, engine/model controls and runtime-reported usage.
- Full frontend comparison: the unmodified HEAD worktree produced 63 failing
  tests and four unhandled errors; the changed worktree produced 60 failing
  tests and the same four errors (`bridge.closeInteraction` mocks). Source
  regressions introduced during extraction were corrected without changing
  existing assertions. One intermittent unchanged EditorWorkspace popup test
  failed only in the full changed run, then passed in both isolated reruns.
- Global lint still reports the same three errors in untouched Drawio files;
  the isolated HEAD worktree reproduces them. New files add no lint findings.
- Domain-layout checks reproduce the same two existing backend directory
  violations in HEAD and this worktree. New Codex domains remain within their
  file-count limits. All new implementation files are below 200 lines; the
  largest is the native engine. Oversized touched concerns were extracted.
- The retired CLI-launcher tests were replaced by native account/conversation,
  engine-switch and usage tests because terminal launching and VS Code plugin
  management are deliberately removed from this panel.

The integration does not import arbitrary existing CLI/extension threads into a
project: only Wharnex-owned bindings are exposed to that project's window.
Historical plan/execution archives remain backend-owned; there is no new
execution path, API-key requirement, database schema or automatic host access.
