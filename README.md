# Wharness Desktop v1.2.8

Wharness is a local coding-agent harness and lightweight IDE. It combines a React workspace, a Go orchestration backend, isolated Docker execution and—when launched through **Wharness Desktop**—a real ChatGPT web surface in the same native window.

### Estado durável e cache de chats

O backend persiste o estado operacional das sessões em `.harness/state/sessions.json`; planos, request ids pendentes e resultados deixam de desaparecer quando a stack é reiniciada. Em Protected Mode, verificações que já falhavam na baseline podem ser classificadas como dívida preexistente somente quando o resultado pós-patch é idêntico.

No Desktop, cada Harness Chat pode manter um `WebContentsView` próprio em memória. Até 20 chats recentes permanecem vivos em cache LRU, permitindo alternância instantânea sem recarregar a conversa do ChatGPT. O cache de DOM é deliberadamente somente em memória; após encerrar o Electron, as URLs persistidas continuam sendo a fonte para reabrir as conversas.


## What v1.2.8 includes

- **Wharness Desktop** (`services/desktop`) built with Electron `WebContentsView`.
- ChatGPT displayed beside the Harness without iframe/CSP limitations.
- Persistent ChatGPT browser session under `persist:wharness-chatgpt`; if the account is logged out, ChatGPT itself presents its login flow in the embedded surface.
- No arbitrary ChatGPT DOM inspection, prompt injection, response scraping, or normal-operation cookie inspection. External OAuth has one narrow main-process exception: a Wharness-owned dedicated Chrome/Chromium/Brave profile relays only `chatgpt.com` cookies after an authenticated callback; values never reach renderer IPC or logs.
- **Copy context ZIP** writes the current context bundle to the OS clipboard as a native copied file.
- Context is refreshed immediately before the ZIP is copied.
- Browser-like ChatGPT controls: back, forward, reload and focus.
- Multiple Harness chats per workspace, each with its own backend session, local transcript, title, and persistent ChatGPT conversation URL.
- Switching Harness chats automatically navigates the embedded ChatGPT view back to the conversation linked to that chat.
- New Harness chats start on a fresh ChatGPT surface and automatically bind the first concrete `chatgpt.com/c/...` conversation URL.
- After a submitted prompt, Desktop waits for that concrete conversation URL to be stable and loaded, then publishes the binding globally so it is persisted even when the ChatGPT inspector is not visible.
- Active Auto deliveries have bounded ChatGPT liveness recovery: recoverable transport/renderer failures reload the owned page; silent or stalled processing reloads once and, if still interrupted, sends one same-request recovery prompt without changing scope.
- Clipboard JSON import for the response plan.
- Per-project **Protected / Unprotected** Agent execution switch in the workspace UI, persisted independently for each project.
- Protected remains the default; Unprotected executes validated Agent plans directly in the host project after explicit confirmation.
- Patch application diagnostics now surface Git stderr and can conservatively retry malformed hunk counts with `git apply --recount` (and checked `--3way` when Git blob metadata is present).
- v1.1 Editor/Agent modes, Explorer, editor, sandbox terminal and workspace recovery remain intact.

## Architecture

```text
Wharness Desktop (Electron BrowserWindow)
│
├── Local Wharness frontend (React)
│   ├── Editor
│   └── Agent
│       ├── Harness Chat
│       ├── Plan / execution inspector
│       └── reserved ChatGPT viewport
│
└── ChatGPT WebContentsView
    ├── https://chatgpt.com
    ├── isolated remote renderer
    ├── persistent web session
    └── NO Wharness preload / Node.js access

Go backend
├── context ZIP + manifest
├── planner/provider adapters
├── policy engine
├── file/editor APIs
└── Docker sandbox runner
```

Agent execution is selected per project in the UI. **Protected** is the default:

`Plan -> Policy -> Sandbox -> Verification -> Explicit Apply`

When the user explicitly switches that project to **Unprotected** and confirms execution:

`Plan -> Policy -> Host execution -> Verification -> Applied`

Unprotected removes the sandbox for the Agent plan only. It does not bypass protocol validation or Policy Engine checks, and the Editor terminal remains sandboxed.

## Automatic Git bootstrap

Opening a workspace guarantees that the selected project root owns a Git repository. If `.git` is absent, the backend runs `git init` automatically before building context. It does not create an automatic host commit or overwrite `.gitignore`. Before host apply the repository is checked again.

Every sandbox copy gets its own temporary Git repository and baseline commit after secret/excluded files have been removed. This makes allowed verification commands such as `git diff --check` meaningful inside the sandbox without copying host `.git` metadata or credentials.

For Node.js projects, `node_modules` stays out of model context and the initial sandbox snapshot. When a Protected command such as `npm run build` actually needs local dependencies, Wharness lazily copies the project's existing `node_modules` into the temporary workspace (including safe internal `.bin` symlinks). The host project is still not mounted into Docker. Install dependencies in the project first if they are absent.

## Recommended lifecycle — Desktop

Prerequisites for the desktop lifecycle: Go, Node.js 20+, npm and `curl`. Docker is required only for the explicit Protected runner build/execution path. Run lifecycle commands from the repository root.

### Build the desktop lifecycle

```bash
cd ~/workspace/wharness
make build
```

Cache diagnostics and explicit recovery are available without changing normal lifecycle semantics:

```bash
make deps-status
make deps-refresh    # force only when dependency hydration must be rebuilt
make build-status    # show backend/frontend/desktop artifact-cache state
make build-refresh   # force recompilation, preserving dependency caches
```

`make build` performs the complete desktop/application build path **without invoking Docker**. Dependency hydration is fingerprinted: unchanged Go/Node dependency metadata is a cache hit and does not invoke `go mod download` or npm at all. On a real Node dependency change, Wharness uses deterministic `npm ci --prefer-offline --no-audit --no-fund` with `~/.cache/wharness-npm`, so cached tarballs are reused and audit/funding network work is excluded from the build path.

Compiled artifacts are fingerprinted independently as well. If a component's source/configuration/runtime fingerprint is unchanged and its expected output is present, `make build` skips that component's compilation. Backend-only or no-change rebuilds therefore leave the frontend untouched. When a real frontend change does require Vite, the official versioned precompiled Monaco runtime is copied into the production output instead of making Rollup transform and minify Monaco's full source module graph again.

- validates/reuses the Go module cache and frontend/desktop `node_modules`;
- invalidates dependency stamps automatically when lockfiles or Go/Node/npm runtime versions change;
- reuses unchanged backend/frontend/desktop successful build results independently;
- compiles the Go backend to `dist/bin/wharness-backend` only when backend inputs change;
- builds the React frontend into `services/frontend/dist` only when frontend inputs change;
- validates the Electron main/preload/dev code and installed Electron binary only when desktop inputs change.

The Protected runner image is intentionally decoupled so `make build && make start` cannot wake a socket-activated Docker daemon and recreate host bridges/veth interfaces while Electron/ChatGPT is online. Build the runner only when required:

```bash
# Docker must already be running; Wharness will not auto-start it.
make build-runner

# Explicit equivalent of the old all-in-one build behavior:
make build-all
```

On Linux/systemd, both runner construction and Protected execution refuse to invoke Docker when `docker.socket` is active but `docker.service` is stopped. Start Docker yourself only when you intentionally want to use the Protected Docker runner.

### Start all services + Electron

```bash
cd ~/workspace/wharness
make start
```

`make start` starts a lifecycle coordinator in the background. It starts/reuses:

- backend: `127.0.0.1:8080`;
- built frontend through Vite preview: `127.0.0.1:5173`;
- Wharness Electron desktop shell.

Runtime PID files live under `.harness/run/` and combined logs under `.harness/logs/desktop.log`.

Useful lifecycle commands:

```bash
make status
make logs
make stop
make restart
```

### Export project context

```bash
make export
make export-check
```

`make export` writes the project archive to `../project-context/wharness/wharness.zip` by default. The archive includes a generated root `EXPORTS.md` with export provenance, the current Git branch/HEAD, concise status (including untracked files), `git worktree list --porcelain`, the current Wharness service/HTTP status, and a bounded recent tail of the Wharness desktop log. Runtime log values that look like credentials are redacted. `.git`, raw `.harness` runtime data and Git remote URLs remain excluded. The same synthetic metadata file is also added to context ZIPs generated for projects managed by Wharness, but those managed-project contexts contain project/Git provenance only and do not inherit Wharness host logs/status.

### Linux / Wayland

Wharness automatically prefers X11/XWayland when `$DISPLAY` is available. This avoids the Electron/Chromium Vulkan incompatibility observed with `--ozone-platform=wayland`. On a Wayland-only machine, Wharness selects Wayland and disables Vulkan.

You can override explicitly:

```bash
WHARNESS_OZONE_PLATFORM=wayland make start
```

or:

```bash
WHARNESS_OZONE_PLATFORM=x11 make start
```

### Automatic OpenAI planner

Export provider variables before `make start`:

```bash
export HARNESS_PLANNER=openai
export OPENAI_API_KEY='...'
export OPENAI_MODEL='gpt-5.6-sol'
make start
```

The default remains `HARNESS_PLANNER=manual`.

With the supported provider, every request returns a structured `harness.turn/v1` result. Questions and investigations are rendered directly in Harness without execution. In project Auto mode, only an explicit `change` result continues through Policy, Protected sandbox, verification, and host Apply; no browser download is involved.

## Manual ChatGPT workflow inside one window

1. Open a project and switch to **Agent**.
2. Send the request to the Harness. It prepares the agent-turn prompt and project context.
3. Open the **ChatGPT** tab. The actual ChatGPT site is displayed inside Wharness Desktop.
4. Click **Copiar contexto ZIP**. Wharness refreshes the project snapshot and places the ZIP on the native system clipboard.
5. Click the ChatGPT composer and press `Ctrl+V` to attach the ZIP.
6. Click **Copiar prompt**, then paste the prompt into ChatGPT.
7. Wait for ChatGPT to return `wharness-bundle-<request_id>.zip`, then initiate its download in the ChatGPT surface.
8. Wharness imports the bundle automatically after the download starts. Answers appear in chat; only `change` bundles expose and execute a plan.

Manual import is transport-resilient: Wharness accepts fenced JSON and can repair the narrow case where a unified-diff `patch` contains unescaped source-code quotes (for example CSS `content: "";`). The repaired plan is still subjected to the same strict protocol/path/policy validation before execution.
9. For a change in **Protected**, execute in the sandbox and Apply only after verification. In **Unprotected**, the execution button requires confirmation and runs the validated plan directly on the project; there is no separate Apply step.

The file clipboard behavior uses the OS native copied-file representation. Acceptance of pasted file attachments remains a capability of the destination web application; if a particular ChatGPT UI version does not accept file paste, the ZIP remains available in the OS clipboard/temp path for normal attachment selection.


## Protected / Unprotected per project

The workspace top bar contains a project-scoped execution switch:

- **Protected** (default): Agent patches/commands run in the isolated Docker copy. The real project changes only through the later **Apply** action.
- **Unprotected**: Agent patches/commands/verification run directly in the real `project_path`. Switching into this mode and each direct execution both require explicit confirmation. A failed multi-step plan can leave partial host changes.

The preference is stored by project path and restored when that workspace is reopened. All Harness chats belonging to the workspace follow the same project preference. The interactive Editor terminal deliberately stays sandboxed in both modes.

## Workspace persistence

The active project path, current mode, recent workspaces, active Harness chat, per-chat transcript, per-chat backend session ID, and per-chat ChatGPT conversation URL are stored locally. After `F5` or reopening Wharness Desktop, the active workspace and chat are restored. Selecting another Harness chat restores its own transcript and activates that chat's dedicated embedded ChatGPT renderer, navigating only that renderer to the linked conversation URL. Remote renderers are never reassigned between Harness chats; the common persistent browser partition is used only to share the authenticated ChatGPT browser session. If the Go backend has restarted and a remembered in-memory session no longer exists, Wharness creates a fresh backend session for that chat while preserving the local transcript and ChatGPT URL.

The ChatGPT login/session is persisted by Electron's dedicated browser partition. **Login incorporado** keeps compatible authentication in that view. **Login externo (callback)** launches a real Chrome/Chromium/Brave with a persistent Wharness-owned profile under Electron `userData`, detects the authenticated ChatGPT callback over loopback DevTools, relays only ChatGPT cookies into the dedicated Electron partition, then closes the browser while preserving that profile so future Google/ChatGPT logins can reuse the account/session. **Chrome pessoal** opens the normal system browser with its current profile/session, but remains intentionally isolated and has no cookie relay/callback. Explicit browser-session/full-data clearing removes the dedicated Wharness browser profile. Google OAuth selected from Embedded mode is promoted automatically because Google disallows embedded OAuth user-agents. Set `WHARNESS_BROWSER_EXECUTABLE` when Chrome/Chromium/Brave is installed outside the normal platform paths.

Harness chat attachments are also durable in Desktop mode. Wharness stores private copies under Electron application data rather than inside the target project; the transcript keeps opaque references plus filename/size/MIME metadata. Reopening a chat restores its attachment cards, including image thumbnails when available and native file icons as fallback. Clicking a persisted attachment opens the stored local copy. Attachments from older transcripts created before this storage model remain metadata-only because their original bytes cannot be reconstructed.

## Web-only mode

The original browser workflow remains supported:

```bash
cd services/backend
go run ./cmd/harness
```

and in another terminal:

```bash
cd services/frontend
npm run dev
```

Open `http://127.0.0.1:5173`. In a normal browser the ChatGPT tab shows the web/manual fallback; direct ChatGPT composition is a Desktop feature.

## Security posture

Wharness Desktop does **not** turn ChatGPT into a privileged renderer. Remote ChatGPT content runs with:

- `nodeIntegration: false`
- `contextIsolation: true`
- Chromium sandbox enabled
- `webSecurity: true`
- no Wharness preload
- dedicated persistent partition
- sensitive permissions denied by default

The privileged preload exists only on the allowlisted local Wharness frontend and exposes a narrow IPC surface. The renderer cannot provide arbitrary URLs to the context-copy action; Electron derives the context endpoint from the configured local backend and a validated session ID.

Read `SECURITY.md`, `SoT/SECURITY_MODEL.md`, `SoT/THREAT_MODEL.md`, and `adr/ADR-0005-desktop-chatgpt-composition.md` and `adr/ADR-0006-chat-conversation-affinity.md` before changing these boundaries.

## Quality gates and lifecycle

```bash
make build
make check
make start
make status
make logs
make stop
```

Focused gates remain available as `make backend-check`, `make frontend-check`, and `make desktop-check`. All normative rules are rooted in `AGENTS.md` and `SoT/`.

### Project bootstrap and `whaness.yml`

Wharness Desktop can open a project with the native folder explorer, create a Git-initialized project below a selected directory, or clone a repository with all submodules recursively. Every project receives `whaness.yml` when missing. Use the project-settings button in the workspace top bar to tune automatic context pruning, include/exclude patterns, and the maximum per-file context size. See `docs/project-config.md`.
