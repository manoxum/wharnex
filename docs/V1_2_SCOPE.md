# V1.2 Scope — Wharness Desktop

## Added

- Electron desktop shell.
- Native `WebContentsView` ChatGPT surface.
- Persistent ChatGPT web session partition.
- Browser controls and native view lifecycle synchronized with React tab bounds.
- Context refresh endpoint exposed for explicit bundle refresh.
- Native copied-file clipboard for the current context ZIP.
- Clipboard JSON import.
- One-command desktop development launcher that starts/reuses backend and frontend.

## Preserved

- Editor/Agent workspace modes.
- Explorer/editor/terminal.
- Workspace persistence and recovery.
- Manual planner and OpenAI API planner.
- Policy/sandbox/verification/explicit-host-apply architecture.

## Explicit non-goals

- Reading ChatGPT DOM, cookies, local storage, conversation content, or login state.
- Automatically extracting ChatGPT output.
- Injecting arbitrary JavaScript into ChatGPT.
- Giving ChatGPT access to filesystem, shell, Electron IPC, or Wharness preload APIs.
