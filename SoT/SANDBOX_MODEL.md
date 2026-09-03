# Sandbox Model SoT

`Protected` is the default per-project Agent execution mode and uses Docker.

Required controls:

- no original project bind mount;
- isolated copied workspace mounted read-write;
- root filesystem read-only;
- `/tmp` tmpfs;
- `--cap-drop ALL`;
- `no-new-privileges`;
- pids/memory/CPU limits;
- network `none` by default;
- no Docker socket;
- non-root host UID/GID when possible.
- normal `make build` / `make start` lifecycle MUST NOT invoke Docker or activate the Docker daemon; runner image construction is an explicit operator action.
- on Linux/systemd, Protected execution MUST fail closed when `docker.socket` is active but `docker.service` is stopped, rather than triggering socket activation that can recreate host bridges/routes while the desktop browser is online.

Local sandbox exists only for tests/development and must require explicit opt-in.

Sandbox project copies initialize a fresh temporary Git repository and baseline commit. The host `.git` directory is excluded from the copy; this baseline exists only to support deterministic patching and read-only Git verification inside the isolated workspace.

Node dependency hydration is execution-only. `node_modules` MUST remain excluded from context/model payloads and from the initial sandbox snapshot. For Protected Node package scripts that require local dependencies, the runner MAY lazily copy an existing project-local `node_modules` tree into the temporary sandbox. It MUST NOT mount the host project or dependency tree into the container. Internal dependency symlinks may be rewritten to their copied sandbox targets; any dependency symlink that escapes the project root MUST be rejected.

## Unprotected exception

A workspace may be explicitly switched to `Unprotected` in the UI. This is not a sandbox variant: Agent plan operations execute directly in the real project directory. The Policy Engine remains mandatory and each direct execution requires user confirmation. The UI must display a persistent host-direct warning while the mode is active. This choice is stored per project and must never become the global/default mode.

The Editor interactive terminal is independent of Agent execution mode. Its default target is the sandbox. A human may explicitly select `Host`; that target executes argv directly in the real project through the same host runner used for controlled host execution, requires an explicit UI confirmation, remains Policy Engine constrained, and must show a persistent host-direct warning. Selecting Agent Unprotected MUST NOT switch the terminal target automatically.
