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

The Explorer only exposes files allowed by the context security policy. Text editing rejects traversal, symlink escapes, excluded/secret paths, non-UTF8/binary files, files over the editor limit, and stale writes via expected SHA-256. The interactive terminal runs in the isolated Docker workspace and never receives the original project as its execution workspace.


## Desktop remote-content boundary (v1.2)

The ChatGPT surface is untrusted remote web content. It is isolated from local application privileges by a dedicated `WebContentsView` with sandboxing, context isolation, Node integration disabled, no preload, and a persistent browser partition used only for its web session.

The Wharness renderer has a separate preload with a narrow allowlisted IPC contract. Remote ChatGPT web content never receives that preload and cannot invoke context-copy or local-workspace APIs.

Wharness does not infer authentication by reading DOM/cookies. If authentication is required, the ChatGPT site renders its own login UI in the remote view. The persistent partition preserves normal browser session state across desktop launches.

Context ZIP copying is privileged main-process work. The renderer passes only a validated Wharness session identifier; the main process derives the exact local backend endpoint, limits bundle size, verifies ZIP signature, writes a private temporary file, and places that file reference on the native OS clipboard.

User-selected chat attachments cross a narrow trusted-renderer IPC seam as bounded base64 payloads. The main process MUST validate count, decoded size, filename, and MIME metadata. For ChatGPT transport it materializes temporary private copies below the Wharness temporary directory and exposes them only as native clipboard file references. The generated planner prompt MUST likewise be materialized as a private temporary Markdown file and exposed only as a native clipboard file reference. For Harness transcript durability it MAY additionally persist private copies below Electron `userData`, keyed only by validated local chat/message identifiers; the renderer receives opaque storage references rather than arbitrary filesystem paths. Thumbnail/icon reads and open actions MUST resolve only those references. Input-only automation may focus the remote view and paste those references. Before pasting it MUST await bounded page-load and network-stability gates. It may track request identifiers, WebContents ownership, status codes, and network errors only for the exact trusted ChatGPT upload endpoint so that each file can be retried and confirmed. It may also observe only the start of a POST to the exact trusted ChatGPT conversation endpoint to confirm that a native submit command was accepted. It MUST NOT inspect request/response bodies, headers, cookies, or remote content. Submission may occur after either a separate trusted-renderer confirmation or a backend-verified explicit project Auto preference, but never after an unconfirmed/exhausted upload. It MUST NOT execute JavaScript in, query, or infer upload/model-completion state from the ChatGPT DOM.
