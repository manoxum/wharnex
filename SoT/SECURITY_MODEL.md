# Security Model SoT

The model is untrusted. The repository is untrusted. The user request may be unsafe. Local policy and sandbox controls are authoritative.

The security boundary is enforced by:

- schema/protocol validation;
- path validation;
- command allow/deny policy;
- network approval;
- isolated Docker execution;
- explicit apply;
- secret-filtered context;
- audit events.

## IDE surfaces

The Explorer only exposes files allowed by the context security policy. Text editing rejects traversal, symlink escapes, excluded/secret paths, non-UTF8/binary files, files over the editor limit, and stale writes via expected SHA-256. Explorer create/rename/delete revalidate root containment, exclusions and every parent symlink boundary in the backend; recursive delete is available only as an explicit human action. The interactive terminal defaults to the isolated sandbox workspace. A separate human-only Host target may execute directly in the project root only after explicit confirmation; it remains argv-only, Policy Engine constrained, and visibly marked as host-direct. Human terminal input is evaluated by an interactive policy profile that permits ordinary development commands while blocking shell interpreters, privilege escalation, container/host administration and inline-code evaluator flags. Host selection is never inherited from Agent mode or automation.


## Desktop remote-content boundary (v1.2)

The ChatGPT surface is untrusted remote web content. Each live Harness chat is isolated in its own dedicated `WebContentsView` with sandboxing, context isolation, Node integration disabled and no preload. A view has one Harness-chat owner id for its lifetime and is never reassigned to another chat. All allowlisted DOM/input/navigation operations must resolve and validate that owner before touching the remote renderer. The views share one persistent ChatGPT browser partition only for authenticated browser-session state; sharing that partition does not authorize DOM or renderer reuse across chats.

On Linux, the Electron/Chromium process MUST retain a usable layer-1 sandbox. The SUID path is valid only when the `chrome-sandbox` shipped beside the Electron executable is root-owned, root-grouped, and mode `4755`; a persistent root-owned copy may be kept only for recovery and MUST NOT be treated as proof that packaged Electron will execute it. When the packaged helper is not privileged, Wharness may disable only the SUID helper with `--disable-setuid-sandbox` after an actual unprivileged user-namespace probe succeeds; Chromium sandboxing itself remains enabled. `--no-sandbox` is forbidden. If neither the packaged SUID helper nor user namespaces are available, desktop startup MUST fail closed with actionable diagnostics.

The Wharness renderer has a separate preload with a narrow allowlisted IPC contract. Remote ChatGPT web content never receives that preload and cannot invoke context-copy or local-workspace APIs. Because a native `WebContentsView` paints above renderer DOM regardless of CSS z-index, trusted Wharness modals that overlap its viewport MUST hide/suspend that native view for the lifetime of the modal and restore it only after the modal closes.

Wharness does not infer authentication from response prose or arbitrary DOM. The main process MAY execute one narrow same-origin `/api/auth/session` probe inside the isolated ChatGPT WebContents solely to derive an `authenticated: boolean` UI state; no session payload, cookie value, profile data, DOM content, storage content, headers, or response prose crosses renderer IPC. The persistent Electron partition preserves normal ChatGPT browser state across desktop launches. Authentication is an explicit two-mode boundary. In **Embedded** mode, compatible `chatgpt.com/auth/*` and identity-provider navigation may remain in the sandboxed ChatGPT `WebContentsView`; Node integration stays disabled, context isolation/sandbox/web security stay enabled, and no privileged preload is attached. Google OAuth is not kept in this embedded user-agent because Google policy rejects embedded authorization agents. In **External browser** mode, Wharness cancels the embedded provider navigation and starts a fresh login at `https://chatgpt.com/auth/login` in a real Chrome/Chromium/Brave process using a persistent dedicated Wharness profile under Electron `userData` and a DevTools endpoint bound only to `127.0.0.1`. The dedicated profile is deliberately separate from Chrome's personal/default profile so Chrome 136+ remote-debugging protections are not bypassed; it preserves the Google/ChatGPT account state across Wharness auth attempts. An intercepted in-flight authorization URL is never reused in the external browser.

The Electron-owned ChatGPT partition MAY be exported or imported only through an explicit user action as an opaque Wharness browser-session backup. The backup MUST be treated as secret material, MUST NOT enumerate or expose cookie/token values to renderer code, MUST reject traversal and link entries, and imports MUST replace the partition only at a safe restart boundary before the persistent session is reopened. Clearing browser-session data MUST invalidate the embedded login state without altering project files.

When **External browser** authentication is entered, the affected ChatGPT view is hidden and marked as external-auth mode. The managed browser is monitored only over its loopback DevTools endpoint. A return to trusted `chatgpt.com` outside `/auth` is not sufficient by itself: Wharness asks that browser context for `/api/auth/session` and proceeds only when it reports an authenticated session. Main-process code then reads browser cookies, filters strictly to `chatgpt.com`, excludes Cloudflare/anti-bot cookies, and writes the remaining cookie records directly to the dedicated Electron cookie store. Cookie values are never logged or exposed to the renderer, project, planner, or generic IPC. The managed browser is then closed, its dedicated profile is preserved for later sign-in reuse, and the embedded view reloads. Explicit **Limpar sessão do navegador** and complete-data reset delete both the embedded partition and the dedicated managed-browser profile. The personal/default Chrome profile may be opened as a manual isolated shortcut, but Wharness MUST NOT attach DevTools to it, read its cookies, or claim callback/session import from it. If the browser closes or times out before callback, the relay is discarded and the user may retry. The ordinary user-selected system browser remains an unrelated manual fallback whose profile is never inspected.

Context ZIP copying is privileged main-process work. The renderer passes only a validated Wharness session identifier; the main process derives the exact local backend endpoint, limits bundle size, verifies ZIP signature, writes a private temporary file, and places that file reference on the native OS clipboard.

User-selected chat attachments cross a narrow trusted-renderer IPC seam as bounded base64 payloads. The main process MUST validate count, decoded size, filename, and MIME metadata. In local-attachment mode it materializes temporary private copies below the Wharness temporary directory and exposes them only as native clipboard file references. The generated planner prompt MUST likewise be materialized as a private temporary Markdown file and exposed only as a native clipboard file reference. In remote-input mode the same bounded payloads are sent only to the allowlisted local backend endpoint; the backend packages them with the filtered context and publishes through its configured storage adapter, while the Desktop writes only the bounded bootstrap into the ChatGPT composer. For Harness transcript durability the Desktop MAY additionally persist private copies below Electron `userData`, keyed only by validated local chat/message identifiers; the renderer receives opaque storage references rather than arbitrary filesystem paths. Thumbnail/icon reads and open actions MUST resolve only those references. Input automation may focus the remote view and paste local-mode references. Before preparing either transport it MUST await bounded page-load and network-stability gates. It may track request identifiers, WebContents ownership, status codes, and network errors only for the exact trusted ChatGPT upload endpoint so that each local file can be retried and confirmed. It may also observe only the start of a POST to the exact trusted ChatGPT conversation endpoint to confirm that a submit command was accepted. In addition, a tightly allowlisted DOM bridge MAY execute JavaScript solely to (1) locate/focus the composer, (2) write the already-prepared bounded bootstrap/continuation into that composer, (3) activate the submit control, and (4) activate the pending result download affordance, including while the corresponding ChatGPT view is hidden in Auto mode. Download selection MUST prefer exact canonical filename metadata. Because ChatGPT may render generated files without exposing their filename, the bridge MAY use a fallback only when exactly one visible enabled file/download affordance exists inside the newest assistant turn; it may inspect only narrow control attributes, file-like href shape, icon-only download labels, visibility/disabled state, and assistant-turn ancestry for that decision. Zero or multiple candidates fail closed. The bridge MUST NOT enumerate arbitrary DOM for semantic analysis, read generated response prose, inspect cookies/local storage, read request/response bodies or headers, or infer model-completion state from response content. Downloaded bytes remain untrusted and MUST still pass canonical request-id, filename, ZIP and bundle validation before execution. Submission may occur after either a separate trusted-renderer confirmation or a backend-verified explicit project Auto preference, but never after an unconfirmed/exhausted local upload or failed remote publication. Project open/restore MAY initialize Agent + Protected + Auto as the safe default, but Auto MUST never coexist with Unprotected execution. An explicit trusted-renderer action MAY send the freshly rebuilt project context ZIP or prepared prompt to the currently visible trusted ChatGPT conversation; this does not authorize reading remote content and does not weaken bundle validation.

## Project bootstrap boundary (v1.2.17)

Native folder selection is exposed only to the trusted local renderer through a sender-checked, capability-specific Electron IPC. The remote ChatGPT `WebContentsView` has no access to this picker.

Create/clone are explicit human bootstrap operations and are not model-plan operations. Clone executes Git with argv, `--recurse-submodules`, a non-option repository value, a non-existing destination below an existing parent, and non-interactive credential prompting. A failed clone is not destructively cleaned up by Wharness; any partial destination remains visible for human inspection. Error text must not echo the supplied repository credential string.

`whaness.yml` may narrow or tune AI context but cannot disable mandatory secret-like path/content filtering, VCS-internal exclusion, symlink denial, or project-root containment.

## Remote input storage boundary (v1.3)

Remote input publication is an outbound transport adapter owned by the backend.
It receives only the already-filtered context snapshot, generated planner prompt,
and explicitly selected attachments. Provider configuration and credentials are
application secrets: they MUST NOT be accepted from project files, model plans,
the ChatGPT renderer, or generic renderer-controlled URLs. The trusted local
settings renderer MAY submit credentials through the narrow loopback
provider-enrollment endpoint after an explicit user action. Secret fields MUST
be password controls, remain only in transient form state, and MUST NOT be
echoed in responses, logs, audit events, pool configuration, transcripts, or
frontend persistence.

Upload endpoints are fixed by trusted application configuration. HTTP redirects
are rejected while credentials are attached. The public download URL MUST be
HTTPS, contain no userinfo, and never include a long-lived provider credential;
provider-generated short-lived signed URLs and unguessable public object URLs
are allowed. Logs and audit events identify only provider, request id, byte count,
digest, and expiry/cleanup result, never the complete download URL or auth data.

Remote input archives remain untrusted project data from the model's
perspective and cannot weaken the embedded planner protocol. Publication does
not authorize the backend runner or a model plan to use network. Only the
explicit transport adapter receives outbound network access.

Each configured storage account has a non-secret stable instance id. New
provider connections store credentials only in rclone-owned application
configuration; the multi-instance pool document stores the managed remote name,
never credential values. Browser OAuth MUST use a loopback callback and a real
external browser. The legacy direct HTTP adapter may continue resolving an
authorization value by environment-variable name. Priority and failover may select only these preconfigured
instances and URLs. Public status may expose instance id, provider, priority,
limits, and aggregate usage, but never credentials, signed object URLs, or
individual object names.
