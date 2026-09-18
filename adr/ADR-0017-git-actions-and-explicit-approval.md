# ADR-0017 — Git actions and explicit approval

## Status

Accepted for v1.2.27.

## Context

Users need Wharness to handle repository operations such as commit, branch, merge, pull and push as first-class project changes. The previous model policy treated Git mainly as inspection and the Protected workspace rebuilt a synthetic one-commit baseline, which is unsuitable for history-sensitive operations. Copying the source `.git` directory verbatim is also unacceptable because hooks, local config and credential-bearing remotes can execute or disclose host-specific behavior.

## Decision

1. Read-only Git inspection remains low-risk. Dual-mode commands are classified by arguments: a `git symbolic-ref` invocation with exactly one ref name and only query flags (`--quiet`/`-q`, `--short`, `--no-recurse`) is inspection, while write/delete forms of `symbolic-ref` remain denied. A bounded allowlist of Git mutations is recognized as CHANGE intent and always requires explicit user approval.
2. `fetch`, `pull` and `push` must declare network access and are high risk. `clean`, `reset --hard`, force/force-with-lease, destructive delete flags, credential/config manipulation and unsupported subcommands remain denied.
3. For an existing Git project, Protected workspace creation uses a local no-hardlink clone to preserve commits/branches, removes the clone worktree content, then overlays the current eligible source working tree. This preserves dirty/untracked project state while keeping Git history meaningful.
4. Source hooks and arbitrary local Git config are never copied. Repository signing is disabled in Protected. Only HTTPS remotes without embedded userinfo/credentials may be reconstructed.
5. Protected `git push` is converted to `git push --dry-run`; the original approved operation is replayed on the host only after the complete plan and verification gates succeed. Other approved Git mutation commands are likewise replayed only after successful Protected execution.
6. Git host replay remains argv-only and is eligible only for commands already classified by Policy as safe supported mutations. A host failure is surfaced as an apply failure; self-evolution transactions retain their existing rollback behavior.

## Consequences

History-sensitive Git plans are tested against a faithful repository graph instead of a fabricated baseline, while source hooks and credential-bearing repository configuration stay outside the sandbox. Private/SSH remote authentication is intentionally not copied into Protected; such remote plans fail closed unless the sandbox can access a credential-free supported remote.
