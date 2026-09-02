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

## Never do this

- expose the backend to an untrusted network without authentication/reverse-proxy controls;
- run Wharness as root;
- mount `/var/run/docker.sock` into the runner;
- use `HARNESS_SANDBOX=local` for untrusted plans;
- disable policy checks to make a model-generated plan "work";
- send `.env`, private keys, credential stores, database dumps, or secret directories to an AI provider.

## Reporting

Do not place secrets in bug reports. Include the session ID, plan ID, redacted logs, and the relevant policy decision.

## Defense in depth

The model may be wrong or manipulated by repository prompt injection. Security therefore does not rely on model obedience. The local policy engine and sandbox are authoritative.


## Wharness Desktop

The embedded ChatGPT renderer is remote and untrusted. Never add a preload to it, enable Node integration, disable `contextIsolation`, disable the Chromium sandbox, disable `webSecurity`, or expose generic Electron IPC.

The ChatGPT persistent partition contains normal web-session state and may include sensitive authentication cookies managed by Chromium. Wharness code must not enumerate, log, export, inspect, or synchronize those cookies.

Desktop clipboard operations are explicit user actions. The context-copy capability accepts only a Wharness session ID; do not extend it into a generic local URL fetch, arbitrary file-copy API, or filesystem bridge.
