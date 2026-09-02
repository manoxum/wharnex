# Wharness Desktop v1.2.1

Wharness is a local coding-agent harness and lightweight IDE. It combines a React workspace, a Go orchestration backend, isolated Docker execution and—when launched through **Wharness Desktop**—a real ChatGPT web surface in the same native window.

## What v1.2.1 adds

- **Wharness Desktop** (`services/desktop`) built with Electron `WebContentsView`.
- ChatGPT displayed beside the Harness without iframe/CSP limitations.
- Persistent ChatGPT browser session under `persist:wharness-chatgpt`; if the account is logged out, ChatGPT itself presents its login flow in the embedded surface.
- No ChatGPT DOM inspection, cookie reading, prompt injection, or response scraping.
- **Copy context ZIP** writes the current context bundle to the OS clipboard as a native copied file.
- Context is refreshed immediately before the ZIP is copied.
- Browser-like ChatGPT controls: back, forward, reload and focus.
- Clipboard JSON import for the response plan.
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

The model still never executes directly on the host. Agent plans follow:

`Plan -> Policy -> Sandbox -> Verification -> Explicit Apply`

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
9. Execute in the sandbox; apply to the host only after verification.

The file clipboard behavior uses the OS native copied-file representation. Acceptance of pasted file attachments remains a capability of the destination web application; if a particular ChatGPT UI version does not accept file paste, the ZIP remains available in the OS clipboard/temp path for normal attachment selection.

## Workspace persistence

The active project path, live session ID, current mode, recent workspaces and local chat transcript are stored locally. After `F5`, Wharness resumes the workspace. If the Go backend has restarted and the in-memory session no longer exists, the frontend reopens the remembered project automatically.

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

Read `SECURITY.md`, `SoT/SECURITY_MODEL.md`, `SoT/THREAT_MODEL.md`, and `adr/ADR-0005-desktop-chatgpt-composition.md` before changing these boundaries.

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
