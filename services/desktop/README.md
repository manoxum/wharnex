# Wharness Desktop

Electron shell that composes the local Wharness frontend with one visible ChatGPT Supervisor `WebContentsView` and three persistent worker views that are hidden by default and backed by the durable browser-agent queue. The Agent runtime drawer can explicitly surface one worker for bounded live interaction without changing scheduler ownership.

## Development start

```bash
cd services/desktop
npm install
npm run dev
```

`npm run dev` reuses backend/frontend servers already listening on `127.0.0.1:8080` and `127.0.0.1:5173`; otherwise it starts them and then launches Electron.

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

The authenticated profile owns exactly one human-facing Supervisor view plus three hidden workers. Harness chats persist their provider `conversation_id`; views are execution slots rather than chat-owned state. Switching chats changes only the Supervisor's desired destination, and navigation is deferred/coalesced while a submit/write critical phase is active. Autonomous jobs are leased from the backend queue to workers and can never use the Supervisor. Every remote operation validates its current chat/conversation assignment, and all views share `persist:wharness-chatgpt` only for the authenticated browser session. Renderer-requested navigation remains restricted to trusted HTTPS `chatgpt.com` origins.
