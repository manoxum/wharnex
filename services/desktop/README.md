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
- Clipboard file creation happens in the Electron main process through an allowlisted IPC command.
