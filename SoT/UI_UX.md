# UI/UX SoT

Wharness is an engineering workspace, not a chatbot skin.

- two-column desktop workspace with chat on the left and execution intelligence on the right;
- information-dense but calm visual hierarchy;
- no decorative gradients/glow-heavy "AI" styling;
- keyboard-accessible controls, visible focus, semantic labels;
- execution state must be understandable without relying only on color;
- destructive/apply actions are visually distinct and require explicit intent;
- mobile layout stacks panels without hiding execution state.

## Workspace modes (v1.1)

The workspace has two first-class modes:

- **Editor**: dark IDE-style project Explorer, IDE-grade code editor, and an interactive terminal whose default target is the persistent Docker sandbox. The Explorer provides create file/folder, rename, delete confirmation, path filtering/search, refresh, collapse, context actions and reveal-current-file. A distinct Host terminal target is available only through an explicit warning/confirmation and remains visually marked while active.
- **Agent**: harness chat, plan/policy inspector, execution logs, and ChatGPT/OpenAI provider panel.

The active workspace, project path, recent workspaces, per-project choices, and local chat transcript are remembered in browser local storage. Opening or restoring a project deliberately starts on **Agent + Protected + Auto** as the operational default; the user may change execution/automation mode after the workspace is open. If the backend was restarted and the in-memory session disappeared, the frontend reopens the remembered project and creates a fresh session automatically with that safe startup profile.


## Desktop ChatGPT composition (v1.2)

Wharness Desktop composes the real ChatGPT web surface inside the Agent inspector using a native Electron `WebContentsView`. The ChatGPT tab must preserve the same engineering-workspace identity as the rest of Wharness and provide compact browser controls plus a compact action toolbar for context ZIP, prepared prompt, and result bundle. Context and prompt each expose copy and explicit direct-send actions; those user-invoked actions upload the selected artefact, submit it only after transport confirmation, and do not read the remote DOM.

The native ChatGPT view occupies only the explicitly reserved viewport. It must be hidden when the tab is not active and suspended whenever a Wharness modal/overlay (including Project Context settings) is open over that area, so remote content never paints above or intercepts interaction with trusted controls.

Authentication exposes two first-class choices in the ChatGPT panel. **Login incorporado** keeps the complete login/OAuth transaction inside the existing sandboxed ChatGPT view and shared persistent partition. **Login externo** opens a separate Wharness-owned authentication window using that same partition; the login always starts again at `chatgpt.com/auth/login`, never from an intercepted in-flight provider URL. While that window is active the embedded ChatGPT view is hidden and the banner explains that return to a non-auth ChatGPT URL is detected as the callback. On callback the auth window closes and the embedded view resumes automatically. The ordinary **Abrir ChatGPT no navegador do sistema** control remains a manual session-isolated fallback and must be labelled so users do not confuse it with callback-capable external login.

The Harness composer accepts a bounded set of user-selected files in Desktop manual-planner mode, whether selected through the file picker or pasted from the native clipboard. The ChatGPT surface MUST reach a loaded, network-stable state before attachment preparation, independently of whether the user has already supplied a prompt. The complete generated planner prompt is transported as `wharness-planner-prompt.md`; the prompt MUST NOT be pasted as ordinary text. The refreshed project context ZIP is attached on the first prompt for a ChatGPT conversation, whenever the concrete ChatGPT conversation URL changes, or whenever the current project snapshot hash differs from the hash last attached to that conversation. Sequential prompts to the same conversation with an unchanged snapshot MUST omit the duplicate context ZIP. This hash rule also refreshes a chat after another Harness chat or an external edit changes project content. Every transported file is upload-confirmed individually; transient start, network, or HTTP failures retry with bounded backoff, and retry exhaustion leaves the request unsubmitted with an actionable error. In Manual automation mode preparation MUST stop before submission; the UI exposes an explicit **Confirm and send** action so the user can visually verify ChatGPT's attachment chips. In project Auto mode, Wharness MUST refocus the composer and emit a layout-independent native `Enter` only after all observed uploads are confirmed plus a conservative bounded settle delay. It MUST retry focus-and-submit until the ChatGPT conversation POST is observed or the bounded attempt cap is exhausted, and the UI MUST NOT claim automatic submission before that transport confirmation. Automatic continuation begins only when the validated bundle download event is received.

User-selected Harness chat attachments are durable conversation artifacts. Before a message is sent, Desktop MUST persist a private local copy outside the target project, and the transcript stores only bounded metadata plus an opaque storage reference. Reloading or switching Harness chats MUST restore the attachment cards together with their messages. When possible, image attachments display a persisted visual thumbnail; other file types use a native file icon fallback. Opening an attachment is an explicit user action. Deleting a Harness chat SHOULD remove its durable attachment directory. Legacy transcript entries that predate durable storage may remain metadata-only and MUST NOT fabricate recoverable content.

## Multi-chat conversation model (v1.2.6)

The Agent surface supports multiple Harness chats within the same workspace. A compact chat switcher must expose the active chat, create a new chat, and indicate whether each Harness chat already has a linked ChatGPT conversation. Each chat keeps its own Harness transcript and orchestration session.

The ChatGPT panel has one-to-one conversation affinity with the active Harness chat. Selecting a linked Harness chat automatically restores its `chatgpt.com/c/...` conversation. An unlinked chat opens the ChatGPT new-chat surface and binds the first concrete conversation URL created for it. Existing bindings are not silently replaced merely because the user browses another ChatGPT conversation; the UI exposes an explicit rebind action. Pressing **Send** in the Harness while a different concrete ChatGPT conversation is currently open is itself explicit user intent: that send may target/rebind to the visible conversation and MUST attach fresh project context before the prompt.

## Project bootstrap and settings (v1.2.17)

The initial workspace surface offers three first-class project entry paths: open an existing folder through the operating-system directory explorer, create a new project below a selected parent folder, or clone a Git repository. Git clone states that recursive submodules are included. Manual project-path typing is a browser fallback, not the primary Desktop workflow.

An opened workspace exposes project settings from the top bar. The settings surface edits the context portion of `whaness.yml`: automatic pruning, include patterns, exclude patterns, and maximum per-file size. Saving reconstructs the session context immediately and keeps mandatory security exclusions visibly non-overridable. Restored sessions whose config file was removed must recreate the validated default before presenting settings; load failures show an actionable retry state rather than an indefinite loading message.

## Context transparency explorer (v1.2.17.4)

`Contexto do Wharness` is an inspection surface as well as a configuration dialog. It presents summary counts/bytes, every top-level project folder and root file with its final status, an exact searchable/filterable list of files included in the current ZIP, excluded paths with rule/reason, and the complete effective exclusion/inclusion rule catalogue. The user can rebuild the context from this surface and immediately inspect the new snapshot.

The final-context list defaults to included files because that is the payload the planner receives. Included, excluded and all-item filters remain available, with bounded incremental rendering for large repositories. Security rules are visually distinguished from optional project/heuristic rules.

The Editor Host terminal MUST expose an explicit submit affordance in addition to Enter. After Host confirmation, ordinary argv commands such as `ls`, `pwd`, `cat`, `git`, `go`, `npm` and `make` must visibly submit and return stdout/stderr. The UI must preserve the argv-only security boundary and surface policy/runtime errors in the terminal history rather than silently ignoring input.

## Harness message affordances (v1.2.18)

Every sent or received Harness transcript message displays a local date/time and exposes a compact copy action without changing message content. Legacy messages without a stored timestamp may be migrated to a bounded local fallback timestamp when loaded.
