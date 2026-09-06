# Development

Backend is Go with `database/sql` and the pgx PostgreSQL driver. Frontend uses React/Vite/TypeScript. Docker is optional for compilation and required for the PostgreSQL Session Store and the default execution path.

## Linux Electron sandbox

Wharness never launches Electron with `--no-sandbox`. On Linux, the durable launch path is a versioned, root-owned Electron runtime outside the project workspace, under `/opt/wharness/electron/<version>-linux-<arch>/`. The complete Electron distribution is copied there once; its `chrome-sandbox` is `root:root` mode `4755`, the runtime tree is root-owned and non-writable by ordinary users, and startup verifies SHA-256 hashes recorded in a root-owned runtime manifest.

This separation is intentional: `node_modules` is dependency/cache state and `npm install`/`npm ci` may replace it at any time. Wharness therefore **never makes `services/desktop/node_modules/electron/dist/chrome-sandbox` privileged in place**. Normal `make build`, dependency reinstalls, project cleanup and worktree changes cannot alter the runtime used by Electron.

Install or synchronize the runtime after the first build, and only again when the pinned Electron version changes:

```bash
make build
make electron-runtime-install
make electron-runtime-check
make start
```

`make start`, `make run-desktop`, `npm run dev` and `npm start` all resolve the exact runtime for the Electron version currently pinned by the project and pass that absolute binary to the desktop coordinator. If a matching immutable runtime is unavailable but unprivileged user namespaces are genuinely usable, Wharness may use the workspace Electron with only `--disable-setuid-sandbox`. If neither path is safe, startup fails closed. Compatibility aliases `make electron-sandbox-check` and `make electron-sandbox-install` map to the runtime manager; the old standalone `/usr/local/lib/wharness/chrome-sandbox` recovery helper is removed during runtime installation.
