# ADR-0006 — Harness chat / ChatGPT conversation affinity

## Status
Accepted for v1.2.6; amended for v1.2.18.2, v1.2.25, v1.2.33 and v1.2.38.1.

## Context
A workspace may contain several independent coding threads. Reusing one Harness transcript and one arbitrary ChatGPT page causes context collisions and makes reopening work unreliable.

## Decision
Each Harness chat is a local persistent record containing a unique chat id, one backend session id, a compact local transcript, title, timestamps, and an optional stable ChatGPT conversation URL. The active chat id is part of workspace persistence.

The Electron shell owns one isolated ChatGPT `WebContentsView` per live Harness chat. A view is created for a chat id, records that id as its immutable owner, and is never reassigned to another chat. Switching Harness chats hides the previous view and activates only the selected chat's own view. The views share the persistent `persist:wharness-chatgpt` browser partition solely so authentication/browser-session state remains common; DOM, navigation history, composer state and page renderer state remain separated by `WebContentsView`/`webContents` instance.

A new Harness chat navigates to `https://chatgpt.com/`. Observing that trusted new-chat surface arms automatic affinity even while the page is still loading. After the first prompt causes ChatGPT to transition to a concrete conversation URL containing `/c/`, Wharness stores the origin + pathname as the binding. Query strings and fragments are not persisted. The post-submit transport waits a bounded interval for that URL transition instead of persisting the home page as the conversation. In v1.2.38.1 the concrete URL must remain stable for a short settling window and the owned page must no longer be loading before Desktop publishes it as the definitive affinity candidate. The application controller consumes candidate events globally and persists/confirms them even when the ChatGPT Inspector pane is not mounted, removing pane visibility from the binding contract.

Every DOM/input/navigation operation is addressed by Harness chat id. The main process verifies that the resolved entry is still registered under the same owner id before executing allowlisted JavaScript or native input; active-view fallback is not used for these operations. A concrete ChatGPT conversation may belong to only one active Harness chat. Automatic or explicit binding rejects a `/c/...` URL already owned by another Harness chat and leaves the current chat unchanged.

If an existing linked chat is manually navigated to another ChatGPT conversation, navigation alone does not overwrite the binding. Rebinding requires explicit user action. An explicit Harness Send while that different concrete conversation is open is considered such an action: transport stays on the visible conversation, updates the local binding, and sends a fresh context ZIP before the new prompt.

Each chat persists the context snapshot hash and ChatGPT conversation URL for which project context was last transported. A later prompt omits the ZIP only when both the snapshot hash and concrete conversation are unchanged. This avoids duplicate context on sequential turns while still refreshing a stale chat after parallel project mutations.

Desktop renderer-controlled navigation is allowlisted to trusted HTTPS `chatgpt.com` origins. Narrow DOM probes required by the automation transport execute only in the renderer owned by the addressed Harness chat; arbitrary response extraction, cross-chat DOM access, cookie reads and credential exposure remain forbidden.

## Recovery
Frontend/Desktop restart restores the active chat, transcript, and ChatGPT URL from local persistent storage. Dedicated remote view instances are recreated after process restart and navigated only to their owning chat's stored URL. Backend sessions are in-memory; after backend restart a stale per-chat session id is replaced lazily with a fresh session when that chat is opened, while the transcript and ChatGPT URL remain intact.

## Consequences
- Multiple work threads can coexist in one project without request/plan collisions.
- ChatGPT continuity survives Wharness restart.
- Remote renderer memory scales with live chats because renderer reuse across chats is intentionally forbidden; permanent local chat deletion destroys its dedicated view.
- Backend execution history is not yet durable across backend restarts; only the chat transcript and ChatGPT affinity are durable in v1.2.6.
