# Sandbox Model SoT

Production/default execution uses Docker.

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

Local sandbox exists only for tests/development and must require explicit opt-in.
