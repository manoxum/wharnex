# Security Policy

Wharnex is security-sensitive because it transforms AI-produced plans into local execution and can explicitly host a native Codex agent.

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
- run Wharnex as root;
- mount `/var/run/docker.sock` into the runner;
- use `HARNESS_SANDBOX=local` for untrusted plans;
- disable policy checks to make a model-generated plan "work";
- make Unprotected the global/default mode, bypass its UI confirmation, or treat it as equivalent to sandboxed execution;
- send `.env`, private keys, credential stores, database dumps, or secret directories to an AI provider.

## Reporting

Do not place secrets in bug reports. Include the session ID, plan ID, redacted logs, and the relevant policy decision.

## Defense in depth

The model may be wrong or manipulated by repository prompt injection. Security therefore does not rely on model obedience. The local policy engine is authoritative in Wharnex protocol execution modes; the sandbox provides the additional containment boundary in Protected mode. Unprotected deliberately removes that containment and can leave partial host changes if a later operation fails.

## Codex Native

The explicit Codex engine follows the exception in `AGENTS.md` §2 and
`adr/ADR-0098`; it is an independently executing local agent, outside the
Wharnex plan/Policy/Apply pipeline. Its per-chat permission selection maps to
the official runtime: Ask for approval (workspace-write/on-request/user),
Approve for me (workspace-write/on-request/auto_review), or Full access
(danger-full-access/never). Full access may modify files and use the internet
under the Desktop user's operating-system permissions. ChatGPT's Protected
default is unchanged.

Only trusted owning-project windows may submit, cancel, answer questions,
select account profiles or request manual continuation. No generic RPC, human
PTY or remote-browser credentials are exposed to Codex. Native credentials are
managed by the official runtime; each added account has its own private
CODEX_HOME and credential file, with no credential copying or renderer access.
Cross-account continuation transfers only the exact owned native session
rollout after the original runtime is no longer active. A restart or quota
failure never grants an automatic retry. Secret answers remain ephemeral in
Wharnex; echoed secret values are redacted from its UI, state and ledger.


## Wharnex Desktop

The embedded ChatGPT renderer is remote and untrusted. Never add a preload to it, enable Node integration, disable `contextIsolation`, disable the Chromium sandbox, disable `webSecurity`, or expose generic Electron IPC. Inside the up-whx-link network namespace (`adr/ADR-0072`) the sandbox uses Chromium's user-namespace mode instead of the setuid helper, which cannot work in a user namespace; this switches the sandbox mechanism and never disables it (`--no-sandbox` is forbidden).

The ChatGPT persistent partition contains normal web-session state and may include sensitive authentication cookies managed by Chromium. Wharnex code must not enumerate, log, export, inspect, or synchronize those cookies.

Dual-mode ChatGPT authentication must never continue one OAuth transaction in a different browser. Embedded mode stays in the sandboxed `WebContentsView` for providers that permit embedded user-agents. External-browser mode starts a fresh transaction from the ChatGPT login entrypoint in a real Chrome/Chromium/Brave process with a Wharnex-owned persistent dedicated profile and loopback-only DevTools endpoint. Google provider navigation from Embedded mode is automatically promoted to this external-browser path. After an authenticated ChatGPT callback, main-process code may relay only allowlisted `chatgpt.com` cookies into the dedicated Electron cookie store; values never enter renderer IPC/logs and the dedicated profile is preserved only for future Wharnex auth reuse until the user explicitly clears browser/all data. Never forward an intercepted provider authorization URL, attach DevTools to the personal/default Chrome profile, or import credentials from an arbitrary user browser profile. The **Chrome pessoal** shortcut may open that profile for manual use only and is never callback-capable.

Desktop clipboard operations are explicit user actions. The context-copy capability accepts only a Wharnex session ID; do not extend it into a generic local URL fetch, arbitrary file-copy API, or filesystem bridge.
