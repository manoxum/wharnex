# Wharness v1.2.6 scope — Multi-chat

## Delivered

- Multiple Harness chats per workspace.
- Independent local transcript and backend session id per chat.
- Active chat persistence across reload/reopen.
- Per-chat ChatGPT conversation URL persistence.
- Automatic ChatGPT navigation when selecting a Harness chat.
- Automatic first binding for a new chat once ChatGPT creates a concrete `/c/...` URL.
- Explicit rebind UX when the user browses a different ChatGPT conversation.
- Trusted-only ChatGPT navigation IPC and regression test.
- Legacy single-chat transcript migration.

## Deliberately not included

- Reading ChatGPT DOM/output to discover chat content.
- Importing Chrome cookies or profiles.
- Multiple simultaneous ChatGPT renderer instances.
- Durable backend execution/session state across backend process restarts.
