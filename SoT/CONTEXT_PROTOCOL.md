# Context Protocol SoT

## Bootstrap artifacts

For every session Wharness creates:

1. a ZIP snapshot of eligible project files for local audit/reproducibility;
2. a manifest with paths, sizes, hashes, exclusions, and truncation metadata;
3. a safe textual context export used by the V1 planner adapter;
4. a synthetic root `EXPORTS.md` containing export provenance plus safe Git status/worktree metadata for analysis.

## Why the AI adapter uses a text export

ZIP is the canonical local snapshot, but model file-input support does not imply arbitrary archive extraction. Therefore V1 uploads a text context export by default while retaining the ZIP locally. A future provider may support archive-aware ingestion.

## Remote consumer-Web transport (v1.3)

Consumer ChatGPT input has two explicit transport modalities. With no remote
storage provider configured, Wharness retains the local attachment transport.
With a provider configured, Wharness packages the complete planner prompt,
eligible current context, selected system artifacts, and user attachments into
one `wharness-input-<request_id>.zip`, publishes it through the remote-storage
port, and sends ChatGPT only a short bootstrap instruction containing the
public HTTPS download URL and SHA-256 digest.

The remote input archive is transport-only and does not alter the execution
protocol or trust order. ChatGPT MUST read the planner prompt inside the archive
before acting. The returned `wharness-bundle-<request_id>.zip` still arrives
through the existing Desktop download seam and passes the same request
correlation, strict bundle validation, Policy Engine, Protected execution, and
Apply rules.

Remote objects use unguessable request-scoped names and live in a dedicated
Wharness namespace. Providers MUST expose a URL that ChatGPT can fetch without
receiving storage credentials. Signed URLs are preferred; public-prefix URLs
are permitted only as an explicit provider configuration. Wharness never puts
provider credentials in prompts, context archives, renderer IPC, events, or
logs.

Wharness removes its remote input objects after seven days. Cleanup runs on
publication and startup when supported. A generic provider that cannot list its
namespace MUST at least support deletion of the Wharness-owned objects recorded
in the durable local publication index. Cleanup failure is observable but does
not disclose object URLs or credentials.

The storage seam MUST support multiple adapters. The initial adapters are:

- `rclone`, delegating provider authentication and transfer to a named rclone
  remote; browser OAuth is preferred whenever that provider supports it;
- `http`, for PUT/WebDAV-compatible private or self-hosted upload endpoints
  paired with a public HTTPS download prefix.

Remote storage is disabled by default. Configuration and authentication are
application-level concerns, never project content, and `whaness.yml` cannot
enable a provider or contain its credentials.

### Provider-instance pool and quotas (v1.3.1)

Remote storage configuration is an ordered pool of 0..64 named instances. An
instance represents one account/remote, not merely a provider type; several
instances MAY use the same adapter. Instance ids are stable and unique because
usage, request windows, retained objects, cleanup, and diagnostics are all
account-scoped.

Lower numeric priority is preferred. For each publication Wharness evaluates
instances in ascending priority and selects the first account whose configured
limits admit the complete input. A rejected quota or adapter publication
failure advances to the next instance without consuming another account's
quota. If no instance succeeds, the request fails closed and local ChatGPT
uploads are not used.

Each instance independently supports these limits; zero means unlimited:

- successful publications per rolling `window_seconds`;
- files/entries per remote input archive;
- largest uncompressed input file;
- final published archive bytes;
- retained Wharness object count;
- retained Wharness storage bytes.

Usage is persisted together with the instance id. Retention cleanup decrements
stored-object and storage-byte usage only after provider deletion succeeds.
Request-window accounting and storage accounting MUST survive restart.

## Exclusions

Credentials, VCS internals, dependencies, generated output, database dumps, private keys, local harness state, and configured ignore paths are excluded.

## Secret detection

Known secret paths are skipped. Text files containing private-key markers or obvious credential assignments are excluded and recorded in the manifest.

## Per-project context configuration (v1.2.17)

Every project owns `whaness.yml`. Wharness creates it before the first context capture when it is absent. The current schema stores a project name and context controls: automatic pruning, maximum file size, optional include patterns, and explicit exclude patterns.

Context selection order is conservative: mandatory secret/path exclusions and legacy `.harnessignore` remain authoritative; project excludes are then applied; a non-empty include list narrows the eligible files and may explicitly retain a path that would otherwise be removed only by heuristic auto-pruning; automatic pruning removes common dependency/cache/build/test/IDE/temporary/binary/archive/media artifacts from the remaining candidates; size and bundle limits are enforced last. Include patterns never override mandatory secret, VCS, symlink, dependency-root, or protected-path exclusions.

Automatic pruning is context-only. It does not delete project files and does not grant the editor, terminal, planner, or executor additional filesystem access. The manifest records excluded paths together with the reason so the user can tune `whaness.yml` without guessing.

## Context inspection and transparency (v1.2.17.4)

The context settings surface MUST be able to explain the final ZIP, not only the requested configuration. Every rebuilt manifest records structured exclusion details (`path`, `kind`, `reason`, `rule`) alongside the legacy human-readable exclusion strings for compatibility.

The backend exposes a read-only context inspection derived from the current manifest plus the effective project rules. It reports every top-level project directory/file, exact final included files, excluded paths/subtrees, byte/count summaries, and the complete active rule catalogue: mandatory Wharness exclusions, `.harnessignore`, `whaness.yml` include/exclude, automatic pruning, per-file size, bundle cap, content-secret/binary checks and symlink denial.

The final-context explorer MUST treat `manifest.files` as the authoritative included-file list. It may search/filter/paginate that list for usability, but MUST NOT infer that a file is included merely because a parent directory is eligible. Excluded directories may represent an entire skipped subtree and therefore do not require enumerating every child that was never walked.

Structured exclusion details are local audit/UI metadata and MUST be omitted from the planner prompt payload when the legacy compact exclusion summary already communicates the same decision, avoiding duplicate context cost.

## Export provenance and Git state (v1.2.21)

Every repository export produced by `make export` and every Wharness-managed context bundle MUST contain a generated root `EXPORTS.md`. The file is synthetic: context capture MUST NOT write or overwrite `EXPORTS.md` inside the managed project. If a project already owns that pathname, the generated export metadata is authoritative inside the archive.

`EXPORTS.md` records the export schema/kind, project identity/root and safe local Git state required for offline reasoning: Git availability/repository detection, repository root, branch or detached state, HEAD, `git status --short --branch --untracked-files=all`, and `git worktree list --porcelain`. Git remote URLs, credentials and `.git` internals MUST NOT be exported. Git collection is local-only, bounded by timeout and best-effort: unavailable Git metadata must be represented as metadata/warnings rather than making ordinary context capture fail.

For the Wharness repository itself, `make export` MUST additionally capture the current output of `scripts/status.sh` plus a bounded recent tail of `.harness/logs/desktop.log` inside `EXPORTS.md`. Raw `.harness` state/log directories remain excluded. Runtime collection is best-effort and secret-like values MUST be redacted before inclusion. Missing logs, unavailable services, or status-collection failures MUST be represented as diagnostics/warnings rather than failing the export. Host runtime diagnostics are specific to `make export` and MUST NOT be injected into context bundles for unrelated managed projects.

Managed-context metadata is deterministic and participates in the context fingerprint. A branch/index/status/worktree change therefore invalidates context affinity even if eligible project file bytes alone would otherwise hash identically. Volatile wall-clock generation time and Wharness host-runtime diagnostics MUST NOT affect managed-context fingerprinting. `make export` MAY include its UTC generation timestamp because it is an archival artifact rather than a planner cache key.

## Concurrent baseline fingerprinting

`manifest.sha256` is the authoritative managed-context baseline fingerprint for planner concurrency. Wharness records the fingerprint used for every planner `request_id` and new change/workflow plans echo it as `base_context_sha256`. Equality means the requests were prepared from the same managed context; a different value means the plan must be re-evaluated before execution or host mutation.

The fingerprint remains deterministic: eligible project bytes and stable Git status/worktree metadata participate, while volatile generation time and Wharness runtime diagnostics do not. This distinction is required so concurrency checks detect meaningful project/context changes without being invalidated merely by log growth or wall-clock time.
