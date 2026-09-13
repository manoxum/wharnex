# ADR-0048 — Durable archive state and bounded prompt inventory

- Status: accepted
- Amends: `adr/ADR-0047` (same omission class), the chat conversation affinity invariant
- Evidence: `wharnex` and `flowKey-deploy` workspaces, 2026-09-13

## Context

Two unrelated-looking reports turned out to be two more instances of one shape:
**state that grows or changes without a bound, discovered only by a hard failure
at the last possible step.**

### 1. Archived chats reopen on restart

Archiving a chat wrote to `localStorage` and archived the *session*
(`api.archiveChat(sessionId)`). It never wrote `harness_workspace_chats.archived_at`.
Hydration merges the durable record over the local one and the durable record
wins, so every chat archived after it became durable came back open on the next
start. The only rows that carried `archived_at` at all were the ones pushed by
the one-way migration, which explains the exactly-30 archived rows in both
instances: the renderer's `slice(0, 30)` bound, frozen at migration time.

This is the same defect class as `adr/ADR-0047`: the renderer omits a field it
does not know, the server reads omission as a clear. There it was the
conversation binding; here it is the archive flag.

### 2. A project could not send any prompt

In `flowKey-deploy` every send failed, and the Desktop log named it exactly:

```
Error occurred in handler for 'wharness:chatgpt:prepare-prompt':
  Error: Prepared prompt exceeds 1 MiB limit
```

The prompt embeds the context manifest so the planner can resolve the paths it
intends to touch. That project's manifest held **14,468 files**, rendering a
**5.8 MiB** prompt against the Desktop's hard 1 MiB cap. All five of its chats
were left unbound, because the send never happened.

Two separate causes stacked:

- **The inventory was 99% dependency payload.** The project has 59,518 files, of
  which **58,894 (98.9%)** live under `.pnpm-store` and similar package-manager
  stores. `node_modules` was already pruned; a repository-local pnpm store is
  the same content under a different name, and was not.
- **The inventory had no bound.** Even correctly pruned, a large repository of
  genuine source will exceed any per-prompt budget eventually. The measured
  prompt for Wharnex's own repository was 862 KiB — **84% of the cap** — so this
  was days away from breaking there too, with the same unhelpful failure.

The failure arrived after the request was planned, the request base anchored and
the context built, as an exception in an IPC handler. Nothing upstream knew a
budget existed.

## Decision

**1. Archive state is durable and explicit.** A generic chat save may no longer
clear `archived_at`, exactly as it may no longer clear `chatgpt_url`.
`PATCH /api/workspace-chats/{id}/archived` is the explicit archive/restore
action, and the renderer calls it on both transitions. Archiving twice does not
move the timestamp: the archive date is when the operator archived it.

**2. Package-manager content stores are pruned as dependencies.**
`.pnpm-store`, `.pnpm`, `.yarn-cache`, `.turbo`, `.parcel-cache`, `__pycache__`,
`.venv`, `.tox`, `.mypy_cache` and `.pytest_cache` join `node_modules` in the
mandatory exclusion set. These are dependency payloads and build caches under
different directory names, never project source.

**3. The prompt's inventory is bounded by construction, and truncation is always
declared.** The rendered manifest is capped well below the transport limit,
leaving most of the budget to the instructions, the user's message and the
knowledge section. When the inventory does not fit, the file list is truncated
deterministically — shallow paths first, ties alphabetical, then restored to the
manifest's own order — and the prompt states how many entries were omitted,
where the complete inventory still lives, and that **absence from the list is
not evidence that a file does not exist**.

That last sentence is the load-bearing part. A silently shortened inventory
invites the planner to conclude a file is missing and write it again from
scratch, which is worse than being told the list is partial — the same reasoning
that makes `SoT/ERROR_MODEL.md` require a truncated verification diagnostic to
name what it dropped.

## Consequences

- An archived chat stays archived across restarts, and restoring still works.
- `flowKey-deploy` goes from 14,468 manifest entries to a few hundred; pruning
  alone brings it far under the cap, and the bound is the backstop for
  repositories that are genuinely large.
- A planner may now receive a partial inventory. It is told so explicitly and
  told what to do about it, rather than being left to infer.
- Pruning is mandatory and cannot be reopened by project config, so a project
  that genuinely keeps source inside one of these directories would lose it.
  The names chosen are unambiguous content stores; `target`, `build` variants
  and `.cache` were deliberately not added for that reason.

## Not decided here

The renderer still re-PUTs the whole bounded chat list on any list mutation and
still omits fields its copy does not know. Two fields are now defended
individually; making the wire format distinguish "unchanged" from "cleared"
would close the class instead of its instances, and remains open from
`adr/ADR-0047`.

The session payload served by `/api/sessions/{id}` still carries the full
manifest — 16 MB for `flowKey-deploy` before pruning. Pruning shrinks it by the
same factor, but the response has no bound of its own.
