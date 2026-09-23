# Wharnex (WHX) Desktop

Wharnex is a local coding-agent harness and lightweight IDE. **WHX** is its short code. Existing `wharness-*` bundle names, environment variables, storage keys and executable paths remain compatibility identifiers for protocol v1.

### Estado durável e cache de chats

O backend persiste cada sessão como um registo independente no PostgreSQL local gerido pelo lifecycle Docker. O antigo `.harness/state/sessions.json` é migrado automaticamente e mantido apenas como backup legado; planos, request ids pendentes e resultados não desaparecem quando a stack é reiniciada. Em Protected Mode, verificações que já falhavam na baseline podem ser classificadas como dívida preexistente somente quando o resultado pós-patch é idêntico.

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

`Plan -> Policy -> Informed approval -> Sandbox -> Verification -> Automatic host integration`

When the user explicitly switches that project to **Unprotected** and confirms execution:

`Plan -> Policy -> Host execution -> Verification -> Applied`

Unprotected removes the sandbox for the Agent plan only. It does not bypass protocol validation or Policy Engine checks, and the Editor terminal remains sandboxed.

## Automatic Git bootstrap

Opening a workspace guarantees that the selected project root owns a Git repository. If `.git` is absent, the backend runs `git init` automatically before building context. It does not create an automatic host commit or overwrite `.gitignore`. Before host apply the repository is checked again.

Every sandbox copy gets its own temporary Git repository and baseline commit after secret/excluded files have been removed. This makes allowed verification commands such as `git diff --check` meaningful inside the sandbox without copying host `.git` metadata or credentials.

For Node.js projects, `node_modules` stays out of model context and the initial sandbox snapshot. When a Protected command such as `npm run build` actually needs local dependencies, Wharness lazily copies the project's existing `node_modules` into the temporary workspace (including safe internal `.bin` symlinks). The host project is still not mounted into Docker. Install dependencies in the project first if they are absent.

## Recommended lifecycle — Desktop

Prerequisites for the desktop lifecycle: Go, Node.js 20+, npm, `curl`, Docker Engine and Docker Compose v2. Desktop runs on the host; backend, frontend, PostgreSQL and all tunnel clients run in the project-owned Compose stack.

`make build` builds/stages application artifacts and Compose images, then reconciles backend/frontend without recreating the persistent tunnel/database services. `make start` ensures that stack and launches Desktop. `make stop` stops Desktop only. Use `make stack-stop` or `make stack-down` only when you intentionally want to interrupt the persistent service stack and any ephemeral tunnel URLs. Transactional self-evolution uses `make build-stage`, which never activates replacement containers; restart activation is handed to a detached supervisor container so replacing backend/frontend cannot kill the restart worker, and a failed rollout restores the previous application images without restarting tunnel/database.

On first stack initialization, Wharness reuses the existing PostgreSQL credentials and migrates a compatible PostgreSQL 17 `.harness/postgres/data` directory into the Compose named volume before starting the new database.

### Build the desktop lifecycle

```bash
cd ~/workspace/wharnex
make build
```

Cache diagnostics and explicit recovery are available without changing normal lifecycle semantics:

```bash
make deps-status
make deps-refresh    # force only when dependency hydration must be rebuilt
make build-status    # show backend/frontend/desktop artifact-cache state
make build-refresh   # force recompilation, preserving dependency caches
```

`make build` performs the complete desktop/application build path, builds the Compose service images and the configured local Protected runner image, and reconciles backend/frontend while preserving the running tunnel/database containers. `make build-stage` performs only application staging without activating replacement containers or changing the runner used for transactional self-evolution. Dependency hydration is fingerprinted: unchanged Go/Node dependency metadata is a cache hit and does not invoke `go mod download` or npm at all. On a real Node dependency change, Wharness uses deterministic `npm ci --prefer-offline --no-audit --no-fund` with `~/.cache/wharness-npm`, so cached tarballs are reused and audit/funding network work is excluded from the build path.

Compiled artifacts are fingerprinted independently as well. If a component's source/configuration/runtime fingerprint is unchanged and its expected output is present, `make build` skips that component's compilation. Backend-only or no-change rebuilds therefore leave the frontend untouched. When a real frontend change does require Vite, the official versioned precompiled Monaco runtime is copied into the production output instead of making Rollup transform and minify Monaco's full source module graph again.

Every build reclaims obsolete storage once the replacement services are healthy, so `make build`, `make build-all`, `make build-refresh`, `make install-dev` and the `make start` path that rebuilds a stale checkout all leave the machine smaller than they found it. The backend reclaims what it has records for — leaked temporary directories, abandoned sandbox workspaces and per-project dependency caches no session reaches — and the host reclaims what the backend cannot see: settled self-evolution transaction snapshots beyond the retention window, oversized lifecycle logs, and Docker layers and build cache unused for that same window. Reclamation is obsolescence-proven and never a cache wipe: valid fingerprinted dependency and artifact caches survive, so the next build stays a cache hit, and the immediately previous image generation survives so a failed rollout keeps its image-level rollback. It is housekeeping and never fails a build — what it could not reclaim is reported.

```bash
make storage-prune     # backend ownership-aware cleanup on its own
make storage-reclaim   # host-side reclamation on its own

WHARNESS_RECLAIM_KEEP_HOURS=72   # retention window for layers, build cache and transactions
WHARNESS_RECLAIM_DOCKER=0        # skip the Docker stage entirely
WHARNESS_RECLAIM_VOLUMES=1       # also reclaim orphaned anonymous Docker volumes
```

Anonymous-volume reclamation is opt-in because it is machine-global and a third-party image that declares `VOLUME` without a named mapping keeps real data in one. It only ever removes volumes Docker itself reports as attached to no container, and never a named volume, so this checkout's PostgreSQL and MinIO state is out of reach by construction. Without the opt-in, `make build` just reports how much is sitting there.

`make clean`, `make deps-refresh` and `make build-refresh` remain the explicit unconditional paths when you actually want caches rebuilt rather than pruned.

- validates/reuses the Go module cache and frontend/desktop `node_modules`;
- invalidates dependency stamps automatically when lockfiles or Go/Node/npm runtime versions change;
- reuses unchanged backend/frontend/desktop successful build results independently;
- compiles the Go backend to `dist/bin/wharness-backend` only when backend inputs change;
- builds the React frontend into `services/frontend/dist` only when frontend inputs change;
- validates the Electron main/preload/dev code and installed Electron binary only when desktop inputs change.

The canonical build now materializes the local-only Protected runner image as well as the application images. Docker must already be explicitly running; lifecycle commands refuse unsafe socket activation:

```bash
# Complete machine build, including kernl-runner:local by default.
make build

# Direct recovery/rebuild of the default configured tag:
make build-runner RUNNER_IMAGE="kernl-runner:local"
```

Wharnex never pulls the Protected runner from a registry. If it is absent,
Protected execution and the copied-sandbox terminal stop before `docker run`
and name the exact direct recovery command. A normal `make build` prevents that
state on a freshly compiled machine by building the configured image locally.

On Linux/systemd, database startup, runner construction and Protected execution refuse to invoke Docker when `docker.socket` is active but `docker.service` is stopped. Start Docker explicitly before `make start`.

### Start all services + Electron

```bash
cd ~/workspace/wharnex
make start
```

`make start` first reconciles the persistent Compose services and then starts the host Desktop lifecycle coordinator. The Compose services are:

- project-owned PostgreSQL and MinIO on the private Compose network;
- backend, local frontend and paired remote webapp on the private Compose network;
- a single Nginx application gateway on `127.0.0.1:6969` by default (override with `WHARNESS_GATEWAY_PORT`);
- the dedicated tunnel daemon, which can route an explicitly configured public tunnel to the gateway's private remote listener;
- Wharnex Electron desktop shell.

Running more than one checkout of this repository concurrently: each checkout's
Compose project name defaults to its own folder name (override with
`WHARNESS_COMPOSE_PROJECT_NAME`), and its gateway port defaults to 6969 (override with
`WHARNESS_GATEWAY_PORT`) so the stacks don't collide. Persist these in a gitignored
`.harness/env` file at the repo root instead of exporting them every session. Bare
frontend/backend development outside stack mode may still use 5173/8888 directly.

Runtime PID files live under `.harness/run/` and combined logs under `.harness/logs/desktop.log`.

Useful lifecycle commands:

```bash
make status
make logs
make logs SOURCE=frontend
make logs SOURCE=electron FILTER=error
make logs SOURCE=chatgpt FOLLOW=1 TAIL=200
make stop
make restart
```

`make logs` prints a categorized snapshot from the frontend container, Electron,
ChatGPT transport and self-evolution. Select one with `SOURCE=frontend|electron|chatgpt|self`,
filter case-insensitively with `FILTER=...`, and use `FOLLOW=1` for a continuous stream.
The underlying `scripts/logs.sh` also accepts conventional CLI flags such as
`-f`, `-s chatgpt`, `-g error`, and `-n 200`.

### Export project context

```bash
make export
make export-check
```

`make export` writes the project archive to `../project-context/wharness/wharness.zip` by default. The export is intentionally a compact source/diagnostic snapshot rather than a backup: repository `patches/` are retained as useful distribution/debugging history, while IDE metadata, nested `.harness` state, `.orig/.rej` residues, dependency/build trees and generated Wharness context/input/bundle payloads are omitted. The archive includes generated root `EXPORTS.md` provenance with Git/runtime diagnostics plus `EXPORT_INDEX.md` with the exclusion policy, top-level inventory and largest included entries. Runtime log values that look like credentials are redacted. `.git`, raw runtime data and Git remote URLs remain excluded. The command prints the final path, human/byte size, entry count, retained patch-file count and SHA-256. The same synthetic `EXPORTS.md` provenance is also added to contexts generated for projects managed by Wharness, but those managed-project contexts contain project/Git provenance only and do not inherit Wharness host logs/status.

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

With the supported provider, every request returns a structured `harness.turn/v1` result with an explicit planner outcome. Questions and investigations are rendered directly in Harness without execution. Failed or partial planner outcomes are surfaced as request failures and never execute. In project Auto mode, only a completed explicit `change` result continues through Policy, Protected sandbox, verification, and host Apply; no browser download is involved.

## Manual ChatGPT workflow inside one window

1. Open a project and switch to **Agent**.
2. Send the request to the Harness. It prepares the agent-turn prompt and project context.
3. Open the **ChatGPT** tab. The actual ChatGPT site is displayed inside Wharness Desktop.
4. In the composer transport menu, enable the request ZIP, live verification tunnels, or both. The global default can be overridden per chat.
5. Send the request. With ZIP enabled, Wharness uploads exactly one `wharness-input-<request_id>.zip` containing the prompt (with its inline `@file`/`@ref` markers), refreshed context, referenced files and attachments. With tunnels enabled, it also publishes every configured tunnel in priority order.
6. Wait for ChatGPT to return `wharness-bundle-<request_id>.zip`, then initiate its download in the ChatGPT surface.
7. Wharness imports the bundle automatically after the download starts. Answers appear in chat; only completed `change` bundles expose and execute a plan.

Manual import is transport-resilient: Wharness accepts fenced JSON and can repair the narrow case where a unified-diff `patch` contains unescaped source-code quotes (for example CSS `content: "";`). The repaired plan is still subjected to the same strict protocol/path/policy validation before execution.
9. For a change in **Protected**, the informed execution approval covers sandbox execution and automatic host integration after successful verification; there is no second Apply approval. In **Unprotected**, the execution button requires confirmation and runs the validated plan directly on the project; there is no separate Apply step.

The file clipboard behavior uses the OS native copied-file representation. Acceptance of pasted file attachments remains a capability of the destination web application; if a particular ChatGPT UI version does not accept file paste, the ZIP remains available in the OS clipboard/temp path for normal attachment selection.


## Converging in fewer rounds

A correction that needs several waves used to restart from almost nothing each time. Two things now travel with every continuation request so a wave begins where the last one ended.

**Session attempt ledger** (`harness.attempts/v1`). Wharnex measures every round itself — which plan ran, which argv exited non-zero, whether it was blocked by policy or failed verification — so a failed round reaches the next request whether or not the model wrote it down. ChatGPT returns `attempts/ledger.md` alongside it: a cumulative account of what has been proven to work and to fail *on this machine*, with a "Does not work locally" section that acts as a hard exclusion list. The ledger is refined every wave and discarded when the request ends; whatever is still true for next time gets promoted into project knowledge first.

**Local project divergence** (`harness.context-delta/v1`). Instead of shipping a fresh full baseline every wave, Wharnex states exactly which files moved since the snapshot the conversation already has, with line counts and — for small changes — the real diff inline. An unchanged project says so explicitly, which is useful in itself: it means a patch that failed to apply did not fail because the tree moved.

Both degrade rather than block. A missing ledger or an unmeasurable divergence is recorded and the round continues; neither may ever discard a verified patch.

## Project knowledge

Wharnex accumulates operational learning per project — proven build/apply sequencing, repair causes, conflict patterns, transport gotchas — and attaches it to later requests. It is stored in the local Wharnex database, not in your repository, so committing knowledge never dirties your working tree or arrives in someone else's checkout uninvited.

The composer has a per-chat sharing switch, and the catalog can be managed directly:

- **Export / import** a portable bundle, whole or record by record. Imports verify each record against its digest and can let the incoming copy win, keep your local one, or replace the catalog outright; a selective bundle can never replace, because it says nothing about the records it leaves out.
- **Clear** the catalog or named records. This requires explicit confirmation — it throws away learning that cost real execution rounds.
- **Consolidate**: hand the whole catalog to ChatGPT in one round to merge duplicates, split records that grew into several topics, and drop anything `AGENTS.md`/SoT/ADRs already say. An empty result is rejected; consolidating reorganizes, it never deletes everything.

A project that already carries `.wharnex/knowledge/*.md` from an earlier version adopts those files into the database once, keeping local records on any collision.

## Protected / Unprotected per project

The workspace top bar contains a project-scoped execution switch:

- **Protected** (default): Agent patches/commands run in the isolated Docker copy. The informed execution decision also authorizes the verified candidate to integrate into the real project automatically; a later Apply action exists only for recovery of an already-authorized integration failure.
- **Unprotected**: Agent patches/commands/verification run directly in the real `project_path`. Switching into this mode and each direct execution both require explicit confirmation. A failed multi-step plan can leave partial host changes.

The preference is stored by project path and restored when that workspace is reopened. All Harness chats belonging to the workspace follow the same project preference. The interactive Editor terminal deliberately stays sandboxed in both modes.

### Projects with Git submodules

A superproject and its submodules are treated as one project made of several
repositories (see `adr/ADR-0039` and `adr/ADR-0050`). A change may write
anywhere in it — including inside `services/app/` or any other initialized
submodule — using ordinary project-relative paths. Wharnex verifies the change
with every touched submodule present as a real repository, commits deepest-first
so each parent records its child's gitlink, and on Apply advances each submodule
on the branch it was already on. Nothing has to be configured and no second
Wharnex project is needed.

Two consequences are worth knowing. Those commits are **local**: Wharnex never
pushes to a submodule's remote, so the repositories it committed into hold work
only you can push. And a submodule with no usable checkout still cannot receive
a change — there is no repository to commit into — so such a bundle is refused
with the action that clears it: `git submodule update --init -- <path>`.

## Workspace persistence

The active project path, current mode, recent workspaces, active Harness chat, per-chat transcript, per-chat backend session ID, and per-chat ChatGPT conversation URL are stored locally. After `F5` or reopening Wharness Desktop, the active workspace and chat are restored. Selecting another Harness chat restores its own transcript and activates that chat's dedicated embedded ChatGPT renderer, navigating only that renderer to the linked conversation URL. Remote renderers are never reassigned between Harness chats; the common persistent browser partition is used only to share the authenticated ChatGPT browser session. If the Go backend has restarted and a remembered in-memory session no longer exists, Wharness creates a fresh backend session for that chat while preserving the local transcript and ChatGPT URL.

The ChatGPT login/session is persisted by Electron's dedicated browser partition. **Login incorporado** keeps compatible authentication in that view. **Login externo (callback)** launches a real Chrome/Chromium/Brave with a persistent Wharness-owned profile under Electron `userData`, detects the authenticated ChatGPT callback over loopback DevTools, relays only ChatGPT cookies into the dedicated Electron partition, then closes the browser while preserving that profile so future Google/ChatGPT logins can reuse the account/session. **Chrome pessoal** opens the normal system browser with its current profile/session, but remains intentionally isolated and has no cookie relay/callback. Explicit browser-session/full-data clearing removes the dedicated Wharness browser profile. Google OAuth selected from Embedded mode is promoted automatically because Google disallows embedded OAuth user-agents. Set `WHARNESS_BROWSER_EXECUTABLE` when Chrome/Chromium/Brave is installed outside the normal platform paths.

Background ChatGPT views run with Chromium background throttling disabled, so changing Wharness tab/window focus does not intentionally suspend liveness supervision. Active Auto requests recover bounded renderer/network/DNS/proxy/TLS/HTTP failures, back off rate limits, detect a missing compositor/stuck page, and escalate after the recovery budget instead of waiting silently. Structural CAPTCHA/Turnstile, authentication or access gates pause automation and raise a native **Ação necessária no ChatGPT** notification plus a persistent command-bar action; the user can open the affected chat to complete the required step. This detection stays structural and does not read generated ChatGPT prose, cookies, storage or challenge tokens.

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
