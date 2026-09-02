# ADR-0006 — Harness chat / ChatGPT conversation affinity

## Status
Accepted for v1.2.6.

## Context
A workspace may contain several independent coding threads. Reusing one Harness transcript and one arbitrary ChatGPT page causes context collisions and makes reopening work unreliable.

## Decision
Each Harness chat is a local persistent record containing a unique chat id, one backend session id, a compact local transcript, title, timestamps, and an optional stable ChatGPT conversation URL. The active chat id is part of workspace persistence.

The Electron shell still owns only one isolated ChatGPT `WebContentsView`. Switching Harness chats navigates that view to the selected chat's stored URL. This avoids multiplying remote renderers while preserving one-to-one logical affinity.

A new Harness chat navigates to `https://chatgpt.com/`. After ChatGPT creates a concrete conversation URL containing `/c/`, Wharness stores the origin + pathname as the binding. Query strings and fragments are not persisted.

If an existing linked chat is manually navigated to another ChatGPT conversation, Wharness does not silently overwrite the binding. Rebinding requires explicit user action.

Desktop renderer-controlled navigation is allowlisted to trusted HTTPS `chatgpt.com` origins. No DOM, cookies, response content, or authentication state are read.

## Recovery
Frontend/Desktop restart restores the active chat, transcript, and ChatGPT URL from local persistent storage. Backend sessions are in-memory; after backend restart a stale per-chat session id is replaced lazily with a fresh session when that chat is opened, while the transcript and ChatGPT URL remain intact.

## Consequences
- Multiple work threads can coexist in one project without request/plan collisions.
- ChatGPT continuity survives Wharness restart.
- Remote browser memory remains bounded because a single `WebContentsView` is reused.
- Backend execution history is not yet durable across backend restarts; only the chat transcript and ChatGPT affinity are durable in v1.2.6.
