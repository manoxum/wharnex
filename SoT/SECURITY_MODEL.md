# Security Model SoT

The model is untrusted. The repository is untrusted. The user request may be unsafe. Local policy and sandbox controls are authoritative.

The security boundary is enforced by:

- schema/protocol validation;
- path validation;
- command allow/deny policy;
- network approval;
- legacy debug host modification is retired. `harness.debug/v1` remains readable only for observe compatibility; new `harness.interactive/v1` workflows are observation-only. Destructive/external capabilities require their own typed module with inventory, immutable manifest, scoped approval and drift revalidation;
- debug tool lifetime disclosure: host install/update/configure requests state `temporary` or `persistent`, while Policy still denies privilege escalation, shells, Docker/host-service control and other forbidden primitives;
- narrowly scoped dependency-network recovery after a locally classified offline-cache failure, with a new explicit human approval and Protected-sandbox enforcement;
- isolated Docker execution;
- informed Protected execution approval before any model-authored host mutation; successful verification reuses that authorization for host integration without a second Apply approval;
- secret-filtered context;
- audit events.

Concurrent host integration additionally enforces relative-path containment, parent-symlink denial, per-file expected SHA-256 compare-and-swap, temporary-file replacement, and conditional rollback. An externally changed value MUST NOT be overwritten by commit or rollback. Immutable request archive paths are backend-private state. Conflict capsules contain only validated conflict paths and bounded BASE/CURRENT/RESULT content; secret-like paths remain denied before a ChangeSet or capsule can be created.

## IDE surfaces

The Explorer only exposes files allowed by the context security policy. Text editing rejects traversal, symlink escapes, excluded/secret paths, non-UTF8/binary files, files over the editor limit, and stale writes via expected SHA-256. Explorer create/rename/delete revalidate root containment, exclusions and every parent symlink boundary in the backend; recursive delete is available only as an explicit human action. The interactive terminal defaults to the isolated sandbox workspace. A separate human-only Host target may open a real PTY in the project root only after explicit confirmation and remains visibly marked as host-direct. In stack mode the shell is owned by a native bridge running as the logged-in OS user; the backend can only exchange bounded PTY start/input/resize/output/exit frames over a mode-0600 Unix socket under the checkout bridge directory. Raw human PTY keystrokes are not planner commands and are not exposed to model/automation execution. Host selection is never inherited from Agent mode or automation.
Explicit Git-UI remote synchronization uses a distinct mode-0600 host Git socket with an operation allowlist (`fetch`, `push`, `push_commit`) so HTTPS/SSH credential helpers execute in the workstation session without mounting those helpers into the backend container. This bridge does not accept arbitrary argv or shell text and MUST NOT be reused for planner commands, model verification, or automation.


## Desktop remote-content boundary (v1.2)

The ChatGPT surface is untrusted remote web content. The Desktop process owns six Supervisor `WebContentsView` slots with exactly one visible at a time and a bounded pool of one to three worker views (three by default), hidden by default, for the authenticated profile; every slot uses Chromium sandboxing, context isolation, Node integration disabled and no preload. A Supervisor slot is bound to one Harness chat for the life of its request and cannot be horizontally scaled; it is the normal human chat surface and is never a target for small maintenance or utility work, which the durable claim partitions to the Worker pool (see `adr/ADR-0049`). Worker slots may be added at runtime or retired only between non-preemptive jobs after their current chat/conversation assignment is validated. The trusted local renderer receives only narrow runtime metadata and may request a screenshot or explicitly surface one known Worker inside bounded local UI coordinates through named IPC capabilities, including the main Engine area used by **Seguir (flow)**. The interaction capability reuses the existing isolated `WebContentsView`; it grants no arbitrary navigation, DOM, cookie, storage or credential IPC, does not alter scheduler ownership, and MUST hide the Worker on exit, renderer failure or window close. Durable chat identity is the backend-owned `chat_id -> conversation_id` binding, while the shared persistent ChatGPT partition carries authenticated browser-session state only. Sharing that partition or reusing a worker slot never authorizes cross-chat DOM data reuse, response-prose inspection, or privilege expansion.

On Linux, the Electron/Chromium process MUST retain a usable layer-1 sandbox. The SUID path is valid only when the `chrome-sandbox` shipped beside the Electron executable is root-owned, root-grouped, and mode `4755`; a persistent root-owned copy may be kept only for recovery and MUST NOT be treated as proof that packaged Electron will execute it. When the packaged helper is not privileged, Wharness may disable only the SUID helper with `--disable-setuid-sandbox` after an actual unprivileged user-namespace probe succeeds; Chromium sandboxing itself remains enabled. `--no-sandbox` is forbidden. If neither the packaged SUID helper nor user namespaces are available, desktop startup MUST fail closed with actionable diagnostics.

A dev-only **behavior probe** (see `adr/ADR-0041`) MAY measure the account-automation controls on a trusted ChatGPT surface. It is not a JavaScript-evaluation capability: the caller names a control from a closed enum, every probe script is assembled in the main process from constants so no caller string reaches the page, and the result is re-bounded before it crosses IPC. A probe result carries counts, the renderer viewport, container `tag`/`role`/`data-testid`, and — for menu, dialog and composer reasoning-effort controls only — the bounded exact control labels the account automation is already permitted to read. Assistant prose, conversation content, project names, hrefs, cookies, storage and headers MUST NOT enter a probe result. The capability is inert unless Wharnex is started with `WHARNESS_BEHAVIOR_PROBE=1`, requires a trusted sender and an owned chat surface, never clicks, navigates or mutates the account, and MUST NOT be reachable from a model plan or from remote ChatGPT content.

The Wharness renderer has a separate preload with a narrow allowlisted IPC contract. Remote ChatGPT web content never receives that preload and cannot invoke context-copy or local-workspace APIs. Because a native `WebContentsView` paints above renderer DOM regardless of CSS z-index, trusted Wharness modals that overlap its viewport MUST hide/suspend that native view for the lifetime of the modal and restore it only after the modal closes.

A user-triggered **internal browser** MAY open the current trusted ChatGPT URL in a detached Electron `BrowserWindow`. It MUST reuse the dedicated ChatGPT partition only for authenticated browser-session state, MUST use the same sandbox/context-isolation/web-security protections with Node integration disabled and no preload, and MUST expose no Wharness transport, account, workspace or generic IPC capability to the remote page. The Desktop reuses at most one such browser per owning Wharnex window, confines its top-level navigation to trusted `chatgpt.com` HTTPS origins, delegates unrelated HTTPS destinations to the operating-system browser, and closes these browsers before browser-session export/import/clear operations. The internal browser is a human browsing surface only and MUST NOT be used to bypass provider restrictions described by the external authentication boundary.

Wharness does not infer authentication from response prose or arbitrary DOM. The main process MAY execute one narrow same-origin `/api/auth/session` probe inside the isolated ChatGPT WebContents solely to derive an `authenticated: boolean` UI state; no session payload, cookie value, profile data, DOM content, storage content, headers, or response prose crosses renderer IPC. The persistent Electron partition preserves normal ChatGPT browser state across desktop launches. Authentication is an explicit two-mode boundary. In **Embedded** mode, compatible `chatgpt.com/auth/*` and identity-provider navigation may remain in the sandboxed ChatGPT `WebContentsView`; Node integration stays disabled, context isolation/sandbox/web security stay enabled, and no privileged preload is attached. Google OAuth is not kept in this embedded user-agent because Google policy rejects embedded authorization agents. In **External browser** mode, Wharness cancels the embedded provider navigation and starts a fresh login at `https://chatgpt.com/auth/login` in a real Chrome/Chromium/Brave process using a persistent dedicated Wharness profile under Electron `userData` and a DevTools endpoint bound only to `127.0.0.1`. The dedicated profile is deliberately separate from Chrome's personal/default profile so Chrome 136+ remote-debugging protections are not bypassed; it preserves the Google/ChatGPT account state across Wharness auth attempts. An intercepted in-flight authorization URL is never reused in the external browser.

The Electron-owned ChatGPT partition MAY be exported or imported only through an explicit user action as an opaque Wharness browser-session backup. The backup MUST be treated as secret material, MUST NOT enumerate or expose cookie/token values to renderer code, MUST reject traversal and link entries, and imports MUST replace the partition only at a safe restart boundary before the persistent session is reopened. Clearing browser-session data MUST invalidate the embedded login state without altering project files.

When **External browser** authentication is entered, the affected ChatGPT view is hidden and marked as external-auth mode. The managed browser is monitored only over its loopback DevTools endpoint. A return to trusted `chatgpt.com` outside `/auth` is not sufficient by itself: Wharness asks that browser context for `/api/auth/session` and proceeds only when it reports an authenticated session. Main-process code then reads browser cookies, filters strictly to `chatgpt.com`, excludes Cloudflare/anti-bot cookies, and writes the remaining cookie records directly to the dedicated Electron cookie store. Cookie values are never logged or exposed to the renderer, project, planner, or generic IPC. The managed browser is then closed, its dedicated profile is preserved for later sign-in reuse, and the embedded view reloads. Explicit **Limpar sessão do navegador** and complete-data reset delete both the embedded partition and the dedicated managed-browser profile. The personal/default Chrome profile may be opened as a manual isolated shortcut, but Wharness MUST NOT attach DevTools to it, read its cookies, or claim callback/session import from it. If the browser closes or times out before callback, the relay is discarded and the user may retry. The ordinary user-selected system browser remains an unrelated manual fallback whose profile is never inspected.

Context ZIP copying is privileged main-process work. The renderer passes only a validated Wharness session identifier; the main process derives the exact local backend endpoint, limits bundle size, verifies ZIP signature, writes a private temporary file, and places that file reference on the native OS clipboard.

Named account operations are limited to exact project lookup/creation, moving the owned conversation, setting its bounded `WHX:` title, stopping/archiving it, and collapsing the sidebar. They may inspect stable control metadata and compare an exact trusted-renderer supplied project/title value; they may not enumerate unrelated account data or expose any observed label to the local renderer. Operations are serialized, owner-checked and fail closed when the expected control is absent or ambiguous. This account-operation allowlist is additional to the four transport operations described below.

User-selected chat attachments cross a narrow trusted-renderer IPC seam as bounded base64 payloads. The main process MUST validate count, decoded size, filename, and MIME metadata before transport. In local-attachment mode it packages the validated logical inputs, generated planner prompt, and eligible context into one private request-scoped `wharness-input-<request_id>.zip` below the Wharness temporary directory and exposes only that archive as a native clipboard file reference. Individual user/system files MUST NOT be exposed as separate ChatGPT upload references for the planner turn. The composer receives only a bounded bootstrap that names the archive and its inner planner-prompt path. In remote-input mode the same bounded payloads are sent only to the allowlisted local backend endpoint; the backend packages or maps them with the filtered context through the configured transport adapter, while the Desktop writes only the bounded bootstrap into the ChatGPT composer. For Harness transcript durability the Desktop MAY additionally persist private copies below Electron `userData`, keyed only by validated local chat/message identifiers; the renderer receives opaque storage references rather than arbitrary filesystem paths. Thumbnail/icon reads and open actions MUST resolve only those references. Input automation may focus the remote view and paste the single local archive reference. Before preparing either transport it MUST await bounded page-load and network-stability gates. It may track request identifiers, WebContents ownership, status codes, and network errors only for the exact trusted ChatGPT upload endpoint so that the local archive can be retried and confirmed. It may also observe only the start of a POST to the exact trusted ChatGPT conversation endpoint to confirm that a submit command was accepted. In addition, a tightly allowlisted DOM bridge MAY execute JavaScript solely to (1) locate/focus the composer, (2) write the already-prepared bounded bootstrap/continuation into that composer, (3) activate the submit control, and (4) activate the pending result download affordance, including while the corresponding ChatGPT view is hidden in Auto mode. Download selection MUST prefer exact canonical filename metadata. Because ChatGPT may render generated files without exposing their filename, the bridge MAY use a fallback only when exactly one visible enabled file/download affordance exists inside the newest assistant turn; it may inspect only narrow control attributes, file-like href shape, icon-only download labels, visibility/disabled state, and assistant-turn ancestry for that decision. Zero or multiple candidates fail closed. The bridge MUST NOT enumerate arbitrary DOM for semantic analysis, read generated response prose, inspect cookies/local storage, read request/response bodies or headers, or infer model-completion state from response content. Downloaded planner bytes remain untrusted and MUST still pass canonical request-id, filename, ZIP and bundle validation before execution. The non-executing document translation utility has one separate artifact-only download path: a durable `TRANSLATE_MARKDOWN` worker MAY upload one bounded request bundle built by the backend translation engine, request an exact task-scoped `whx_translation_res_<task_id>.zip` filename, activate only that exact/narrow file affordance, and return at most the configured bounded bytes. The worker composes no instruction — the authoritative prompt travels inside the archive it uploads — parses no archive, MUST NOT read assistant prose, and MUST NOT infer translation content from the DOM. Those bytes are validated fail-closed by the engine that built the request, against that request's own protocol identity, task, target language and source digest, before any of them is used; the resulting Markdown is presentation data only and is never executable input. Submission may occur after either a separate trusted-renderer confirmation or a backend-verified explicit project Auto preference, but never after an unconfirmed/exhausted local archive upload or failed remote publication. Project open/restore MAY initialize Agent + Protected + Auto as the safe default, but Auto MUST never coexist with Unprotected execution. An explicit trusted-renderer action MAY send a freshly rebuilt single Wharness input archive to the currently visible trusted ChatGPT conversation; this does not authorize reading remote content and does not weaken bundle validation.

Orchestrator manual planning has one additional artifact-only exception. A durable `ORCHESTRATOR_PLAN` worker MAY send one backend-authored bounded planning prompt, request exact `whx_orchestrator_plan_<task_id>.json`, and import it only through `harness.orchestrator-plan/v1` validation. It cannot execute commands or patches, MUST NOT read assistant prose, and treats the JSON bytes as untrusted until backend validation succeeds.

For upload retry purposes, absence must be provable. A failure before any provider upload request starts, or an explicit non-success HTTP response, MAY repeat the file selection with bounded backoff. Once a provider upload request has started, a network error or completion timeout is ambiguous: ChatGPT may already retain the file even though Wharnex lost the acknowledgement. This ambiguous case is an exception to the general transient-network retry rule above and MUST fail closed without selecting the same local archive again; submission remains blocked and the operator receives an actionable recovery error instead of a duplicate remote upload.

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
HTTPS, contain no userinfo, resolve directly to the published object bytes
rather than a viewer/HTML page, and never include a long-lived provider
credential. A provider adapter MAY narrowly rewrite a provider-owned viewer URL
to that provider's recognized raw-download origin and shape; it MUST validate
the extracted opaque object identifier and MUST NOT generalize this into an
arbitrary redirect/proxy facility. Provider-generated short-lived signed URLs
and unguessable public object URLs are allowed. Logs and audit events identify
only provider, request id, byte count, digest, and expiry/cleanup result, never
the complete download URL or auth data.

Before exposing a normalized Google Drive URL, its adapter performs an
anonymous bounded range request and requires an HTTP success plus the ZIP magic
bytes. Redirects remain HTTPS-only and bounded. This verifies transport shape,
not archive trust; downloaded model input/output still follows its normal
validation. Composer `@file` references are structured hints only and may name
only files already present in the current eligible context manifest. Composer
`@see` references are structured hints too. A source-qualified value may point
only at a normalized relative path already present in the primary manifest, a
named related-project manifest, or an admitted `@attach` inventory; it may also
name a direct upload. The backend resolves it to the exact request-bundle path
and reports an absent target instead of reading the host again. Legacy bare
values remain direct-upload names. `@see` changes reading priority only and
MUST NOT grant write authority or introduce another attachment transport.

Every tunnel adapter MUST bind only to loopback and expose a dedicated
object server, never the main backend listener. Its routes accept only GET/HEAD
for exact validated Wharness objects or resources below an unguessable
request-channel namespace. Resources are privately copied snapshots with fixed
allowlisted content types; prompt, state, hash, context, attachments, bundle
contract and read-only SSE are the only channel resource classes. Traversal,
unknown namespaces/resources, writes and all other methods are denied. The
namespace secret is a bearer capability and MUST NOT enter logs, audit events,
project context, or provider config. Permanent provider account tokens MUST live
only in private application credential files addressed by opaque references.
One origin MAY be shared by all chats for the running backend session,
but every main request MUST retain an independent unguessable namespace and no
route may enumerate channels. Normal backend shutdown MUST preserve active
channel resources for permanent-DNS rehydration; explicitly clearing remote
input MUST stop the connector and erase those resources. SSE data may contain only bounded
local comments and non-secret request, generation and context-hash metadata.
The origin root MAY return only a non-sensitive landing page, containing at
most a user-chosen instance name and configured permanent HTTPS origins. A QR
on that page is discovery-only and MUST NOT contain credentials, namespaces,
request/resource URLs, sessions, or authorization. `/status`
MAY return a fixed protocol identifier plus operational status; neither route
MUST disclose provider, account, chat, request, or channel data.

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

## Durable artifact object-store boundary (v1.3)

The canonical stack persists ChatGPT exchange artifacts in an internal MinIO
service. MinIO is not published as a browser-facing port. Stack startup
generates/reuses its credentials in private stack state and passes them only to
the backend container. Credentials, bucket names and object keys MUST NOT enter
project context, model prompts, transcripts, renderer storage, public Session
JSON, or audit payloads.

The backend addresses objects only through server-owned opaque artifact records
bound to a Harness session. Renderer requests name the session and artifact id,
never a MinIO object key. Artifact upload remains a trusted local Desktop/UI to
loopback-backend seam with bounded decoded size and validated filename;
server-side metadata records SHA-256 before object persistence. Object download
returns only the bytes owned by the matching session record.

ZIP exploration is non-executing and non-extracting. Entry paths are treated as
archive-relative names, traversal is rejected, directories are metadata only,
and per-entry read size is bounded before decompression. ZIP contents remain
untrusted and never become project files merely because they can be previewed
or downloaded. Retention cleanup and explicit data/session deletion may delete
only non-empty server-owned object keys; missing private object locations fail
closed rather than issuing bucket-level operations.
