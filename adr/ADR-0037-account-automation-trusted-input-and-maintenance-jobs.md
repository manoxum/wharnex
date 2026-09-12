# ADR-0037 — Trusted-input account automation and deferred chat maintenance

## Status

Accepted. Extends ADR-0027 (ChatGPT account automation provider) and ADR-0031
(passive chat archive lifecycle).

## Context

The consumer ChatGPT account operations defined by ADR-0027 — find/create a
project, move the owned conversation into it, apply the `WHX:` rename, and
archive it — were failing in the field. Three separate defects, all confirmed
against the live ChatGPT DOM rather than inferred from logs:

1. **Menu items ignore synthetic clicks.** ChatGPT renders its conversation
   menu as Radix `div[role="menuitem"]` nodes whose select handlers do not run
   for a synthetic `HTMLElement.click()`. The implementation opened the menu
   successfully and then exhausted its retries selecting an item, surfacing as
   `action-unavailable`. Every rename, move and archive therefore failed at the
   same step.

2. **Rename waited for a dialog that does not exist.** The commit script looked
   for `[role="dialog"] input[data-testid*="title"]`. ChatGPT renames a
   conversation by swapping the sidebar row's anchor for an inline
   `input[name="title-editor"]`. There is no dialog at any point.

3. **Project lookup could never match, so every request created a project.**
   The existence probe required `a[href*="/g/g-p-"][data-testid*="project"]`.
   Those anchors carry no `data-testid`, so lookup always reported `missing`
   and the create path ran again — the observed remote project duplication.

Separately, the frontend treated an unconfirmed remote archive as a hard
failure and aborted the **local** archive with
`A conversa local não foi arquivada porque o arquivo remoto não pôde ser
confirmado (action-unavailable)`. Because of defect 1 that remote archive could
never succeed, which left the user unable to close a chat at all — a local,
user-owned action held hostage by a remote surface Wharnex does not control.

## Decision

### Locate in the page, commit with trusted input

Account scripts no longer click. They locate a control and return its
viewport-relative click rect; the main process commits it with
`webContents.sendInputEvent`, the same trusted-input mechanism the composer
transport already uses. A script that cannot find its control returns a typed
failure state (and, for menus, the labels it did see) instead of clicking
something adjacent.

This does not widen what may be inspected. The scripts still read only
structural control metadata and exact user-owned project/conversation labels,
per the `AGENTS.md` section 8 boundary. It changes only how an already-permitted
control is activated.

Trusted input is a renderer-level event. It does not move the operating-system
pointer and does not focus the remote WebContents, so the existing prohibition
on stealing focus during automatic transport is unaffected.

A hidden owned view is never given bounds by the window layout, leaving its
renderer with a zero-sized viewport in which every rect collapses to the origin.
Account automation therefore gives such a view a real layout viewport before
locating controls, without ever making it visible.

Whether a view is being shown is a property of the view, never of the chat it
owns. A Worker is hidden even while it owns the very conversation the Supervisor
currently displays — the common case, since a chat is organized immediately
after it was used. Only the entry the Supervisor actually holds for that chat is
exempt from receiving a layout viewport; a Worker entry never is. Deciding this
by chat key alone leaves such a Worker at zero size, so every located control
measures as offscreen and the task exhausts its attempt budget without the
control ever having been unreachable.

### Conversation menus are addressed by conversation id

The trigger is resolved through `data-conversation-options-trigger`, whose value
is the conversation's own id, falling back to the thread-header
`conversation-options-button` when the conversation is open but not in the
visible history. A sidebar reorder between locating and clicking can no longer
open a neighbouring conversation's menu.

### Project creation is idempotent against the account's own inventory

Existence is decided by reading the "Move to project" submenu, which is the
account's authoritative project list, and comparing names with case and
whitespace folded. Creation is confirmed by re-reading that same inventory; a
confirmation that matches more than once is reported as a duplicate rather than
silently accepted. `Wharnex` can no longer create a sibling of `wharnex`.

### The local archive is authoritative; the remote archive is deferred

Closing a chat always archives it locally. An unconfirmed remote archive is
recorded as durable chat state (`remoteArchive: { state: 'pending', attempts,
lastState, lastAttemptAt }`) instead of aborting the operation. A background
maintenance job retries it under bounded exponential backoff (5 min doubling to
a 6 h ceiling, 8 attempts). Because the owned view is normally released when the
chat is archived, the retry recreates it from the stored conversation URL; a
released view with a known URL must not be reported as a successful archive.

### Chat naming comes from the planner result; remote rename remains queued

A chat opens with a provisional title derived locally from its first prompt. The
planner's accepted `turn.chat_title` becomes definitive and the existing durable
rename/project-assignment queue applies it to the linked ChatGPT conversation. A
title the user typed is definitive and is never overwritten by a later planner
turn. New requests do not schedule `TITLE_DISCOVER`, and persisted legacy
`TITLE_GENERATE_TEMP` tasks are compatibility sinks: they must never create a
second ChatGPT conversation just to manufacture a name.

### Library retention is bounded by proven ownership

Request/response bundles accumulate in the account's ChatGPT library. They are
eligible for deletion once their owning chat has been archived longer than the
retention window (3 days). Eligibility is proven by the bundle naming contract
(`whx_bundle_<req|res>_<chat_id>_<request_id>[_<subrequest_id>].zip`), which
embeds the owning chat id. An entry that does not parse as a Wharnex bundle for
an expired archived chat is never touched.

## Consequences

- Account automation now depends on trusted input events, so it cannot run
  against a WebContents that refuses `sendInputEvent`. That is the same
  dependency the composer transport already has.
- Scripts return rects, which makes them directly testable as pure string
  builders and keeps the clicking decision in one auditable place.
- A remote surface outage degrades to deferred work instead of a blocked user
  action; the cost is that a chat may stay archived locally while still visible
  in the ChatGPT sidebar until a retry succeeds.
- Chat naming no longer consumes a separate ChatGPT conversation. The planner
  response carries the semantic title, while the durable lifecycle queue remains
  responsible only for applying that accepted title/project organization remotely.
