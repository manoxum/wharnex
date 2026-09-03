# Development

Backend uses only the Go standard library in V1. Frontend uses React/Vite/TypeScript. Docker is optional for compilation but required for the default execution path.

## Linux Electron sandbox

Wharness never launches Electron with `--no-sandbox`. `make start` performs a Linux sandbox preflight before starting the desktop process. The SUID path is valid only when the `chrome-sandbox` shipped beside the Electron executable is `root:root` mode `4755`; Wharness does not rely on `CHROME_DEVEL_SANDBOX` to redirect a packaged Electron build. If that packaged helper is not privileged, Wharness probes whether unprivileged user namespaces are actually usable; when they are, Electron is launched with only `--disable-setuid-sandbox`, leaving Chromium's user-namespace/seccomp sandbox path enabled.

On hosts where unprivileged user namespaces are unavailable, configure the exact helper shipped with the installed Electron version:

```bash
make electron-sandbox-install
make electron-sandbox-check
```

The install target sets `services/desktop/node_modules/electron/dist/chrome-sandbox` to `root:root` mode `4755` and keeps a byte-identical root-owned recovery copy at `/usr/local/lib/wharness/chrome-sandbox`. Packaged Electron still executes the helper beside its own binary; the persistent copy exists only for recovery/diagnostics. Because `npm install`/`npm ci` may recreate `node_modules`, rerun `make electron-sandbox-install` if the preflight later reports that the packaged helper lost its privileged metadata.
