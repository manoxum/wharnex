# Wharness Desktop

Electron shell that composes the local Wharness frontend and dedicated isolated ChatGPT `WebContentsView` instances, one per live Harness chat, in one native window.

## Development start

```bash
cd services/desktop
npm install
npm run dev
```

`npm run dev` reuses backend/frontend servers already listening on `127.0.0.1:8888` and `127.0.0.1:5173`; otherwise it starts them and then launches Electron.

## Security boundary

- ChatGPT remote content has no preload and no Node integration.
- `sandbox`, `contextIsolation`, and `webSecurity` remain enabled.
- The Wharness preload is attached only to the trusted local frontend origin.
- Every live Harness chat owns a distinct ChatGPT `WebContentsView`; the shared persistent partition `persist:wharness-chatgpt` carries login/browser storage only and is never used as a DOM-sharing surface.
- Wharness never reads arbitrary/cross-chat ChatGPT page content. The narrow allowlisted DOM probes used for composer readiness, bounded activity/download detection and submission run only inside the owning chat renderer after owner validation; cookies remain inside the shared Electron session boundary.

## Composer attachments

In manual-planner Desktop mode, the Harness composer accepts up to 10 user-selected files (25 MiB each, 100 MiB total), whether selected with **Anexar** or pasted from the native clipboard with `Ctrl+V`. Sending prepares the remote ChatGPT composer with the agent-turn prompt and selected files through native clipboard/input events. The refreshed project context ZIP is included on the first turn of a conversation, after a conversation URL change, or when the project snapshot hash changed; unchanged sequential turns reuse the context already attached. In Manual mode, Wharness stops before submission: visually verify ChatGPT's attachment chips, then use **Confirmar e enviar**. In project Auto mode, it submits after a bounded settle delay and waits for the matching validated result-bundle download. ChatGPT web still requires the download to be initiated on its surface because Wharness never inspects or clicks remote output. A supported provider adapter returns the turn directly and is the fully unattended path.

Result bundles contain `turn.json`. Answers, clarifications, investigations, and blocked results are displayed in chat and never execute. `workflow` bundles contain a command-only `plan.json`; in Auto they run only in a disposable Protected sandbox and their observations are submitted back to the same ChatGPT conversation for another bounded reasoning round. `change` bundles are the only branch that may contain patches and continue through automatic sandbox verification and host Apply.
- Clipboard file creation happens in the Electron main process through an allowlisted IPC command.

## Harness chat affinity

Each live Harness chat owns one dedicated remote `WebContentsView` identified by that chat's stable local id. Switching chats hides the previous view and reveals/navigates only the selected chat's own view; Wharness never reassigns a remote renderer from one chat to another. All DOM/input/navigation IPC carries the chat id and the Electron main process rejects ownership mismatches before touching the remote renderer. The shared `persist:wharness-chatgpt` partition exists only to preserve a common authenticated browser session. Permanent local chat deletion explicitly destroys that chat's remote view. Renderer-requested navigation remains restricted to trusted HTTPS `chatgpt.com` origins.
