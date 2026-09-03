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

The ChatGPT surface is untrusted remote web content. It is isolated from local application privileges by a dedicated `WebContentsView` with sandboxing, context isolation, Node integration disabled, no preload, and a persistent browser partition used only for its web session.

The Wharness renderer has a separate preload with a narrow allowlisted IPC contract. Remote ChatGPT web content never receives that preload and cannot invoke context-copy or local-workspace APIs. Because a native `WebContentsView` paints above renderer DOM regardless of CSS z-index, trusted Wharness modals that overlap its viewport MUST hide/suspend that native view for the lifetime of the modal and restore it only after the modal closes.

Wharness does not infer authentication by reading DOM/cookies. The persistent partition preserves normal ChatGPT browser state across desktop launches, but third-party OAuth/SSO is not treated as ordinary embedded navigation. Any main-frame navigation or redirect from trusted `chatgpt.com` to `auth.openai.com`, Google, Microsoft or Apple authentication endpoints MUST be cancelled in the `WebContentsView` and opened in the operating-system browser. This follows provider restrictions on embedded OAuth and avoids bypassing them with user-agent spoofing or weakened web security. The system-browser session remains isolated: Wharness MUST NOT read, export, copy or inject browser cookies, OAuth tokens or credentials into Electron.

When such external authentication is entered, the affected ChatGPT view is hidden and marked as system-browser mode. The trusted local renderer may continue a manual handoff by copying the current context/prompt and importing a user-selected ZIP. That ZIP picker is restricted to a local file explicitly chosen by the user, enforces the execution-bundle byte limit, binds generic ZIP names only to the active request id, verifies the ZIP signature, and still sends the resulting bundle through the normal backend validation path. Automatic embedded ChatGPT transport is unavailable until the user explicitly resumes the embedded view.

Context ZIP copying is privileged main-process work. The renderer passes only a validated Wharness session identifier; the main process derives the exact local backend endpoint, limits bundle size, verifies ZIP signature, writes a private temporary file, and places that file reference on the native OS clipboard.

User-selected chat attachments cross a narrow trusted-renderer IPC seam as bounded base64 payloads. The main process MUST validate count, decoded size, filename, and MIME metadata. For ChatGPT transport it materializes temporary private copies below the Wharness temporary directory and exposes them only as native clipboard file references. The generated planner prompt MUST likewise be materialized as a private temporary Markdown file and exposed only as a native clipboard file reference. For Harness transcript durability it MAY additionally persist private copies below Electron `userData`, keyed only by validated local chat/message identifiers; the renderer receives opaque storage references rather than arbitrary filesystem paths. Thumbnail/icon reads and open actions MUST resolve only those references. Input-only automation may focus the remote view and paste those references. Before pasting it MUST await bounded page-load and network-stability gates. It may track request identifiers, WebContents ownership, status codes, and network errors only for the exact trusted ChatGPT upload endpoint so that each file can be retried and confirmed. It may also observe only the start of a POST to the exact trusted ChatGPT conversation endpoint to confirm that a native submit command was accepted. It MUST NOT inspect request/response bodies, headers, cookies, or remote content. Submission may occur after either a separate trusted-renderer confirmation or a backend-verified explicit project Auto preference, but never after an unconfirmed/exhausted upload. It MUST NOT execute JavaScript in, query, or infer upload/model-completion state from the ChatGPT DOM.

## Project bootstrap boundary (v1.2.17)

Native folder selection is exposed only to the trusted local renderer through a sender-checked, capability-specific Electron IPC. The remote ChatGPT `WebContentsView` has no access to this picker.

Create/clone are explicit human bootstrap operations and are not model-plan operations. Clone executes Git with argv, `--recurse-submodules`, a non-option repository value, a non-existing destination below an existing parent, and non-interactive credential prompting. A failed clone is not destructively cleaned up by Wharness; any partial destination remains visible for human inspection. Error text must not echo the supplied repository credential string.

`whaness.yml` may narrow or tune AI context but cannot disable mandatory secret-like path/content filtering, VCS-internal exclusion, symlink denial, or project-root containment.
