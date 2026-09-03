# Wharness Desktop

Electron shell that composes the local Wharness frontend and a persistent, isolated ChatGPT `WebContentsView` in one native window.

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
- The ChatGPT session uses the persistent partition `persist:wharness-chatgpt`.
- No ChatGPT DOM, cookies, prompts, or responses are read by Wharness.

## Composer attachments

In manual-planner Desktop mode, the Harness composer accepts up to 10 user-selected files (25 MiB each, 100 MiB total), whether selected with **Anexar** or pasted from the native clipboard with `Ctrl+V`. Sending prepares the remote ChatGPT composer with a refreshed project context ZIP, the selected files, and the agent-turn prompt through native clipboard/input events. In Manual mode, Wharness stops before submission: visually verify ChatGPT's attachment chips, then use **Confirmar e enviar**. In explicit project Auto mode, it submits after a bounded settle delay and waits for the matching validated result-bundle download. ChatGPT web still requires the download to be initiated on its surface because Wharness never inspects or clicks remote output. A supported provider adapter returns the turn directly and is the fully unattended path.

Result bundles contain `turn.json`. Answers, clarifications, investigations, and blocked results are displayed in chat and never execute. Only `change` bundles contain `plan.json` and may continue through automatic sandbox verification and host Apply.
- Clipboard file creation happens in the Electron main process through an allowlisted IPC command.

## Harness chat affinity

Wharness reuses one remote `WebContentsView`, but each Harness chat stores its own stable ChatGPT conversation URL. Switching chats navigates the remote surface to that URL. Renderer-requested navigation is restricted to trusted HTTPS `chatgpt.com` origins.
