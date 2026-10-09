# Native launcher splash output

The splash starts compact, with its output panel collapsed and the most recent
captured line visible. Expanding reveals a scrollable complete history of this startup; collapsing
reduces the native window height from 570 to 375 logical pixels. Native resizing
temporarily unlocks the non-resizable window on Linux, then locks it again. It
keeps the user's dragged position. Header/title areas are explicit drag regions;
log selection, scrolling, expand/collapse and copy remain ordinary controls.

Startup commands retain stdout/stderr and their exit codes. The splash captures
an append-only redacted journal and observes only new Desktop diagnostics, rather than
replaying historical output. Stderr rows use a red background without stream-name
labels. Scrolling back pauses automatic following; copying copies the complete
startup output even while collapsed. Main derives clipboard text from its own
sanitized journal history; the renderer sends only a copy intent. Failure leaves the
splash available until the user closes it.

The splash launches through its own canonical `wharnex-splash` Electron package,
sets its per-instance installed desktop-entry identity and supplies a real PNG.
It resolves the host icon directory or the explicit installed-location override,
ignoring an IDE's private XDG location. Existing `WHARNESS_*` launcher/profile and
status/ready environment inputs remain compatibility boundaries.

Refactoring is confined to native splash presentation, output capture/readback,
clipboard and geometry plus their launcher handoff. Page/style/renderer code is
extracted behind a splash view entry point; output and window contracts have their
own entry points. All new implementation/test files are below 200 lines and each
owning directory is below 20 files. The inline-CSS bootstrap exception is named in
`SoT/FRONTEND_STYLING.md`; it avoids depending on a frontend build during startup.

Verification on 2026-10-06:

- Splash unit tests: 18 passed; browser behavior test: passed, including default
  collapse, latest-line updates, stderr styling, copy intent, accessible controls,
  safe text rendering, scrollback and compact layout.
- Native Electron/Xvfb verification: PNG taskbar icon and matching desktop
  identity present; default 375px height, expansion to 570px, collapse to 375px,
  copy confirmation and native drag-region declarations verified.
- Complete Desktop check: 1,018 tests passed. Splash browser test lint and launcher
  lifecycle/install/fingerprint/daemon-guard checks passed.
- `git diff --check` passed. Global structural gates remain blocked by unrelated
  work: the oversized scheduler settlement test and overfull backend app/UI-testing
  HTTP API directories. Splash files satisfy the size and domain limits.

The copy control is icon-only, immediately before expand/collapse. Its accessible
name and tooltip remain explicit; confirmation uses a check icon and tooltip.

Icon-only copy verification: startup browser coverage confirms icon persistence on
success/failure, accessible feedback, copy intent and the copy-before-toggle order
in both DOM and screen geometry. All 18 splash unit tests still pass.

Startup history MUST NOT be reduced to the last 120/160 lines or disappear after
one megabyte. Capture appends rather than rewriting a rolling snapshot. Readers
keep every current-startup line, including earlier Desktop lines after rotation,
and skip diagnostics from before startup. Native IPC and rendering append bounded
batches without replacing existing rows; retries are idempotent. Copy freezes the current file boundaries and drains unread journal entries before
deriving the full clipboard text, so continuously arriving output cannot prevent
the copy gesture from finishing.


Complete-history validation (2026-10-06):

- The original regression reproduced a 402-line startup truncated to 120 rows.
  Append-only capture, incremental reading and rendering now preserve the first
  and last rows across commands, retries, log rotation and histories over 1 MiB.
- All 24 splash unit tests pass; both splash browser scenarios pass, including
  2,501 captured rows, duplicate-delivery prevention and scrollback preservation.
- Actual Electron/Xvfb retains and copies all 2,501 rows to the native clipboard;
  the icon-only control, taskbar identity/icon, drag regions and 375/570px geometry
  remain verified. The complete Desktop build/check passes all 1,024 tests.
- Launcher and lifecycle checks pass. The temporary journal has no persisted-data
  migration impact; status/ready launcher compatibility inputs are unchanged.
