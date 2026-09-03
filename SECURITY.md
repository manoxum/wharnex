# Security Policy

Wharness is security-sensitive because it transforms AI-produced plans into local execution.

## Supported security posture

The default supported mode is:

- supervised approval;
- Docker sandbox;
- isolated workspace copy;
- network disabled;
- structured argv commands;
- explicit host apply;
- context secret filtering.

Protected is the default. Unprotected is an explicit per-project exception that executes policy-approved Agent plans directly on the real project and therefore removes the sandbox containment boundary for that execution. It must be selected in the UI and confirmed again before every direct run.

## Never do this

- expose the backend to an untrusted network without authentication/reverse-proxy controls;
- run Wharness as root;
- mount `/var/run/docker.sock` into the runner;
- use `HARNESS_SANDBOX=local` for untrusted plans;
- disable policy checks to make a model-generated plan "work";
- make Unprotected the global/default mode, bypass its UI confirmation, or treat it as equivalent to sandboxed execution;
- send `.env`, private keys, credential stores, database dumps, or secret directories to an AI provider.

## Reporting

Do not place secrets in bug reports. Include the session ID, plan ID, redacted logs, and the relevant policy decision.

## Defense in depth

The model may be wrong or manipulated by repository prompt injection. Security therefore does not rely on model obedience. The local policy engine is authoritative in all modes; the sandbox provides the additional containment boundary in Protected mode. Unprotected deliberately removes that containment and can leave partial host changes if a later operation fails.


## Wharness Desktop

The embedded ChatGPT renderer is remote and untrusted. Never add a preload to it, enable Node integration, disable `contextIsolation`, disable the Chromium sandbox, disable `webSecurity`, or expose generic Electron IPC.

The ChatGPT persistent partition contains normal web-session state and may include sensitive authentication cookies managed by Chromium. Wharness code must not enumerate, log, export, inspect, or synchronize those cookies.

Dual-mode ChatGPT authentication must never continue one OAuth transaction in a different browser. Embedded mode stays in the sandboxed `WebContentsView` for providers that permit embedded user-agents. External-browser mode starts a fresh transaction from the ChatGPT login entrypoint in a real Chrome/Chromium/Brave process with a Wharness-owned persistent dedicated profile and loopback-only DevTools endpoint. Google provider navigation from Embedded mode is automatically promoted to this external-browser path. After an authenticated ChatGPT callback, main-process code may relay only allowlisted `chatgpt.com` cookies into the dedicated Electron cookie store; values never enter renderer IPC/logs and the dedicated profile is preserved only for future Wharness auth reuse until the user explicitly clears browser/all data. Never forward an intercepted provider authorization URL, attach DevTools to the personal/default Chrome profile, or import credentials from an arbitrary user browser profile. The **Chrome pessoal** shortcut may open that profile for manual use only and is never callback-capable.

Desktop clipboard operations are explicit user actions. The context-copy capability accepts only a Wharness session ID; do not extend it into a generic local URL fetch, arbitrary file-copy API, or filesystem bridge.
