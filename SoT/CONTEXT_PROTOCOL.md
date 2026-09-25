# Context Protocol SoT

## Bootstrap artifacts

For every session Wharness creates:

1. a ZIP snapshot of eligible project files for local audit/reproducibility;
2. a manifest with paths, sizes, hashes, exclusions, and truncation metadata;
3. a safe textual context export used by the V1 planner adapter;
4. a synthetic root `EXPORTS.md` containing export provenance plus safe Git status/worktree metadata for analysis.

## Why the AI adapter uses a text export

ZIP is the canonical local snapshot. The API planner still consumes the safe text export. Consumer ChatGPT uses the live HTTPS file-map channel by default and fetches only authorized files required for the request; the request ZIP remains an explicit compatibility/fallback transport. When ZIP transport is selected, its archive-aware envelope remains bounded to the Wharness protocol instead of treating arbitrary project archives as instructions.

## Remote consumer-Web transport (v1.3)

> **Suspended by `adr/ADR-0074` (2026-09-25).** A provider request no longer
> depends on tunnels in any way. Desktop does not publish remote input, does
> not wait for a tunnel before building or uploading the request archive, does
> not embed tunnel endpoints in the archive or composer bootstrap, and does not
> mirror comments to a remote channel. The request archive is the only context
> channel and the per-chat tunnel selector is removed. Tunnels serve only the
> paired remote webapp. The live-channel, tunnels-only and final diff-check
> rules below are retained as history and MUST NOT be implemented again until
> a tunnel-context strategy is decided in its own ADR.

Consumer ChatGPT input always has one direct Wharness-owned request input archive
when Desktop attachment transport is selected. That archive is authoritative and
may additionally contain an ordered list of configured live Tunnel Provider
endpoints as an advisory fallback. Each eligible provider publishes the same
request namespace; the consumer tries them in priority order only for refreshed
prompt/context state, individual files, hashes, diffs, and read-only events. A
failed endpoint MUST advance to the next and MUST NOT block a result based on the
attached archive when none is available. Remote storage drivers remain configurable
for other application purposes but MUST NOT select ChatGPT transport. Every planner request refreshes the
project context immediately before composer preparation. A tunnel provider publishes
one secret namespace for the whole main-request chain, containing typed prompt,
state/hash, immutable context, attachment and event resources. Wharness MUST
NOT reuse a namespace across unrelated main requests. A permanent provider MUST
rehydrate an active namespace after an application restart at the same public DNS.

Desktop exposes two independent transport switches at global-default and per-chat scope: `request archive ZIP` and `live verification tunnels`. A chat override replaces the global default until explicitly reset. Both may be enabled together, or either may operate alone; Wharness MUST reject a send with both disabled. The default is **live tunnels only** (`request archive ZIP=false`, `live verification tunnels=true`); changing this default requires a storage-key/version migration so installations carrying the former both-on default do not silently keep uploading the compatibility ZIP. With both enabled, the single ZIP remains self-contained and embeds the ordered tunnel endpoints as optional refresh/verification channels. With ZIP only, no remote namespace is required. With tunnels only, publication of at least one configured endpoint is required. Tunnel endpoints are ordered by configured numeric priority, and the consumer MUST advance on DNS, connection, timeout, invalid-status, or 5xx failure. Exhausting all tunnels never blocks a response when the ZIP is present.

Whenever live verification tunnels are enabled, the consumer MUST perform a final diff compatibility check immediately before delivering its bundle. It fetches the highest-priority reachable tunnel's current `diff-check.json`, `state.json`, and `file-map.json`, compares the current generation and context fingerprint with the plan baseline, derives touched files from the actual patch headers, and re-checks every complete patch against the current versions of those files. A failure during this final check advances to the next configured tunnel. If no tunnel is reachable and a request ZIP exists, the consumer still returns the bundle derived from that self-contained ZIP and reports its outcome truthfully; tunnel failure alone is never a blocked result.

ZIP-enabled modes always upload exactly one inbound bundle. Prompt, context, attachments, artifacts and structured project-file references are never split across multiple ChatGPT attachments. The primary project snapshot is expanded directly below `context/` in that bundle; related `@ref` snapshots live below `ref-context/`, admitted external `@attach` material below `att-context/`, generated project inventories/redacted sensitive key-state metadata live below `context-map/`, and the source/authority index lives at `metadata/context-sources.json`. A nested `context/*.zip` is forbidden. Entry validation preserves relative-path containment, secret exclusion and symlink denial. The ChatGPT composer contains only a short archive-protocol bootstrap. Tunnels-only mode places the live-channel protocol bootstrap and its ordered endpoints directly in the composer, but keeps the complete planner prompt and file content behind the authorized channel resources. No mode pastes the full request payload into ordinary chat text.
The composer transport contains only compact protocol/retrieval instructions;
it MUST NOT embed the user's request or generated planner protocol. Remote
consumer-Web transport MUST use a versioned file map, not a context or
attachment ZIP: the full authoritative planner prompt is a stable text resource
and `file-map.json` enumerates each permitted context, attachment, and artifact
file with its own absolute HTTPS URL, SHA-256, byte size, content type, and role.
Opening or restoring a local session MUST NOT publish remote context. Remote
publication is a bounded prerequisite of the explicit request only. Every
remote object or channel namespace includes an unguessable token.
The public tunnel origin root (`GET /`) returns only a non-sensitive Wharness
landing page. It may show the user-chosen instance name and the configured
permanent HTTPS origins, and may encode that same discovery-only metadata in a
QR code for a future explicit pairing flow. The QR MUST NOT contain a
credential, secret namespace, request identifier, resource URL, session, or
authorization grant. Its `/status` endpoint returns the non-secret
`wharness.tunnel-status/v1` health document so an operator or consumer can
distinguish a working Wharness origin from a provider-side connector failure.
The composer bootstrap MUST explicitly provide that `/status` URL and instruct
the consumer to verify it before reading live request resources. Neither route
may enumerate chats, requests, namespaces, resources, or configuration.

The current context is rebuilt before each planner request, including after
host Apply or Revert. The resulting archive remains governed by normal
seven-day retention.

For live verification tunnels, that planner-request snapshot is also the
authoritative starting snapshot for the immediately following remote publication.
Wharness MUST NOT synchronously rebuild the same project context a second time
while the composer is waiting on `A preparar contexto remoto`; edits that occur
after planner preparation are carried by the active channel monitor as a later
`context.changed` generation. One-shot immutable remote-object/archive transport,
which has no live context monitor, MAY retain its publication-time refresh.

Live channel file resources are content-addressed by role and SHA-256 and MUST be
reused across prompt-only rounds and context generations. Context file routes MUST
be lazy over the already-authoritative local context snapshot: publishing a channel
MUST NOT eagerly decompress and materialize one temporary file per context entry. A
tunnel provider MAY persist the immutable snapshot once inside its private namespace
and resolve each authorized `files/context/<sha256>` entry from that snapshot only
when the consumer fetches it. A channel update MUST copy only resources whose
content-addressed path is not already installed in the active namespace, while still
regenerating the complete current file map and endpoint-specific metadata. For mirrored tunnel sets, cached-resource state MUST
advance only after every required provider update succeeds; a partial provider
failure must not make a later retry assume that missing content was installed.

Cloudflare Named Tunnel, ngrok Reserved Domain, and a preconfigured Tailscale
Funnel are permanent providers. zrok and other explicitly allowlisted relay
clients may be used as lower-priority ephemeral fallbacks. Standalone providers
reuse the provider CLI's own browser-authenticated local session; Wharness stores
no account credential and never installs, logs in, or changes shared
tailnet/account configuration on the user's behalf. Token-provider
account tokens live only in private application credential files; the ordinary
tunnel document stores an opaque credential reference, HTTPS origin, and any
required loopback port. They start at backend startup, serve persisted active
channels before new work is accepted, retain the same public origin through
restart, and reconnect when the connector becomes unhealthy.

`TryCloudflare Tunnel` is an ephemeral compatibility provider for a running Wharness Desktop.
It starts a Cloudflare Quick Tunnel to a dedicated loopback-only file-map server on
an operating-system allocated available port (`127.0.0.1:0`), not
to the backend API. The server accepts only GET/HEAD for exact managed object
names and returns only exact allowlisted resource bytes; it has no route to project files, session
APIs, credentials, or arbitrary local paths. The public Quick Tunnel URL is
temporary and stops being valid when its local process stops.
For each main request, Wharness holds a channel lease across workflow rounds,
policy correction and execution repair. The request namespace closes after a
terminal answer, successful completion/apply, explicit cancellation, or
supersession by a new main request. One underlying Quick Tunnel is shared by all
Harness chats for the running Wharness backend session. It remains ready even
when no request channel is active and closes only when that backend session
ends, remote input is explicitly cleared/disabled, or startup fails. A process
stop invalidates all ephemeral namespaces.

A tunnel request channel uses
`/<secret>/manifest.json`, `state.json`, `hash.txt`, stable `prompt.md`,
`file-map.json`, `diff-check.json`, `prompts/<request_id>.md`,
`files/context/<sha256>`, `files/attachment/<sha256>`,
`files/artifact/<sha256>`, `bundle-contract.json`, and `events`. The local ZIP
snapshot remains an audit artifact and is never a consumer-Web retrieval
resource. A file-map entry is the complete authorization for its exact file URL;
the consumer MUST NOT infer sibling paths or enumerate the namespace. While the channel is active Wharness monitors
the eligible project context; a change installs the new context before updating
`state.json` and emits `context.changed`. Monitoring MUST use a lightweight metadata
dirty probe between bounded authoritative refreshes; it MUST NOT re-read, re-hash
and recompress the entire unchanged project on every short polling interval. The
authoritative full context build remains the source of the published context SHA-256. Comments submitted through the local
Desktop comment path are mirrored as `comment.added` events. The SSE stream is
read-only and intended for adapters that support streaming; consumer ChatGPT
Web receives comments through its allowlisted composer transport and is told to
re-fetch `state.json` immediately before producing a bundle. The composer
bootstrap MUST contain the literal absolute HTTPS URL of every required stable
resource. Manifests and state MUST also use absolute URLs; the consumer MUST NOT
need to construct an undisclosed sibling URL.

In a live channel, attachments and explicit `@file` contents are individual
file-map entries. Explicit `@file` context entries are marked `selected`; the
complete eligible project snapshot is represented by the context entries in the
current map. An inline `@{[see]<name>}` marker names one of the attachment
entries already in the map by file name; it MUST NOT produce a second entry for
the same content.

The remote file map is transport-only and does not alter the execution protocol
or trust order. ChatGPT MUST read the planner prompt and current file map before
acting. The returned `wharness-bundle-<request_id>.zip` still arrives
through the existing Desktop download seam and passes the same request
correlation, strict bundle validation, Policy Engine, Protected execution, and
Apply rules.

Remote objects use unguessable request-scoped names and live in a dedicated
Wharness namespace. Providers MUST expose a direct file URL that
ChatGPT can fetch without receiving storage credentials. A viewer, sharing,
preview, consent, or HTML landing-page URL does not satisfy this contract.
Provider adapters MUST normalize a native public link to the provider's raw
object-download form when necessary. Signed URLs are preferred; public-prefix
URLs are permitted only as an explicit provider configuration. Wharness never
puts provider credentials in prompts, context archives, renderer IPC, events,
or logs.

Project-file references may select only exact regular-file paths already present
in the authoritative eligible context manifest. The backend deduplicates and
limits them; excluded, secret, synthetic, missing, absolute, traversal, and
symlink paths remain unavailable regardless of composer text.

Wharness removes its remote input objects after seven days. Cleanup runs on
publication and startup when supported. A generic provider that cannot list its
namespace MUST at least support deletion of the Wharness-owned objects recorded
in the durable local publication index. Cleanup failure is observable but does
not disclose object URLs or credentials.

The separate storage seam supports multiple adapters for non-ChatGPT purposes. The initial adapters are:

- `rclone`, delegating provider authentication and transfer to a named rclone
  remote; browser OAuth is preferred whenever that provider supports it;
- `http`, for PUT/WebDAV-compatible private or self-hosted upload endpoints
  paired with a public HTTPS download prefix.

Remote storage is disabled by default and never changes ChatGPT transport. Configuration and authentication are
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

Known secret paths are skipped. Text files containing private-key markers or obvious credential assignments are excluded and recorded in the manifest. Outbound request transports MAY expose those excluded path names in generated `context-map/<source>/maps` metadata so the planner can see that a configuration file exists without receiving its contents. For excluded `.env`-style regular files only, `context-map/<source>/sensitive-file-map` MAY expose assignment names with `<<configured>>` or `<<empty>>` placeholders. It MUST NOT expose values, value hashes, raw lines, symlink targets, unreadable/oversized source contents, or any secret-bearing file content.

## Per-project context configuration (v1.2.17)

Every project owns `whaness.yml`. Wharness creates it before the first context capture when it is absent. The current schema stores a project name and context controls: automatic pruning, maximum file size, optional include patterns, explicit include overrides, and explicit exclude patterns.

Context selection order is conservative: mandatory secret/path exclusions and legacy `.harnessignore` remain authoritative; explicit include overrides selected in Settings may then restore a project-configured or heuristically pruned path without turning the ordinary include list into an allowlist; project excludes are then applied; a non-empty include list narrows the eligible files and may explicitly retain a path that would otherwise be removed only by heuristic auto-pruning; automatic pruning removes common dependency/cache/build/test/IDE/temporary/binary/archive/media artifacts and project-local AI-assistant state roots such as `.claude`, `.codex`, `.gemini` and `.opencode` — including shadow worktrees, mobile SDKs, native intermediates and framework compiler/deployment caches — from the remaining candidates; size and bundle limits are enforced last. Include patterns and overrides never override mandatory secret, VCS, symlink, dependency-root, `.harnessignore`, protected-path, content-safety, or size-limit exclusions.

Automatic pruning is context-only. It does not delete project files and does not grant the editor, terminal, planner, or executor additional filesystem access. The manifest records excluded paths together with the reason so the user can tune `whaness.yml` without guessing.

## Context inspection and transparency (v1.2.17.4)

The context settings surface MUST be able to explain the final ZIP, not only the requested configuration. Every rebuilt manifest records structured exclusion details (`path`, `kind`, `reason`, `rule`) alongside the legacy human-readable exclusion strings for compatibility.

The backend exposes a read-only context inspection derived from the current manifest plus the effective project rules. It reports every top-level project directory/file, exact final included files, excluded paths/subtrees, available size/creation/modification metadata, whether each decision can be changed through project configuration, byte/count summaries, and the complete active rule catalogue: mandatory Wharness exclusions, `.harnessignore`, `whaness.yml` include/override/exclude, automatic pruning, per-file size, bundle cap, content-secret/binary checks and symlink denial.

The final-context explorer MUST treat `manifest.files` as the authoritative included-file list. It may search/filter/paginate that list for usability, but MUST NOT infer that a file is included merely because a parent directory is eligible. Excluded directories may represent an entire skipped subtree and therefore do not require enumerating every child that was never walked.

Structured exclusion details are local audit/UI metadata and MUST be omitted from the planner prompt payload when the legacy compact exclusion summary already communicates the same decision, avoiding duplicate context cost.

## Export provenance and Git state (v1.2.21)

Every repository export produced by `make export` and every Wharness-managed context bundle MUST contain a generated root `EXPORTS.md`. The file is synthetic: context capture MUST NOT write or overwrite `EXPORTS.md` inside the managed project. If a project already owns that pathname, the generated export metadata is authoritative inside the archive.

`EXPORTS.md` records the export schema/kind, project identity/root and safe local Git state required for offline reasoning: Git availability/repository detection, repository root, branch or detached state, HEAD, `git status --short --branch --untracked-files=all`, and `git worktree list --porcelain`. Git remote URLs, credentials and `.git` internals MUST NOT be exported. Git collection is local-only, bounded by timeout and best-effort: unavailable Git metadata must be represented as metadata/warnings rather than making ordinary context capture fail.

For the Wharness repository itself, `make export` MUST additionally capture the current output of `scripts/status.sh` plus a bounded recent tail of `.harness/logs/desktop.log` inside `EXPORTS.md`. Raw `.harness` state/log directories remain excluded. Runtime collection is best-effort and secret-like values MUST be redacted before inclusion. Missing logs, unavailable services, or status-collection failures MUST be represented as diagnostics/warnings rather than failing the export. Host runtime diagnostics are specific to `make export` and MUST NOT be injected into context bundles for unrelated managed projects.

The Wharness repository export is a compact analysis snapshot, not an installation backup. `make export` MUST exclude historical `patches/`, every nested `.harness` directory, IDE metadata, `.orig/.rej` residues, dependency/build/test caches, and generated `kernl-context-*`, `wharness-input-*`, and `wharness-bundle-*` payloads. It MUST add synthetic root `EXPORT_INDEX.md` describing the exclusion policy plus a bounded inventory of included content, and the command MUST report final archive path, byte/human size, entry count, and SHA-256. `export-check` MUST fail if excluded runtime/transport/history classes reappear.

Managed-context metadata is deterministic and participates in the context fingerprint. A branch/index/status/worktree change therefore invalidates context affinity even if eligible project file bytes alone would otherwise hash identically. Volatile wall-clock generation time and Wharness host-runtime diagnostics MUST NOT affect managed-context fingerprinting. `make export` MAY include its UTC generation timestamp because it is an archival artifact rather than a planner cache key.

## Immutable request bases and revision journal (v1.3)

`manifest.sha256` remains the deterministic identity of one managed-context revision. Eligible bytes and stable Git status participate; volatile timestamps and runtime diagnostics do not. A different fingerprint signals a newer revision, but does not by itself invalidate work.

For every pending planner request Wharness retains a bounded private archive of the exact eligible context plus its `path → SHA-256` snapshot. Server filesystem locations are persistence-only state and MUST NOT appear in public Session JSON, renderer IPC, logs, or model prompts. Referenced archives survive ordinary context refresh and backend/Desktop restart until bounded retention can safely reclaim them.

Each session keeps a bounded observed revision journal containing parent/current fingerprints, changed paths, completeness, source, and observation time. The canonical ChangeSet actual write set, rather than `impact_files`, decides mechanical compatibility. A missing immutable base may use the legacy conservative adapter, but MUST NOT cause an already-live request to be superseded merely because a peer revision arrived.

Persisted context paths point to disposable local artifacts, not durable truth. If a session's current ZIP or text artifact is missing after a backend/Desktop restart, the download endpoint MUST rebuild both artifacts from the authoritative project, atomically update the session context, and preserve the active workflow/request state. A stale temporary pathname MUST NOT strand ChatGPT prompt preparation in an HTTP 404 loop.

## Refreshed continuation context plus root-relative divergence (v1.3.9 — see `adr/ADR-0041`, `adr/ADR-0055`)

A Main Request delivers one complete project snapshot. Every later request in that Main Request is a correction on top of it and MUST deliver both the refreshed complete snapshot and an explicit report of how the local project diverged from the Main Request snapshot. The complete snapshot is the authoritative current tree; the delta prevents a new fingerprint from hiding what actually moved.

- The comparison is anchored on the **root** request's own base commit (`refs/wharnex/base/<root_request_id>`), never the previous round's, so one lost or unread report does not break the chain.
- Every continuation MUST capture its own request base immediately alongside the context snapshot it describes. Capturing only for the Main Request left correction rounds with no anchored base, silently disabling base-rooted integration on exactly the rounds that need it.
- The report names each diverged path with its status and line counts, carries the real unified diff when it fits the transport budget, and states explicitly when it is truncated, when the diff was omitted and why, and when divergence could not be measured at all.
- An unchanged fingerprint is reported as an affirmative `UNCHANGED` verdict, not as silence.
- Wharnex-managed paths are excluded from the comparison for the same reason they are excluded from capture: they are not planner-patchable.
- Measurement is best effort and MUST degrade — to manifest-level changed paths, then to an explicit unknown verdict — rather than delay or fail the request.

## Desktop request archive layout (v1.3.1)

When Desktop builds the outer ChatGPT input archive, `context/` MUST contain only the managed primary project snapshot. Related `@ref` project snapshots MUST be transported under `ref-context/<slot-name>/`; admitted external `@attach` material MUST be transported under `att-context/attach-<slot>/`; generated path/sensitive-key metadata MUST be transported under `context-map/main/` and `context-map/@ref/<slot-name>/`; and the source/authority mapping MUST be published as `metadata/context-sources.json` using `harness.context-sources/v1`. `context-map/` is Wharnex-owned metadata and is never a patch target. `maps` describes included paths plus excluded file/subtree roots from each manifest; `sensitive-file-map` is limited to redacted `.env` assignment names and configured/empty state. `@attach` content does not receive a sensitive-file map. Direct user uploads remain under `attachments/` and system/user artifacts remain under `artifacts/`; neither is part of the primary context tree. The Engine MAY keep legacy `RELATED_PROJECTS/` and `ATTACHMENTS/` namespaces inside an internal combined workspace snapshot, but every outbound request transport MUST remap them at the archive boundary. It MUST NOT embed the snapshot as a second ZIP. Entry paths, symlink metadata, compression methods, expansion ratio, per-entry size and aggregate expanded size remain validated before composition.

## The prompt's context inventory is bounded (v1.4)

The planner prompt embeds the context manifest so every path a change intends to
touch can be resolved before the bundle is written. That inventory grows with
the project while the Desktop transport refuses a prompt over 1 MiB, and the
refusal used to arrive as a hard failure after the request was planned, its base
anchored and its context built (see `adr/ADR-0048`).

- The rendered manifest MUST be capped well below the transport limit, leaving
  the majority of the budget to the instructions, the user's message and the
  knowledge section.
- Selection under the cap MUST be deterministic, so the same project does not
  produce a different prompt on every request.
- Truncation MUST be declared in the prompt itself: how many entries were
  omitted, that the attached context bundle carries the complete set, the
  authoritative manifest SHA-256, and explicitly that absence from the list is
  NOT evidence that a file does not exist. A silently shortened inventory
  invites the planner to recreate a file that already exists, which is worse
  than a list it knows is partial.
- Package-manager content stores and build caches MUST be pruned as
  dependencies regardless of directory name. One project's repository-local
  pnpm store accounted for 98.9% of its files and made every prompt in that
  project undeliverable.

The context ZIP MUST deflate text entries and store non-text ones. Storing
everything made the archive the raw byte sum of the project and turned a
greeting into a twenty-minute upload; deflating an already-compressed payload
would spend CPU for nothing. Archives never enter the bundle at all. Bundle
identity MUST remain independent of the archive bytes — the manifest SHA-256 is
computed from paths and content hashes — and the context/bundle size budgets
MUST keep counting raw content, because they bound what the planner reads rather
than what the transport carries.

Package-manager content stores, build caches, IDE metadata and generated test
output MUST be pruned as dependencies regardless of directory name. Pruning is
mandatory and cannot be reopened by project configuration, so it MUST name only
unambiguous non-source directories: SQL migrations, for instance, are project
source and MUST stay.
