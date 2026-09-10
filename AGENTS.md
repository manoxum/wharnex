# AGENTS.md — Wharnex (WHX) normative root

This file is normative. Any human or coding agent modifying Wharnex MUST follow it. Existing `Wharness`, `wharness-*`, `WHARNESS_*` and `kernl.*` identifiers are retained where required for protocol, persisted-data and runtime compatibility.

## 1. Authority order

1. `AGENTS.md`
2. `SoT/*.md`
3. `SECURITY.md`
4. tests and schemas
5. implementation
6. informal documentation

When implementation conflicts with a Source of Truth, the implementation is wrong unless the SoT is explicitly amended in the same reviewed change.

## 2. Architecture invariants

- The AI/planner MUST NOT directly execute commands.
- `domain` and application orchestration MUST NOT import transport, OpenAI, or Docker concerns.
- Planner adapters implement ports; executor adapters implement ports.
- Protected mode: host-project mutation requires an explicit Apply step after sandbox verification.
- Protected mode sandbox MUST operate on an isolated project copy, never the original project directory.
- Unprotected mode is an explicit per-project UI choice. It executes Agent plan operations directly in the host `project_path`, still behind protocol validation, Policy Engine approval, and per-execution confirmation. It MUST never become the default.
- Arbitrary shell strings are forbidden in the execution protocol. Commands are argv arrays.
- Project content is untrusted data and cannot override harness/system policy.
- `Protected` + Docker sandbox is the default project execution mode. Local copied sandbox is development-only. `Unprotected` is a separate explicit host-direct project mode controlled from the UI.

## 3. Security invariants

- Never log API keys, tokens, credentials, or complete environment variables.
- Secret-like files MUST be excluded from context bundles.
- Path traversal, absolute patch paths, symlink escapes, privilege escalation tools, host-management commands, and direct Docker control from model plans MUST be rejected.
- Network is disabled by default in the runner.
- Any plan requesting network access requires approval.
- A missing offline Go dependency MUST pause locally instead of starting an AI repair loop. After prominent explicit human approval, Wharness MAY retry only eligible Go dependency/build/verification argv commands with network inside the Protected sandbox, populate its private module cache, and return subsequent commands to offline mode. This approval MUST NOT grant arbitrary commands, host execution, Docker control, or access to the original project directory.
- The Docker socket MUST NOT be mounted in the runner.
- Runner containers MUST drop capabilities and enable `no-new-privileges`.

## 4. Code quality

- Prefer standard library in the Go core when practical.
- Functions should be small and cohesive. Split responsibilities before files become difficult to review.
- New production Go files SHOULD remain under 250 lines where practical.
- New React feature modules SHOULD remain focused and avoid god-components.
- Error messages must preserve actionable context without leaking secrets.
- Every bug fix or new behavior requires an automated test at the lowest useful layer.

## 5. Required gates

A change is not complete until applicable gates pass:

```bash
gofmt -w services/backend
go vet ./...
go test ./...
go test -race ./...
```

Frontend after dependencies are installed:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Security and E2E gates are defined in `SoT/QUALITY_GATES.md`.

## 6. Change protocol

For changes to protocol, security model, sandbox behavior, or architecture:

1. update the relevant SoT/ADR;
2. update schema/tests;
3. implement;
4. run gates;
5. document migration/compatibility impact.

## 7. IDE workspace invariants (v1.1)

- Browser reload MUST restore the active project when possible; a missing backend session MUST fall back to reopening the remembered project path.
- Explorer/editor APIs MUST enforce project-root containment, excluded/secret paths, symlink denial, UTF-8 text limits, and optimistic SHA-256 writes. Explorer create/rename/delete are explicit human host mutations and MUST reuse the same containment/exclusion/symlink boundary; destructive directory deletion requires explicit UI confirmation.
- The interactive Editor terminal MUST default to a copied sandbox workspace. A human MAY explicitly switch that terminal to `Host` only after a dedicated confirmation; Host terminal commands execute directly in the project root, remain argv-only, remain subject to Policy Engine denial, and MUST display a persistent host-direct warning. The terminal target is independent from Agent Protected/Unprotected mode.
- Human terminal commands MUST be evaluated by a dedicated interactive policy profile rather than by the model-plan policy. Normal project-development argv mutations MAY be allowed, but shell interpreters, privilege escalation, container/host administration and inline-code evaluator flags remain denied.
- Terminal commands MUST be argv, never an implicit shell string.
- Interactive terminal submission MUST provide a visible explicit run affordance in addition to Enter; Host submission still passes through the dedicated interactive policy and direct argv runner.
- Editor saves are explicit human host mutations. Agent mutations are sandbox-first in Protected mode; only an explicitly selected Unprotected project may execute the Agent plan directly on the host.
- Every agent request MUST refresh project context so manually edited files are visible to the planner.
- Consumer ChatGPT automation MUST use narrow, named and tested operations. Besides transport (composer, submit and exact expected bundle download), Desktop MAY manage only the Wharnex-owned account objects needed for the workflow: find/create an exact project name, move the owned conversation to it, rename the owned conversation with the `WHX:` prefix, stop/archive that conversation, collapse its sidebar, and delete from the account library only those bundle files whose Wharnex naming contract proves they belong to an expired archived chat. These operations MAY inspect only structural control metadata and exact user-owned project/title labels; they MUST NOT inspect generated assistant prose, cookies, storage, unrelated conversations, or arbitrary page content. Ambiguous or missing controls fail closed and require human attention. Downloaded bytes still pass the normal strict bundle validator.
- Wharnex MAY read the reasoning steps ChatGPT is visibly showing for a Wharnex-driven conversation, and only those, to populate the "Raciocínio visível do ChatGPT" panel (see `adr/ADR-0038`). This is a bounded exception to the prohibition on reading generated output and does not extend to answer prose. Rows MUST be selected structurally — short leaf lines that neither sit inside nor contain a code, markdown, or screen-reader-only region — never by judging what the text says; wrapper elements that report the concatenation of the rows beneath them MUST be discarded. Capture MUST be bounded per tick, MUST remain passive (a health probe observes and MUST NOT click, so a collapsed reasoning disclosure is simply not read), and its failure MUST NOT affect liveness classification. Completion MUST still never be inferred from reasoning text.
- Account-management scripts MUST locate their control and return its click target rather than clicking it themselves; the main process commits that target with a trusted native input event (see `adr/ADR-0037`). ChatGPT's menu items do not honour synthetic DOM clicks, so a script that clicks is a script that silently does nothing. Trusted input remains renderer-level: it MUST NOT move the operating-system pointer and MUST NOT focus the remote WebContents. A conversation menu MUST be addressed by that conversation's own id, never by list position. Project creation MUST first read the account's own project inventory and compare names with case and whitespace folded, so an existing project is never duplicated; a confirmation matching more than once MUST be reported as a duplicate, not accepted.
- Archiving a chat is a local, user-owned action and MUST complete locally even when the remote ChatGPT archive cannot be confirmed. An unconfirmed remote archive MUST be recorded as durable pending state and retried by a bounded background job under exponential backoff, never surfaced as a failure that prevents the user from closing the chat. A retry whose owned view was already released MUST recreate it from the stored conversation URL; a released view MUST NOT be reported as a successful remote archive. Background maintenance jobs MUST process one item per tick, MUST skip the chat the user is currently viewing, and MUST degrade into durable state rather than interrupting unrelated work.
- ASK/advice is a first-class Agent outcome and MUST NOT be converted to a coding/change task merely because project context exists or Auto is enabled. A non-terminal `workflow` MAY gather missing local evidence, but it MUST be command-only, network-disabled, Protected-sandbox-only, never host-applied, and bounded to six rounds before a terminal result.
- Future MCP integration MUST be implemented as an adapter behind Wharness application/security ports. Remote consumer ChatGPT MUST NOT receive direct localhost MCP access that bypasses protocol validation, Policy, path containment, or Protected execution.
- Project/context exports MUST include synthetic `EXPORTS.md` provenance with safe Git status/worktree state; `.git` internals and remote URLs remain excluded, and managed-context metadata must not introduce volatile timestamp churn into the context fingerprint. The Wharness repository `make export` additionally MUST include bounded/redacted Wharness runtime status and recent desktop logs in `EXPORTS.md`, MUST omit historical patch/runtime/IDE/generated transport payloads that add noise or private state, and MUST include a synthetic `EXPORT_INDEX.md` describing its content policy/inventory; managed-project context bundles MUST NOT inherit those host-runtime diagnostics.


## 8. Desktop composition invariants (v1.2)

- Every live Harness chat MUST own a distinct remote ChatGPT `WebContentsView`, keyed by that chat id, with Node integration disabled, Chromium sandbox enabled, context isolation enabled, and no Wharness preload. A ChatGPT `WebContentsView`/`webContents` MUST NEVER be reassigned between Harness chats; all allowlisted DOM/input/navigation IPC MUST carry and validate the owning chat id before touching the remote renderer. Views MAY share the dedicated persistent ChatGPT browser partition for authenticated browser-session state only. A true integration conflict MUST use a distinct auxiliary ChatGPT `WebContentsView` keyed by its owning Harness chat plus conflict id; its affinity, request, recovery state and lifetime remain independent from the primary chat view, and resolution or explicit cancellation releases it.
- The Agent labels its automated, request-bound ChatGPT surface **Engine**. A separate project-scoped **ChatGPT** surface MAY provide direct human browsing/conversation, but it MUST register no Wharness prompt, activity, bundle, recovery, affinity, or account-automation listeners; it exposes only ordinary browser navigation and remains subject to the same renderer isolation and overlay suspension rules.
- Desktop multi-window project ownership MUST be explicit: one canonical project path may belong to only one live Wharness window at a time. A window MAY bind several projects, but project switching MUST preserve each bound project renderer state rather than reusing one global project state. ChatGPT views remain scoped to both their Harness chat and owning desktop window.
- The privileged Wharness preload MUST be attached only to the trusted local frontend origin and MUST expose narrow, named IPC capabilities rather than `ipcRenderer` or generic send/invoke primitives.
- Wharnex MUST NOT inspect ChatGPT cookies, local storage, generated response prose, or authentication state during normal ChatGPT transport/account automation. Permitted DOM interaction is limited to the named transport and Wharnex-owned account-management operations above; it MUST NOT infer model content/completion from response text. Electron persists the remote browser partition and MAY export/import that partition only as an opaque user-requested Wharnex session backup that is treated as a secret. ChatGPT authentication has two explicit user-selectable modes: **Embedded**, where compatible login navigation remains inside the sandboxed ChatGPT `WebContentsView`; and **External browser**, where Wharnex launches a real Chrome/Chromium/Brave process with a Wharnex-owned persistent dedicated profile and loopback-only DevTools endpoint, always starting again at `https://chatgpt.com/auth/login`. An in-flight OAuth URL created in Electron MUST NEVER be handed to another browser. The sole credential-inspection exception is the external-auth callback relay: after the managed browser proves an authenticated return to `chatgpt.com`, main-process code MAY read only `chatgpt.com` cookies from that Wharnex-owned dedicated profile and write them directly to the dedicated Electron cookie store. Cookie values MUST never enter the renderer, logs, project context, or generic IPC; unrelated-domain and Cloudflare/anti-bot cookies MUST be excluded, and the dedicated browser profile MUST remain private under Wharnex `userData`, persist across successful/cancelled login attempts, and be deleted only by an explicit browser-session/full-data clear.
- The desktop context-copy IPC MUST derive the backend bundle URL internally from an allowlisted local backend plus a validated session ID. Renderer-supplied arbitrary fetch URLs are forbidden.
- ChatGPT remote permissions are denied unless explicitly allowlisted in the security model.
- Native clipboard file references MUST point only to context artifacts generated by Wharness in its temporary context directory.
- Automatic ChatGPT input transport MUST NOT switch the visible Inspector tab or explicitly focus the remote WebContents. Native mouse/key events may target the ChatGPT WebContents while the Wharness window is already focused; explicit focus is reserved for user-invoked bridge actions.
- A ChatGPT remote view's own background throttling MUST stay disabled while it is the active/visible view of its owning window, or while Wharness owns a concrete reason to keep observing it: a loading navigation, an expected bundle download, a pending human action, an in-flight transport request, or an account-automation operation. Once none of those hold, an owned view MAY allow normal Chromium background throttling instead of running unthrottled indefinitely; the reconciliation MUST re-evaluate on every visibility change and on a bounded periodic sweep, and MUST NOT depend on the throttled page's own JS timers to detect state changes — Wharness's own supervision (health probes, navigation/download events) runs from the main process on its own schedule regardless of the remote page's throttling. Liveness recovery MUST be bounded per chat/request. A structurally detected anti-bot/auth/access gate or exhausted bounded transport/surface recovery MUST pause automation and publish explicit human attention through trusted local UI/OS notification; recovery MUST NOT repeatedly reload a human verification challenge.
- While the user-selected **External browser** authentication flow is active, the affected embedded remote view stays hidden. The managed browser must be a real Chrome/Chromium/Brave executable, use a Wharness-owned persistent dedicated profile, bind DevTools only to `127.0.0.1`, and begin from `https://chatgpt.com/auth/login`. Return to non-auth `chatgpt.com` plus a successful in-browser auth-session check is the callback signal. Wharness then performs the narrow ChatGPT-cookie relay described above, closes the managed browser, preserves its dedicated profile for future Google/ChatGPT sign-in reuse, and reloads the embedded view. The ordinary personal Chrome profile MAY be opened only as a manual isolated shortcut and MUST NOT be inspected, debugged, or presented as callback-capable. Google OAuth MUST be handed to this managed-browser flow when selected from Embedded mode because Google disallows embedded user-agents. The ordinary operating-system browser remains a manual, session-isolated fallback and MUST NOT be presented as callback-capable.
- While one manual request is pending, the Desktop MAY normalize a generic downloaded ZIP filename to the exact canonical `wharness-bundle-<request_id>.zip` bound to that active chat. It MUST NOT rewrite a different valid Wharness request id.
- Durable Harness chat attachments MUST live in Wharness-owned application storage, never inside the target project, and renderer IPC MUST address them through validated opaque references rather than arbitrary paths.
- Leaving the ChatGPT tab or Agent mode MUST hide the native remote view so it cannot intercept interaction over other Wharness surfaces. Any trusted Wharness modal/overlay that occupies the ChatGPT viewport MUST also suspend the native remote view until the overlay closes.
- Archived chats open in a temporary read-only preview without creating an active tab or resuming orchestration. Sending, response processing, and remote automation remain disabled until explicit restore.

## 9. Local lifecycle invariants (v1.2.1)

- Repository-root `make build`, `make start`, `make stop`, `make status`, and `make logs` are the canonical local lifecycle commands.
- Build commands MUST resolve Docker/build paths from the repository root, not from the caller's current service directory.
- Normal rebuilds MUST avoid unconditional package-manager hydration: dependency cache invalidation is keyed by lock/dependency metadata and runtime versions, while explicit refresh remains available for recovery.
- Successful backend/frontend/desktop build artifacts MAY be reused only through content/runtime fingerprints; a missing expected artifact or changed component input MUST invalidate that component, and an explicit forced rebuild path MUST remain available.
- The frontend production build MUST ship Monaco from its versioned precompiled local distribution instead of rebundling Monaco's source module graph during every Wharness rebuild.
- `make start` MUST track only processes it owns under `.harness/run`; `make stop` MUST NOT indiscriminately kill unrelated processes already using the same ports.
- Linux Electron startup MUST support an explicit `WHARNESS_OZONE_PLATFORM=x11|wayland` override and default safely when both Wayland and XWayland are present.
- Runtime PID/log files belong under `.harness/` and MUST remain excluded from project context and source control.
- The Compose project identity for a checkout MUST come from `WHARNESS_COMPOSE_PROJECT_NAME` when set, and otherwise default to that checkout's own folder name (never an opaque hash of the absolute path). Host ports MUST similarly default to 8080/5173 but be overridable per checkout via `WHARNESS_HTTP_PORT`/`WHARNESS_WEB_PORT`, so two independent checkouts of this repository can run their full stacks concurrently without colliding. A checkout MAY persist these overrides in its own gitignored `.harness/env` (a plain `KEY=value` file sourced by `scripts/stack.sh`/`scripts/start.sh`/`scripts/status.sh`/`scripts/database.sh`) instead of exporting them in every shell session.


## Git workspace invariant

- Every opened project root must own a Git repository. The backend may run `git init` automatically when `.git` is absent.
- Do not auto-commit or rewrite host history during Git bootstrap.
- When the host has an existing Git repository, sandbox copies are a real local clone of it (`git clone --local`), sharing its actual commit history; a host with no repository yet gets a fresh synthetic Git baseline instead. Either way the host's own `.git` directory is never copied byte-for-byte into a model execution workspace.
- Opening/restoring a project MUST initialize the Agent workspace in Protected + Auto. A user may switch that open project to Unprotected only through explicit confirmation; doing so disables Auto, and every Unprotected plan execution MUST require another explicit confirmation.
- The interactive Editor terminal target is independent of Agent Protected/Unprotected mode: `Sandbox` remains the default; `Host` is a separate explicit human-only target with confirmation and a persistent warning.
- Patch fallback may use `git apply --recount` or checked `--3way` only after a dry/check pass; never partially apply a failed fallback. Surface Git stderr on failure.
- Restored/legacy sessions MUST self-heal a missing `whaness.yml` through the validated default config creator before project settings are returned; a missing config file must not strand the UI in an indefinite loading state.

## Chat conversation affinity invariant (v1.2.6)

- A workspace MAY contain multiple Harness chats; each chat MUST own an independent Harness session identity and local transcript.
- Each Harness chat MAY bind to exactly one stable ChatGPT conversation URL. The binding is local metadata and MUST survive frontend/Desktop restart.
- Switching Harness chats MUST navigate the remote ChatGPT surface to the URL linked to the selected chat when one exists.
- An unbound Harness chat MUST begin from the ChatGPT new-chat/home surface and MAY auto-bind only after a concrete trusted `chatgpt.com/.../c/...` URL exists.
- After a new-chat submission, Desktop MUST wait until the concrete trusted `/c/...` URL is stable and no longer loading before publishing it as the definitive affinity candidate. ChatGPT's transient `/c/WEB:...` creation URLs are not definitive and MUST NOT be persisted. Candidate persistence/confirmation MUST be owned by application-level state, not by whether the ChatGPT inspector pane happens to be mounted; missed candidate events MUST be reconciled from per-chat Desktop state. Switching away from or back to a submitted unbound chat MUST preserve its owned renderer and pending affinity instead of navigating it back to the home surface.
- Once a chat already has a ChatGPT URL, navigation alone MUST NOT silently replace that binding. An explicit rebind action or an explicit Harness Send while a different concrete ChatGPT conversation is open counts as user intent; the latter MUST refresh the project context for the newly targeted conversation.
- Desktop navigation IPC MUST accept only trusted HTTPS `chatgpt.com` origins. Never expose arbitrary renderer-controlled navigation.
- While an expected Wharness bundle is active, liveness recovery MAY use only bounded transport/renderer failures and narrow structural activity signals already allowed by the ChatGPT transport. Recoverable connection failures reload the owned renderer; silent/stalled or ambiguous processing MUST request human attention and MUST NOT inject an automatic same-request recovery prompt. Recovery MUST NOT inspect assistant prose for decisions, change task scope, cross chat ownership, or loop indefinitely.
## Concurrent host integration invariant — Git-native (v1.3, superseding the ChangeSet/CAS mechanism)

- A project fingerprint is provenance, not a global mutation lock. Peer or external edits MUST NOT automatically supersede an in-flight planner request.
- This is the primary integration and communication protocol between the sandbox and the host. A verified sandbox candidate MUST be committed onto its own dedicated branch (`whx/<request_id>`) inside the same Git clone the sandbox already is, using a fixed non-human author identity and the plan's own `commit_message` (a mandatory field for `change` plans) plus `Request-Id`/`Plan-Id` trailers, never the operator's own configured Git identity or an unsanitized planner string. That `commit_message` MUST be meaningful developer-facing history derived from the actual patch: accurate Conventional Commits type (`feat` for new behavior, `fix` for a bug/corrective patch, etc.), useful scope when clear, and a concrete implemented/corrected outcome; generic bookkeeping subjects such as `update files`, `apply patch`, `requested changes`, or `Wharness-verified change` are not acceptable protocol output. That contract MUST be enforced, not merely published: a `change` bundle whose `commit_message` is missing, is not Conventional Commits, exceeds the 72-character subject limit, or matches the forbidden bookkeeping set MUST be rejected at ingestion — before Policy and sandbox verification, so a rejected message never discards a verified candidate. `commit_message` is a full Git message: subject, one blank line, optional body explaining why. Wharness MUST preserve that body verbatim and MUST NOT flatten it into the subject.
- That branch MUST be pushed only locally (an absolute host filesystem path, never a network remote, never the operator's own configured `origin`) into the host's own `.git`. Apply MUST integrate it with a real `git merge --no-ff --no-edit` into whatever the host currently has checked out, then rerun the plan's own verification commands against the merged result.
- A failed post-merge verification MUST revert the host with `git reset --hard` to its exact pre-merge commit before entering the repair loop. A genuine merge conflict MUST abort before it touches the host working tree and creates one bounded `harness.conflict/v1` support request limited to the conflicting paths, sourced via `git show` against the conflict's merge-base/host/branch commits — never a generic repair attempt. The integration branch is deleted only after a successful merge and verification; the merge commit itself remains in the host's log regardless.
- Only the short host merge+verification phase is serialized per canonical project. This internal Git plumbing is Wharness's own execution engine mutating the host it already owns — analogous to Apply writing files without per-file approval — and is a distinct authority from a model-requested `git` command inside a plan's own operations, which still requires explicit user approval per the Git workspace invariant's mutation rule.

## Request-base-rooted integration invariant (v1.3.2, completing ADR-0029 — see `adr/ADR-0035`)

- Every planner request MUST record the exact host tree its context was snapshotted from, as a real commit parented on the host's HEAD and anchored under `refs/wharnex/base/<request_id>`. Capture MUST NOT disturb the host's index, HEAD, current branch or working tree, MUST stage through a private temporary index, and MUST honour the project's own `.gitignore`. The anchor lives outside `refs/heads`/`refs/tags` so ordinary Git UX is unchanged. Capture and rooting are best effort: a repository with no commit, or any Git refusal, MUST degrade to the previous behavior rather than fail the user's request.
- A verified Protected candidate's integration branch MUST be rooted at its own request base, and the plan's patch applied to that tree — never to whatever the host has advanced to since the request was planned. Applying a patch to a tree it was not authored against is a dead end that no retry and no source patch can resolve, and it MUST NOT consume an automatic AI repair round.
- Whether two changes can be combined is decided by a real three-way merge, never by impact-file, line-range or column overlap. `impact_files` remains a scheduling forecast only. A dry-run merge (`git merge-tree`) MAY be used as an advisory preflight so a merge already known to be doomed never mutates the host; it MUST compare against the host's real current content including uncommitted state, MUST treat an unsupported Git as "unknown" rather than "clean", and MUST NOT replace the atomic merge as the authority.
- A `harness.conflict/v1` capsule MUST carry the intent of both colliding sides — the candidate's own planner-authored purpose, and the purpose of the already-integrated changes it collides with, taken from the commit messages the protocol already requires — plus the attempt number, its bound, and what earlier rounds of the same conflict already tried. Conflict resolution remains bounded; the history informs that bound rather than extending it.
- A compare-and-swap integration race that persists across every restage attempt MUST be escalated to the bounded focused-resolution path, scoped to the racing paths, and MUST NOT be reported as an indefinitely retryable condition: replaying the same candidate against the same host reproduces it forever. An unattributable race keeps its previous classification rather than becoming a conflict with nothing to resolve against.
- Per-project execution concurrency is an operator setting that defaults to one and MAY be changed at runtime. Lowering it MUST NOT interrupt work already running; the project admits nothing new until it drains under the new limit. Raising it MUST admit plans already waiting, not only later submissions. The ceiling MUST stay small because each concurrent runner claims a full container memory allowance and a complete project clone.
- A candidate reconciled from an immutable archived request base (no Git ancestry shared with the live host — see `SoT/SANDBOX_MODEL.md`) has nothing to branch or merge onto and MUST keep using the legacy canonical base/result `ChangeSet` materialized and integrated via per-file compare-and-swap and conditional rollback instead.
- Clean disjoint changes require no model turn. A true conflict, from either path, preserves unrelated verified mutations.
- Replaying an earlier pending candidate into a verification sandbox that shares no Git ancestry with the host (one rebuilt from an immutable archived request base) MUST NOT attempt a branch merge: git refuses unrelated histories, which is neither a conflict nor recoverable. Such a candidate is replayed as the diff of its own verified commit, or, if the host no longer holds that commit, as the plan's recorded patches.
- The only host-facing mutation in the verification phase is pushing the verified integration branch into the host's `.git`, and that alone is serialized per project. Per-project execution concurrency is an operator setting that defaults to one; raising it MUST NOT be treated as free, because each concurrent runner claims a full container memory allowance and a complete project clone.

## Host repository shape invariant (v1.3.3 — see `adr/ADR-0039`)

- The host project's repository shape is a **measurement, never an assumption**. Wharnex MUST resolve a repository's real Git directory before writing into it (`.git` is a file, not a directory, in a linked worktree and in a project root that is itself a submodule), and MUST derive its submodule inventory from the index rather than from `.gitmodules`.
- A host worktree's uncommitted state MUST be classified by what Git can actually capture, not by whether `git status` is non-empty. Dirty submodule content and untracked embedded repositories are reported as modified but are not capturable by a superproject commit; treating them as capturable is what made a dirty submodule block every host integration permanently.
- Preserving the operator's uncommitted work before an integration MUST succeed when there is nothing a superproject commit can hold. That is a normal outcome, not a failure.
- `git add -A` MUST NOT be allowed to record an untracked embedded repository as a gitlink in any Wharnex-authored commit (the pre-merge snapshot, the request base, the project baseline). Such a commit claims to preserve the operator's files while holding only an unresolvable pointer, so the revert built on it cannot restore them. Embedded repositories are excluded by pathspec and reported as left in place.
- Wharnex MUST refuse, not proceed, when the host holds unresolved paths or an in-progress merge/rebase/cherry-pick/am, and when an integration would move the recorded commit of a submodule holding uncommitted work. Refusal MUST be a typed condition carrying the reason, the paths and the operator action that clears it, classified `host_working_state_blocked`: the verified candidate is retained and no automatic repair round is consumed.
- Commits and merges Wharnex makes on a host repository are its own internal bookkeeping. They MUST use the fixed non-human identity, MUST disable signing, and MUST disable project hooks — a project's own `pre-commit` gate has no authority over Wharnex plumbing and MUST NOT be able to block host integration.
- A merge or revert that moves a submodule's recorded commit MUST realign that submodule's checkout, which Git deliberately does not do. Realignment MUST be offline (never fetch) and MUST NOT touch a submodule holding uncommitted work; every skip MUST be reported, because the superproject is then knowingly ahead of a checkout the operator must update.
- A `change` bundle whose patch writes inside a registered submodule MUST be rejected at ingestion, before Policy and sandbox verification. Such a path cannot be staged, committed or merged from the superproject, so the failure is structural rather than a source defect and no planner repair can resolve it. A project Wharnex cannot inspect MUST be admitted unchanged: a measurement failure MUST NEVER reject a legitimate change.
- A conflicting submodule pointer MUST NOT be handed to a planner. It is a commit id, not three versions of a file, and the resulting patch is rejected by the validator on arrival every round. It is partitioned out exactly like Wharnex-managed project state.
- `.git` MUST be excluded from context bundles and sandbox copies whether it is a directory or a file. A submodule's and a linked worktree's `.git` is a file holding an absolute path into the host's own repository metadata.

## Execution environment disclosure invariant (v1.3.1)

- Every planner request MUST carry a Wharness-measured `wharness.environment/v1` manifest describing the host machine, the Protected container's real limits, the runner image's own executable inventory, the policy engine's closed decision sets, and the protocol validator's numeric budgets. Policy and budget values MUST be read from the engine and validator rather than restated, so the published contract cannot drift from the enforced one.
- The manifest is descriptive only. It MUST NOT grant a capability or relax a check; policy, protocol validation and the runner remain the sole enforcement points. Measurement MUST be best-effort and time-bounded: an unavailable Docker daemon degrades the section to a warning and never delays or fails a request.
- The runner image MUST describe its own toolchain through a dedicated inventory entrypoint. Wharness MUST NOT maintain a parallel list of installed tools.
- An infrastructure or bookkeeping fault MUST NOT consume an automatic AI repair round, and MUST NOT discard a verified executable payload. Artifact archival and project-knowledge staging are auxiliary to a response bundle: their failure is recorded as a structured degradation event and ingestion continues.
- A repairable environment failure MUST name its root cause in the repair request. A missing executable is reported as such, never as raw command output that invites re-reading unrelated project source.

## Manual plan transport normalization

- Manual ChatGPT import may normalize only narrowly defined transport mistakes before strict protocol validation.
- It may repair unescaped source-code double quotes only inside a `patch` value that is clearly a supported patch dialect and is structurally followed by the operation `command` field.
- Never broaden this into a general "best effort" parser that invents operations, paths, commands, protocol values, or security-sensitive semantics.
- Every normalized plan MUST still pass `protocol.Validate` and the policy engine unchanged.

## 10. Project bootstrap and context configuration (v1.2.17)

- Desktop project selection MUST use a narrow native directory-picker IPC; remote ChatGPT content never receives this capability.
- Human project creation and Git clone are explicit bootstrap actions, separate from Agent execution. Git clone MUST use argv execution and `--recurse-submodules`; it MUST NOT accept option-like repository values or overwrite an existing destination.
- Every opened/created/cloned project MUST contain `whaness.yml`. When absent, Wharness creates a safe default before context capture.
- `whaness.yml` context include/exclude settings affect AI context assembly only. They MUST NOT weaken secret/path/symlink protections or silently expand Agent/terminal privileges.
- Automatic context pruning SHOULD remove dependencies, VCS/IDE metadata, caches, generated build/test output, temporary files, archives, binary/media assets, and generated Wharness context snapshots while retaining source/configuration files by default.

## 11. Host-independence / containerized tooling invariant (v1.2.45)

- Lifecycle, build, maintenance, and cleanup tasks (including `make build`,
  `make clean`, and any in-app administrative/cleanup feature) MUST run their
  actual work inside a container rather than depend on a tool being installed
  on the operator's host, even when that tool happens to be present.
- When a task genuinely needs a client/CLI that has no containerized
  equivalent already in the stack, add it to a project-owned tools image
  (or reuse an already-running service's own embedded binary, e.g. invoking
  `mc` inside the `minio` container itself) rather than shelling out to a
  host-installed binary. Creating a dedicated tools image is an acceptable
  and preferred cost for this.
- This exists to maximize portability across developer machines and CI: a
  host-dependent script silently breaks on any machine missing that
  particular tool version, while a containerized one behaves identically
  everywhere Docker runs.
- This does not apply to `docker`/`docker compose` themselves, or to
  editing files directly on the host filesystem — only to auxiliary CLIs a
  task would otherwise assume are present on `$PATH`.
- Narrow, explicit exception: a human-invoked `make build`/`make deps` runs
  `npm ci` for `services/frontend`/`services/desktop` directly on the host
  (containerizing that install is tracked separately, not yet done). Node
  version compatibility for that path MAY be self-healed by driving the
  operator's own already-installed `nvm`, never by installing nvm itself or
  mutating anything outside the operator's existing nvm-managed Node
  versions, and only ever as a fallback after the Node already on `PATH` is
  checked and found too old. This is deliberately host-side: nvm is
  inherently a per-user host tool with no meaningful containerized
  equivalent for *this* purpose (selecting which Node an interactive
  operator shell uses), unlike the auxiliary CLIs this section otherwise
  requires containerizing. A self-evolution build is unaffected either way:
  it runs `make build-stage` inside the backend's own container and is
  satisfied directly by that image's pinned Node.
- Context inspection MUST derive final inclusion from the current manifest/ZIP snapshot, expose structured exclusion reasons and effective rules, and never claim a file is included merely because its parent directory is eligible.
