# Wharness Desktop v1.2.8

Wharness is a local coding-agent harness and lightweight IDE. It combines a React workspace, a Go orchestration backend, isolated Docker execution and—when launched through **Wharness Desktop**—a real ChatGPT web surface in the same native window.

## What v1.2.8 includes

- **Wharness Desktop** (`services/desktop`) built with Electron `WebContentsView`.
- ChatGPT displayed beside the Harness without iframe/CSP limitations.
- Persistent ChatGPT browser session under `persist:wharness-chatgpt`; if the account is logged out, ChatGPT itself presents its login flow in the embedded surface.
- No ChatGPT DOM inspection, cookie reading, prompt injection, or response scraping.
- **Copy context ZIP** writes the current context bundle to the OS clipboard as a native copied file.
- Context is refreshed immediately before the ZIP is copied.
- Browser-like ChatGPT controls: back, forward, reload and focus.
- Multiple Harness chats per workspace, each with its own backend session, local transcript, title, and persistent ChatGPT conversation URL.
- Switching Harness chats automatically navigates the embedded ChatGPT view back to the conversation linked to that chat.
- New Harness chats start on a fresh ChatGPT surface and automatically bind the first concrete `chatgpt.com/c/...` conversation URL.
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

## Recommended lifecycle — Desktop

Prerequisites: Go, Node.js 20+, npm, Docker and `curl`. Run lifecycle commands from the repository root.

### Build everything

```bash
cd ~/workspace/wharness
make build
```

`make build` performs the complete local build path:

- downloads/resolves Go modules;
- installs frontend dependencies using `~/.cache/wharness-npm`;
- installs Electron desktop dependencies using the same isolated npm cache;
- compiles the Go backend to `dist/bin/wharness-backend`;
- builds the React frontend into `services/frontend/dist`;
- validates the Electron main/preload/dev code and installed Electron binary;
- builds `kernl-runner:local` using the Dockerfile from the repository root.

This avoids path-sensitive commands such as running `docker build -f docker/runner/Dockerfile .` from inside `services/backend`.

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

## Manual ChatGPT workflow inside one window

1. Open a project and switch to **Agent**.
2. Send the request to the Harness. It prepares the planner prompt.
3. Open the **ChatGPT** tab. The actual ChatGPT site is displayed inside Wharness Desktop.
4. Click **Copiar contexto ZIP**. Wharness refreshes the project snapshot and places the ZIP on the native system clipboard.
5. Click the ChatGPT composer and press `Ctrl+V` to attach the ZIP.
6. Click **Copiar prompt**, then paste the prompt into ChatGPT.
7. When ChatGPT returns the plan JSON, copy it.
8. Click **Colar resposta JSON**, review it, then **Validar plano**.

Manual import is transport-resilient: Wharness accepts fenced JSON and can repair the narrow case where a unified-diff `patch` contains unescaped source-code quotes (for example CSS `content: "";`). The repaired plan is still subjected to the same strict protocol/path/policy validation before execution.
9. In **Protected**, execute in the sandbox and Apply only after verification. In **Unprotected**, the execution button requires confirmation and runs the validated plan directly on the project; there is no separate Apply step.

The file clipboard behavior uses the OS native copied-file representation. Acceptance of pasted file attachments remains a capability of the destination web application; if a particular ChatGPT UI version does not accept file paste, the ZIP remains available in the OS clipboard/temp path for normal attachment selection.


## Protected / Unprotected per project

The workspace top bar contains a project-scoped execution switch:

- **Protected** (default): Agent patches/commands run in the isolated Docker copy. The real project changes only through the later **Apply** action.
- **Unprotected**: Agent patches/commands/verification run directly in the real `project_path`. Switching into this mode and each direct execution both require explicit confirmation. A failed multi-step plan can leave partial host changes.

The preference is stored by project path and restored when that workspace is reopened. All Harness chats belonging to the workspace follow the same project preference. The interactive Editor terminal deliberately stays sandboxed in both modes.

## Workspace persistence

The active project path, current mode, recent workspaces, active Harness chat, per-chat transcript, per-chat backend session ID, and per-chat ChatGPT conversation URL are stored locally. After `F5` or reopening Wharness Desktop, the active workspace and chat are restored. Selecting another Harness chat restores its own transcript and navigates the embedded ChatGPT surface to its linked conversation URL. If the Go backend has restarted and a remembered in-memory session no longer exists, Wharness creates a fresh backend session for that chat while preserving the local transcript and ChatGPT URL.

The ChatGPT login/session is separate and is persisted by Electron's dedicated browser partition.

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
