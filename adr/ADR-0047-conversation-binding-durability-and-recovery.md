# ADR-0047 — Conversation binding durability and recovery

- Status: accepted; permanence amended by v1.3.3
- Amends: the chat conversation affinity invariant (v1.2.6)
- Evidence: `wharnex-statable` workspace chats, 2026-09-11 → 2026-09-13

## Context

A Harness chat binds to one ChatGPT conversation, and that binding is local
metadata with no remote mirror: ChatGPT does not record which Wharnex chat a
conversation belongs to. Losing the stored URL therefore loses the relationship
outright — the chat opens the ChatGPT home surface and is indistinguishable from
one that was never bound.

Chats were losing it. The mechanism is an ownership mismatch between two layers
that each behaved reasonably on their own:

- `PUT /api/workspace-chats/{id}` is a **full replace** of a renderer-owned row,
  and `SaveWorkspaceChat` wrote whatever arrived, including `chatgpt_url`.
- The renderer **omits** `chatgpt_url` entirely when its own in-memory copy has
  none (`durableWorkspaceChat`). Omission decoded into a Go string is `""`,
  which is indistinguishable from a deliberate clear.
- `conversation_id` is derived from that same URL, so both fields died in the
  same write, leaving nothing in the row to recover from.

The blast radius is what made this severe rather than occasional. `persistChats`
re-PUTs **every** chat in the bounded list on any list mutation — renaming one
chat rewrites all thirty. A single chat whose in-memory copy lacked the binding
(hydration not yet run, a failed durable fetch, or a chat pushed past the
list bound and later revived from the localStorage cache) was silently unbound
the next time anything touched the list. The statable instance shows the
signature directly: one bulk write at `2026-09-12 18:18:44` touching 26 chats.

None of this is what the affinity invariant intends. As amended in v1.3.3, once
a chat has a URL no later action may clear or replace it. A generic row save,
remote-state update, navigation, send, recovery or conflict continuation must
all preserve that first concrete binding.

## Decision

**1. A binding is permanent.** `SaveWorkspaceChat` and `PATCH .../remote` may
establish the first binding only. When the stored row already has a concrete
URL, an incoming empty or different URL preserves the stored URL and derived
conversation id. Deleting the Harness chat is the only lifecycle operation
that removes its binding.

This is fixed on the server rather than in the renderer on purpose. The renderer
has many save paths and will grow more; the durable store is the one place that
can defend the binding against all of them, including paths that do not exist
yet.

**2. A chat that has lost its binding can be recovered.**
`GET /api/workspace-chats/{id}/binding-recovery` proposes the conversations the
chat may belong to, reconstructed from records Wharnex already holds, in
descending order of authority:

| Evidence | Why it ties the conversation to this chat |
| --- | --- |
| `agent_queue` | Wharnex's own durable browser queue drove that conversation for this exact chat |
| `transcript` | the chat's own recorded transcript names it |
| `session_events` | the chat's session history names it |

A conversation another chat already owns is reported as a conflict and never
offered, because taking it would send the next request into that chat's thread.

**3. Recovery fills only a missing binding.** The endpoint is read-only and the
surface requires the operator to confirm a candidate, or to paste the address
when no evidence survived. It is shown only for a legacy unbound chat and can
establish its first concrete binding; it cannot replace an existing one.

## Consequences

- An ordinary title, transcript or ordering save can no longer destroy a
  binding, whichever renderer path performs it.
- A chat broken before this change can be restored without the operator
  remembering a URL, provided any of the three evidence sources survived.
- Where no evidence survived, recovery degrades to an explicit paste rather than
  to nothing. Measured on the statable instance, all three currently unbound
  chats fall in this class — and all three were never bound in the first place,
  so there was nothing to restore.
- Once established, a binding remains until the Harness chat itself is deleted.

## Not decided here

The renderer still re-PUTs the whole bounded chat list on any list mutation, and
still omits fields its copy does not know. The server-side guard makes that
harmless for the binding specifically; making the wire format express "unchanged"
distinctly from "cleared" — so the same class of loss cannot appear in another
field — is left open.
