# Sandbox Model SoT

`Protected` is the default per-project Agent execution mode and uses Docker.

Required controls:

- no original project bind mount;
- isolated copied workspace mounted read-write;
- root filesystem read-only;
- `/tmp` tmpfs with explicit `exec` (plus `nosuid,nodev`) so language test runners such as `go test` can execute binaries compiled into the temporary filesystem;
- `--cap-drop ALL`;
- `no-new-privileges`;
- pids/memory/CPU limits;
- network `none` by default;
- no Docker socket;
- non-root host UID/GID when possible.
- the canonical application lifecycle is Docker-backed: `make build-stage` MAY build backend/frontend/tunnel service images without replacing the running stack; `make build` MAY reconcile application service containers after staging. The Protected runner image remains a separate explicit `make build-runner` action and MUST NOT be implicitly rebuilt by either target.
- the containerized backend MAY mount the host Docker socket because it owns the trusted sandbox adapter, but it MUST preserve host-visible canonical workspace/bridge paths when asking the host daemon to create runner containers. The runner itself MUST NEVER receive the Docker socket.
- `make stop` MUST stop only the host Desktop/coordinator. PostgreSQL and tunnel infrastructure are persistent stack services and may be stopped only by explicit stack lifecycle commands.
- on Linux/systemd, Protected execution MUST fail closed when `docker.socket` is active but `docker.service` is stopped, rather than triggering socket activation that can recreate host bridges/routes while the desktop browser is online.
- on Linux, the Electron desktop MUST NOT depend on privileged metadata inside project `node_modules`. The primary SUID launch path is a versioned, root-owned, non-user-writable Electron runtime outside the workspace (default `/opt/wharness/electron/<version>-linux-<arch>/`) whose complete distribution and root-owned checksum manifest are validated before launch; only that runtime's adjacent `chrome-sandbox` may be mode `4755`. `npm install`, `npm ci`, normal builds and worktree changes MUST NOT mutate that privileged runtime. A version change requires explicit runtime synchronization. If no matching runtime exists, Wharness MAY use the workspace Electron only after an actual unprivileged user-namespace probe succeeds and only with `--disable-setuid-sandbox`; `--no-sandbox` remains forbidden.

Local sandbox exists only for tests/development and must require explicit opt-in.

Sandbox project copies initialize a fresh temporary Git repository and baseline commit. The host `.git` directory is excluded from the copy; this baseline exists only to support deterministic patching and read-only Git verification inside the isolated workspace. A source is treated as an existing Git repository only when that exact source directory is the repository top-level. Git discovery through an ancestor MUST NOT cause an extracted immutable base or other internal directory beneath `.harness/bridge` to be cloned as though it owned the ancestor repository.

Concurrent Protected work uses two isolated stages. First, the model patch is reconstructed and verified against the immutable request base. Second, immediately before Apply, the ordered ChangeSets are three-way merged with the current host into a fresh copied sandbox and their verification commands are rerun. Neither stage mutates the original project. Only a clean, verified staged result may enter the short serialized host commit phase.

Node dependency hydration is execution-only. `node_modules` MUST remain excluded from context/model payloads and from the initial sandbox snapshot. For Protected Node package scripts that require local dependencies, the runner MAY lazily copy an existing project-local `node_modules` tree into the temporary sandbox. A sandbox reconstructed from an immutable request base MUST retain the original project root solely as this dependency source; it MUST NOT search for dependencies inside the partial historical archive. It MUST NOT mount the host project or dependency tree into the container. Internal dependency symlinks may be rewritten to their copied sandbox targets; any dependency symlink that escapes the project root MUST be rejected.

Go dependency hydration is likewise execution-only and offline. Before a Protected `go build`, `go test`, `go vet`, `go run`, `go list`, or `go install`, Wharness inventories the exact module versions already present in the host Go module cache with `GOPROXY=off`, copies only those module directories plus their authenticated cache metadata into private sandbox storage, and runs the container against that copied cache with `GOPROXY=off`. Missing modules fail before verification as `offline sandbox dependencies unavailable`, with an instruction to hydrate the host cache explicitly. They MUST NOT be misclassified as patch/ChangeSet failure or trigger an automatic ChatGPT repair request. Host dependency directories are never mounted into the runner.

## Unprotected exception

A workspace may be explicitly switched to `Unprotected` in the UI. This is not a sandbox variant: Agent plan operations execute directly in the real project directory. The Policy Engine remains mandatory and each direct execution requires user confirmation. The UI must display a persistent host-direct warning while the mode is active. This choice is stored per project and must never become the global/default mode.

The Editor interactive terminal is independent of Agent execution mode. Its default target is the sandbox. A human may explicitly select `Host`; that target executes argv directly in the real project through the same host runner used for controlled host execution, requires an explicit UI confirmation, remains Policy Engine constrained, and must show a persistent host-direct warning. Selecting Agent Unprotected MUST NOT switch the terminal target automatically.
