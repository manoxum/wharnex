## v1.2.39 - Unified Agent workspace and activity drawer

- Replace the permanent Harness-chat/Agent-Inspector split with one end-to-end Agent surface whose top tabs switch between Chat, Plano, Execução and ChatGPT.
- Move Execute, verified Apply and Reject to compact icon-only actions in the unified Agent tab bar while preserving the existing policy/state gates and accessible descriptions.
- Add a JetBrains-inspired left activity rail: archived chats open in a dedicated drawer and a second Project action opens a searchable read-only project tree that hands selected files to the existing Editor flow.
- Convert workspace-topbar operational labels (self-evolution, Auto, host-direct and planner mode) into icon-only status affordances with tooltips/ARIA labels.
- Keep embedded Chat/Inspector chrome out of the unified surface, preserve chat and inspector state across tab switches, and suspend the native ChatGPT view whenever ChatGPT is not the visible Agent tab or a drawer overlays it.
- Harden chat auto-scroll for non-visual DOMs by feature-detecting `scrollIntoView`.
- Add focused frontend regressions for the unified tabs, icon-only Execute action, archived drawer, project explorer and topbar status icons.

## v1.2.38.1 - ChatGPT request rehydration and definitive auto-binding

- Add a bounded ChatGPT request-liveness recovery state machine for active expected bundles: recoverable socket/network and renderer failures re-hydrate the owned page, while silent or stalled processing reloads once and then emits at most one same-request recovery prompt if the request still does not resume.
- Reload once when ChatGPT appears to have completed a response but the expected validated bundle is still absent, before falling back to the existing delivery-continuation prompt.
- Wait for a concrete `chatgpt.com/c/...` URL to be stable and fully loaded after submission, publish that definitive affinity candidate from the Desktop main process, and persist/confirm it from the application controller even when the ChatGPT inspector pane is not mounted.
- Keep recovery bounded and project-safe: no lifecycle commands, no arbitrary assistant-prose scraping, no cross-chat renderer access, and no infinite reload/prompt loop.
- Add Desktop recovery/affinity regressions plus a frontend regression proving candidate persistence is independent of inspector visibility.

## v1.2.38 - Multi-window and bound multi-project workspaces

- Allow Agent and Editor users to open additional independent Wharness desktop windows while keeping a per-window project ownership registry that rejects the same canonical project path in two windows at once and focuses the existing owner.
- Add a persistent top-level workspace shell with **Bind projecto**, fast project switching and one mounted same-origin project frame per binding, so Agent/Editor state, running requests, page state and project-local UI remain alive while another project is selected.
- Scope embedded ChatGPT `WebContentsView` ownership, visibility, bounds and IPC delivery to the desktop window that owns the project/chat, preserving the dedicated-view-per-chat security invariant across multiple windows.
- Persist window identities, bound-project sets and the active project across restart; keep each project renderer mounted during switching so its live page/Agent/Editor state remains intact, and extend self-evolution activation with **Todas agora**, **Apenas esta**, and **Mais tarde** choices.
- Add Desktop regression coverage for window-scoped ChatGPT ownership and the project/window IPC surface.

## v1.2.37.1 - Single-shot successful execution

- Make successful plan execution idempotent across Wharness restarts: once a `plan_id` has a recorded successful sandbox/direct execution or appears in verified/applied history, the backend refuses to execute that same plan again.
- Keep persisted plan/policy/result objects as audit history after self-evolution restart reconciliation without treating them as an actionable task.
- Hide the Inspector Execute action outside actionable `planned`/retryable `failed` states, including `verified`, `restart_pending`, `restart_scheduled` and `applied`.
- Emit an explicit `execution.duplicate_blocked` audit event when a stale/manual caller still attempts the completed plan, and show that protection in the execution timeline.
- Correct manual execution regression fixtures so they do not auto-run once before explicitly calling Execute, while adding dedicated Auto and self-evolution single-shot regressions.

## v1.2.37 - Application-owned dialog system

- Replace every frontend `window.alert`, `window.confirm` and `window.prompt` flow with a unified Wharness-owned modal layer for information, confirmation and text input.
- Give confirmations explicit semantic tones and action labels, polished responsive styling, keyboard/focus handling and overlay-blocker semantics so critical actions remain clear without browser-native chrome.
- Move Explorer create/rename input into validated application modals and keep destructive file, terminal-host, execution-mode, Apply/reject/revert and browser-session operations behind explicit Wharness confirmations.
- Make native browser dialog APIs a prohibited UI pattern in `SoT/UI_UX.md` and enforce the rule in ESLint so future regressions fail the normal lint gate.
- Add focused modal regressions covering confirmation, prompt validation and informational notices.

## v1.2.36.1 - Composer mode selected palette

- Replace the harsh generic dark/lime selected treatment on the composer mode choices with quieter semantic palettes designed for the light composer surface.
- Give Protected a cool blue selected state and Manual a warm amber state; align Unprotected to restrained red and Auto to soft green so all four choices remain visually distinct and coherent.
- Preserve the existing icons, tooltips, `aria-pressed` state and safety behaviour; this is a visual refinement only.
- Add a focused CSS regression covering the selected-state palette contract.

## v1.2.36 - Composer execution mode icons

- Move the Protected/Unprotected and Manual/Auto project choices out of the workspace top bar and into compact icon groups in the Wharness chat composer action rail.
- Keep current execution and automation state visible through selected icon states and tooltips while preserving the existing HOST DIRETO/AUTO status pills in the top bar.
- Preserve safety semantics: self-evolution keeps Unprotected disabled, Auto still forces Protected, and the existing mode-change confirmations/notices remain owned by the application controller.
- Add focused frontend regressions for composer mode placement, callbacks and self-evolution locking.

## v1.2.35 - Auto self-evolution execution gate fix

- Keep normal project-defined build/test/runtime commands (`node`, `npm test`, `npx`, `make`) medium-risk and observable without turning them into an implicit per-plan approval gate; in Protected Auto they execute only inside the sandbox and therefore no longer stall valid self-evolution changes at `planned`.
- Preserve explicit approval for planner-requested approval, network access, package mutation such as `npm install`, Git mutation and high-risk plans.
- Make the remaining Auto approval stop explicit through `auto_error`/`automation.approval_required` instead of silently importing a valid bundle without explaining why execution did not start.
- Add a full self-evolution regression proving that Auto performs sandbox verification, host Apply and host build, reaching only the intentional `restart_pending` activation confirmation when a change uses a normal project verification command.

## v1.2.34.4 - Composer send right inset

- Keep the send action deterministically anchored at the far-right composer rail while adding an 8px inner inset so the icon no longer sits flush against the composer edge.
- Preserve the existing absolute positioning, toolbar independence and 40px reserved rail; only the visual breathing room at the right edge changes.
- Update the focused composer CSS regression to assert the final effective `right: 8px` anchor.

## v1.2.34.3 - Visible ChatGPT affinity rebind hotfix

- Allow the explicit **Vincular esta** action to replace an existing ChatGPT conversation affinity when the requested conversation is exactly the concrete conversation currently visible in that chat's owned renderer.
- Keep silent or stale rebinding fail-closed: confirmations without a matching active candidate still conflict unless the renderer itself is visibly on the requested conversation.
- Add focused affinity and Desktop IPC regression coverage for the visible-conversation rebind path.

## v1.2.34.2 - Deterministic composer send anchor

- Fix the actual cascade/layout failure that can keep the send action immediately after the left control cluster: the footer retained a legacy `justify-content: space-between` after becoming a grid, so its implicit content track may remain narrower than the composer.
- Make the footer a full-width positioning context, reserve the send rail, and anchor the send button absolutely at `right: 0` so its horizontal position no longer depends on toolbar/grid intrinsic sizing.
- Keep the existing composer controls and send behavior unchanged, while strengthening the CSS regression to assert the final effective footer, toolbar and send rules.

## v1.2.34.1 - Composer send edge alignment

- Remove the residual right padding from the pinned composer footer so the send button sits flush against the far-right internal edge as required by the UI/UX contract.
- Preserve breathing room for the helper hint independently and add a focused CSS regression test for the alignment.

## v1.2.34 - Batched pending self-evolution

- Replace the single pending self-evolution deadlock with one atomic pending batch: after a verified host build reaches `restart_pending`, additional verified Wharness changes may extend the same transaction without restarting first.
- Keep the original source/runtime/lifecycle rollback baseline for the whole batch while snapshotting newly touched paths only once, so a later failure rolls the complete pending batch back to the runtime that is actually running.
- Add a short-lived stage lock on top of the durable batch lock so Apply/build/revert/restart transitions stay serialized while the idle `restart_pending` state remains extendable.
- Persist every session/plan participating in the batch, allowing any member to confirm activation and keeping all participating sessions synchronized through restart, rollback and reconciliation.
- Retain completed transaction metadata until the restarted backend reconciles all batch members, then clean it up; the detached supervisor also clears both batch/stage locks.
- Clarify the restart dialog that choosing Later can safely accumulate more verified changes into the same pending activation.
- Track pending activation independently from the current chat task, so choosing Later releases the request queue for additional work while the restart control remains available even after that session advances to a newer request.
- Keep the durable batch lock on a failed restart handoff so the same baseline can be retried or safely extended instead of accidentally starting a second rollback universe.

## v1.2.33 - Dedicated ChatGPT renderer per Harness chat

- Give every live Harness chat its own owned ChatGPT `WebContentsView`/`webContents` instance instead of treating the active remote surface as a reusable renderer.
- Key state, bounds, navigation, history, reload, focus, clipboard and allowlisted DOM transport operations by Harness chat id and reject ownership mismatches before remote interaction.
- Keep the persistent ChatGPT partition shared only for authenticated browser-session state, so login remains reusable without sharing DOM/composer/page renderer state between chats.
- Stop silent remote-view eviction/reassignment; permanent local chat deletion explicitly destroys that chat's renderer, while process restart recreates renderers from stored per-chat conversation affinity.
- Ignore stale renderer state events from non-owning chats in the active ChatGPT pane and add regression coverage for per-chat renderer ownership and keyed IPC.
- Correlate intercepted plan/bundle downloads back to the owning chat and make the frontend ignore unowned download/state events, preventing a background ChatGPT instance from feeding artifacts into whichever Harness chat is currently visible.

## v1.2.32 - Auto-growing composer action rail

- Grow the Wharness chat composer automatically as multiline text expands, up to the existing bounded maximum, while retaining bounded manual resize and per-chat height persistence.
- Keep the composer action/footer rail outside the scrolling text region so artefact, attachment, Plan-first, queue, TODO and send controls remain visible when long prompts overflow.
- Anchor the send button flush to the right edge of the composer action row and add focused regressions for action visibility and multiline growth.

## v1.2.31 - Readable workspace, execution timeline and safe regression

- Recalibrate the visible 100% typography baseline for readability, expand UI scaling to 80%-160%, and apply the shared scale to previously fixed small interface text while retaining Inter/Manrope + JetBrains Mono defaults.
- Rework the chat composer into one resizable scroll surface with roomier text, Portuguese Chromium spell checking, right-aligned submit control and per-chat draft/height persistence across Agent/Editor mode switches.
- Correlate command stdout/stderr/completion into one execution item, collapse details by default while opening the newest five, follow the active tail, and show execution timestamp, duration and running animation. Host patch Apply/revert and self-evolution build phases now appear in the same timeline.
- Add post-Apply change summary cards with per-file +/- counts, focused unified-diff inspection, Editor navigation and deterministic reverse-patch regression for the current Protected patch-only plan.
- Hide the native embedded ChatGPT view whenever trusted Wharness modals, dialogs, menus or popups are present so `WebContentsView` can no longer paint over them.
- Make same-task ChatGPT comments single-flight and idempotent across timer/immediate flush races, with short semantic duplicate suppression to prevent accidental repeated guidance.

## v1.2.30 - Request queue and resilient ChatGPT delivery

- Introduce a per-chat main-request queue: Enter always creates the next main request and waits until the active request plus workflow/repair continuations are terminal; Ctrl+Enter sends an immediate same-request comment while work is in flight.
- Add queue controls to promote a waiting request into a live comment, reorder entries, edit text, remove entries and merge adjacent requests, while clearing the composer immediately on submit.
- Move TODO progress into a dedicated composer task surface that tracks the latest checklist snapshot instead of rendering implementation checklists as loose transcript content.
- Make iteration artifact icons actionable: context, prompt, execution result and error evidence open in a focused inspector, and refine Wharness operational notices into calmer semantic cards.
- Right-align the composer send affordance and make the active-request keyboard contract explicit in the helper text.
- Give generic clipboard screenshots unique local filenames so multiple image.png captures can coexist in one ChatGPT-bound request.
- Broaden canonical bundle DOM discovery to nearby file-card metadata and add completion-aware delivery continuations when ChatGPT finishes a turn without exposing the required bundle; validated download remains authoritative.
- Allow queued task comments to carry user attachments and preserve multiple rapid comments instead of overwriting the previous pending comment.

## v1.2.29 - Incremental compiled-artifact cache

- Add per-component build fingerprints for backend, frontend and desktop so `make build` reuses successful compiled artifacts when their exact source/config/runtime inputs are unchanged.
- Skip the complete Vite production pass on frontend cache hits, avoiding repeated transformation of Monaco Editor's large ESM graph during backend-only, desktop-only or no-change rebuilds.
- Reuse a previously successful pre-v1.2.29 build on first adoption when the global build-success stamp proves no relevant component input changed afterwards.
- Keep fail-closed lifecycle semantics: the active build-success stamp is removed while a build is in progress, component stamps are written only after successful commands, and missing outputs always force recompilation.
- Add `make build-status` for artifact-cache diagnostics and `make build-refresh` to force recompilation without discarding dependency caches.

## v1.2.28 - Fast deterministic rebuilds

- Replace unconditional `go mod download` / `npm install` work in every `make build` with dependency fingerprints stored under `.harness/cache/dependencies`.
- Skip npm entirely when `package.json`, `package-lock.json`, runtime versions and the validated local install have not changed; safely adopt a recent npm hidden lock on the first build after upgrade.
- Use deterministic `npm ci --prefer-offline --no-audit --no-fund` only on real dependency invalidation, reusing the existing Wharness npm content cache without contacting audit/funding endpoints.
- Build backend, frontend and desktop concurrently with a conservative default of two jobs while preserving fail-fast build stamps and the Docker-free application lifecycle.
- Add `make deps-status` for cache diagnostics and `make deps-refresh` as an explicit recovery path when operators intentionally want dependency re-hydration.

## v1.2.27 - Calm composer, plan-first turns and Git-aware execution

- Refine the Wharness composer into a clean bottom action rail with small circular artefact controls, file attachment and a Plan-first toggle embedded inside the writing surface.
- Separate transcript semantics into user, ChatGPT and Wharness sources; operational lifecycle notices and visible ChatGPT activity use dedicated notification/thought surfaces instead of masquerading as normal chat messages.
- Add Plan-first requests: the first ChatGPT turn is proposal-only, Wharness rejects executable bundles for that request, presents the proposal with approve/reject controls, and creates a separate implementation request only after explicit approval.
- Require every ChatGPT CHANGE deliverable to expose a user-visible `## TODO` checklist so implementation progress is traceable in the transcript.
- Allow task comments from the composer while ChatGPT is processing; comments stay bound to the same request/conversation and explicitly preserve the original canonical bundle deliverable.
- Capture only reasoning/status content visibly exposed by the ChatGPT UI and render it as transient thought/activity, without accessing hidden model reasoning, cookies, storage or arbitrary response prose.
- Add policy-aware Git CHANGE support for read-only inspection plus approved mutations such as add/commit/branch/switch/merge/rebase/revert/restore/tag/stash and network-declared fetch/pull/push; destructive/force operations remain denied.
- Preserve real Git history and current working-tree state in Protected sandboxes through a hook-free local clone; only credential-free HTTPS remote URLs are reconstructed, and Protected push is exercised as `--dry-run` before any approved host replay.
- Interleave streamed stdout/stderr directly below the command event that produced it in the Execution timeline instead of collecting output in a detached final log card.

## v1.2.26 - Composer artifacts, durable iterations and confirmed self-restart

- Move ChatGPT transport controls out of the ChatGPT header and into compact artifact selectors embedded directly in the Wharness chat composer for Context ZIP, Prompt, Result, Error and user files.
- Automatically select context when another Harness chat changes the project snapshot, and select result/error evidence after executions or repair paths while keeping the user able to toggle non-required artifacts.
- Persist execution events per Harness chat so reopening Wharness or switching chats restores the execution history instead of resetting the execution tab.
- Persist a Wharness-side iteration reference with request id, phase, ChatGPT conversation and attached artifact kinds for outbound, workflow, repair and result turns.
- Collapse authenticated ChatGPT state to a single compact status icon, remove the manual ZIP/prompt/result action cards and retire the Desktop manual fallback panel.
- Change transactional self-evolution so a verified host build stops at restart-pending and requires explicit user confirmation; choosing Later leaves a restart badge visible and keeps rollback state available.
- Add local typography settings with an elegant 110% default, selectable UI/monospace font stacks and a 90%-130% interface scale.
- Add regression coverage for composer artifact placement, execution-history persistence, compact ChatGPT auth UI, typography preferences and restart-confirmation transaction recovery.

## v1.2.25 - Chat affinity, recoverable archive and live execution logs

- Arm first-conversation affinity as soon as the trusted ChatGPT new-chat surface is observed, including while it is still loading, then wait longer for the post-submit `/c/...` transition before finalizing the binding.
- Keep ChatGPT conversation affinity one-to-one: a concrete conversation already owned by another Harness chat is rejected instead of being silently duplicated.
- Replace destructive close-on-X with a recoverable local archive. Archived chats preserve transcript, ChatGPT binding and durable attachments; the archive area can reopen them or perform explicit confirmed permanent deletion.
- Stream command stdout/stderr chunks from Local, Docker and Host runners through SSE `command.output` events while operations are executing.
- Redesign the Agent execution tab as a compact event timeline followed by a live aggregated log console, with the inspector as the single vertical scrolling surface instead of per-operation nested output scrolls.
- Add regression coverage for first-chat binding while loading, archive/restore/permanent-delete semantics, live runner output and the execution log UI.

## v1.2.24.1 - Immutable Linux Electron runtime

- Move the Linux Electron execution binary and its SUID `chrome-sandbox` out of npm-managed `node_modules` into a versioned root-owned runtime under `/opt/wharness/electron/<version>-linux-<arch>/`.
- Make the complete runtime root-owned and non-user-writable, keep `chrome-sandbox` at `root:root` mode `4755`, and verify the Electron/helper SHA-256 values from a root-owned runtime manifest before every launch.
- Resolve the exact current Electron version/architecture at startup and pass its immutable absolute binary to the desktop coordinator, so `npm install`, `npm ci`, `make build`, worktree changes and dependency cleanup cannot reset sandbox permissions.
- Keep user namespaces only as a verified fallback, continue to forbid `--no-sandbox`, remove the obsolete standalone helper during runtime installation, and retain the old `electron-sandbox-*` Make targets only as compatibility aliases.
- Route `make start`, `make run-desktop`, `npm run dev` and `npm start` through the same runtime resolver so no supported desktop launch path falls back to `electron .` from `node_modules`.
- Add regression coverage proving the desktop honors an absolute immutable runtime binary and lifecycle checks preventing privileged in-place `node_modules` sandbox configuration from returning.

## v1.2.24 - Network-stable Docker lifecycle

- Decouple `make build` from the Docker runner so normal `make build && make start` never contacts or socket-activates the Docker daemon.
- Move Docker CLI/runtime prerequisites to the explicit `make build-runner` path and add `make build-all` for operators who intentionally want the application and runner together.
- Stop Dockerfile-only changes from invalidating the desktop application build stamp now that the runner has an independent lifecycle.
- Refuse Linux systemd Docker socket activation before Protected execution or runner construction when `docker.service` is stopped but `docker.socket` is listening, preventing Wharness from implicitly rebuilding host bridges/routes/veth devices mid-session.
- Add lifecycle regression checks plus backend unit coverage for the socket-activation policy.

## v1.2.23.2 - Electron packaged SUID sandbox correction

- Fix Linux Electron startup after v1.2.23.1 incorrectly treated a valid persistent helper as sufficient even though packaged Electron continued validating its adjacent `node_modules/electron/dist/chrome-sandbox`.
- Treat only the Electron-packaged helper as a valid SUID launch path and stop exporting `CHROME_DEVEL_SANDBOX` from the Wharness lifecycle.
- Add `make electron-sandbox-install` to configure the exact Electron helper as `root:root` mode `4755`, plus a recovery-copy restore target and metadata-rich diagnostics.
- Preserve the secure user-namespace fallback and continue to forbid `--no-sandbox`.

# Changelog

## v1.2.23.1 — Secure Linux Electron sandbox startup hotfix

- Detect the Linux Electron sandbox capability before startup instead of letting Chromium abort with an opaque `chrome-sandbox` SUID fatal error.
- Prefer a persistent root-owned mode-4755 helper outside `node_modules`, and verify that it is byte-identical to the helper shipped by the installed Electron version so npm reinstalls cannot silently invalidate startup.
- When a privileged helper is unavailable, probe unprivileged user namespaces and use only `--disable-setuid-sandbox` when that sandbox path is actually usable; never fall back to `--no-sandbox`.
- Fail closed with actionable installation commands when neither secure Linux sandbox path is available, and expose `make electron-sandbox-check` for diagnostics.

## v1.2.23 — Transactional self-evolution

- Detect when a managed project resolves to the exact root of the currently running Wharness instance and mark the session as self-evolution.
- Force self-evolution sessions to Protected execution and prevent later Unprotected switching.
- After sandbox verification, snapshot patch-touched source files and known-good runtime artifacts before applying the patch to the live Wharness root.
- Rebuild the real host with deterministic npm installs, reject unexpected dependency-metadata mutation, and rollback immediately if host Apply/build fails.
- Hand restart to a detached supervisor so the process being upgraded does not own its own termination/recovery path; health-check the new runtime and automatically restore/restart the previous version on failure.
- Reserve `.harness/**` as runtime-owned recovery state, persist self-evolution lifecycle status/logs, surface the mode in the workspace UI, and teach the planner not to emit Wharness lifecycle commands.

## v1.2.21.1 — Bundle download fallback + rendered Harness Markdown

- Harden automatic ChatGPT result capture when generated files are rendered without their canonical filename: exact filename metadata remains preferred, with a fail-closed fallback to exactly one visible file/download affordance in the newest assistant turn.
- Include href/download/accessibility metadata in the narrow download-control matcher without scraping assistant prose or weakening post-download request/bundle validation.
- Strengthen the manual planner contract so generated bundle basename, attachment metadata and visible label use the exact canonical `wharness-bundle-<request_id>.zip` and reject icon-only substitutes.
- Render Harness/agent transcript responses as sanitized GitHub-flavoured Markdown while preserving user messages as literal text.
- Add regression coverage for exact-vs-icon-only download selection, ambiguous fallback rejection, and Markdown headings/emphasis in Harness responses.

## v1.2.22 — Persistent managed Chrome account + personal Chrome shortcut

- Keep the real-browser OAuth callback profile under Wharness `userData` instead of deleting a fresh temporary Chrome profile after every login, so the Google account and ChatGPT session can be reused on subsequent external authentications.
- Keep callback automation isolated from the user's personal/default Chrome profile; Chrome 136+ intentionally blocks remote-debugging against that profile, so Wharness does not bypass the browser's credential protections.
- Add a visible **Chrome pessoal** action that opens the normal system browser with its already-active profile/session for manual use, while clearly keeping it separate from the callback-capable managed profile.
- Serialize callback-capable external authentication across chats because the persistent managed profile is shared.
- Make **Limpar sessão do navegador** and full Wharness reset delete both the embedded Electron browser state and the persistent managed-browser auth profile; storage metrics include both browser stores.
- Add regression tests for the persistent profile location and the personal-Chrome shortcut.

## v1.2.21 — Export provenance + Git/runtime diagnostics

- Add a generated root `EXPORTS.md` to `make export` archives with export provenance, project metadata, current Git branch/HEAD, `git status --short --branch --untracked-files=all`, and `git worktree list --porcelain`.
- Capture Wharness runtime diagnostics in `make export`: current `scripts/status.sh` output plus a bounded tail of `.harness/logs/desktop.log`, with secret-like values redacted and collection failures represented as warnings instead of aborting the export.
- Keep `.git` internals and Git remote URLs out of exports while preserving enough repository state for offline analysis.
- Add the same synthetic `EXPORTS.md` to every Wharness-managed context ZIP/text export without writing it into the managed project.
- Include deterministic Git/export metadata in the context fingerprint so branch/index/worktree changes invalidate smart-context affinity when analytically relevant.
- Harden `make export-check` and backend tests to verify metadata presence and Git-state capture.

## v1.2.21 — Real-browser OAuth callback relay

- Replace the v1.2.20 detached Electron auth `BrowserWindow` with a real installed Chrome/Chromium/Brave process using a unique temporary Wharness profile.
- Bind Chrome DevTools only to loopback, always restart auth from `https://chatgpt.com/auth/login`, and never forward an in-flight OAuth provider URL between browser contexts.
- Detect an authenticated ChatGPT callback in the managed browser, relay only non-Cloudflare `chatgpt.com` cookies directly in the main process to `persist:wharness-chatgpt`, then close/delete the temporary browser profile and reload the embedded ChatGPT view.
- Automatically promote Google OAuth out of Embedded mode because Google rejects embedded user-agents instead of attempting unsafe browser spoofing.
- Add auth-error IPC/UX and fix the frontend race that cleared the external-auth banner before its controls rendered.
- Add managed-browser/cookie-relay regression tests.

## v1.2.20 — Dual ChatGPT authentication + same-session callback

- Add explicit **Login incorporado** and **Login externo** modes to the ChatGPT panel.
- Keep embedded OAuth entirely inside the sandboxed ChatGPT `WebContentsView` when the user selects it.
- Replace the broken system-browser handoff of in-flight OAuth URLs with a fresh `chatgpt.com/auth/login` flow in a separate Wharness-owned sandboxed auth window sharing the same persistent ChatGPT partition.
- Detect the external-window callback only from top-level return to non-auth `chatgpt.com`, then close the auth window and reload the embedded view without reading or copying cookies/tokens.
- Keep the operating-system browser button as a clearly isolated manual fallback with no callback claim.
- Add security/regression tests for auth URL classification, strict auth modes, shared-partition external login, and prevention of provider-URL forwarding.

## v1.2.19 — Intent-first ASK and bounded iterative workflows

- Reframe the planner as a project copilot instead of a coding-first agent: ASK/advice/recommendation requests now explicitly prefer direct `answer` outcomes, while only explicit mutation intent becomes `change`.
- Add `workflow` to `harness.turn/v1` for non-terminal local evidence gathering without converting diagnostics into code changes.
- Execute workflow plans only as command-only, network-disabled probes in disposable Protected sandboxes; patches, host Apply and host-approval semantics are forbidden.
- Feed structured stdout/stderr/exit observations back into a fresh request in the same planner/ChatGPT conversation and repeat for at most six rounds before requiring a terminal result.
- Automatically submit workflow continuations through the existing file-first, upload-confirmed ChatGPT transport and preserve smart context affinity by conversation URL + project SHA.
- Keep workflow failures as reasoning evidence rather than entering the automatic change-repair loop; a terminal provider change still follows the normal Policy -> sandbox -> verify -> Apply path.
- Make Agent Inspector distinguish local workflow probes from change plans and prevent workflow plans from exposing manual Execute/Apply controls.
- Define an MCP-ready adapter boundary without adding an unnecessary runtime dependency: future MCP capabilities must remain behind Wharness Policy, containment and sandbox ports.

## v1.2.18.3 — Frontend test isolation hotfix

- Register one explicit Vitest setup file that cleans React Testing Library renders after every frontend test.
- Prevent DOM from prior test cases leaking into later `screen.*` queries and producing false duplicate-element failures in `ChatPanel` and `ContextInspector`.
- Keep production behaviour unchanged; this patch only hardens the frontend quality gate.

## v1.2.18.2 — Chat UX, smart project context and safe defaults

- Add copy controls and visible date/time metadata to every Harness transcript message, with safe migration for legacy stored items.
- Start every opened/restored project in Agent + Protected + Auto, while preserving the invariant that Unprotected cannot coexist with Auto.
- Replace the ChatGPT helper strip with compact action cards for project context, current prompt and expected result; context/prompt can be copied or explicitly sent to the currently open ChatGPT conversation.
- Track the last project-context SHA and ChatGPT conversation URL per Harness chat: attach a fresh context ZIP on the first turn, on a newly opened ChatGPT conversation, or after the project snapshot changes; omit duplicate ZIPs on unchanged sequential turns.
- Treat an explicit Harness send while another ChatGPT conversation is visibly open as an intentional rebind and refresh context without weakening the existing allowlisted DOM transport.
- Prevent the project Rules inspector from crashing on legacy/null collection payloads and make backend context inspection serialize empty roots, entries and rule patterns as arrays.

## v1.2.18.1 — Project settings storage test hotfix

- Align the `ProjectSettings` unit-test API mock with the v1.2.18 storage metrics calls so the frontend quality gate no longer fails with `api.storage is not a function`.
- Keep the fix test-only; production storage behaviour introduced by v1.2.18 is unchanged.

## v1.2.18 — Auto repair, background ChatGPT transport and local-data controls

- Surface Policy denial reasons as non-executed events and automatically enter the bounded Auto repair loop without weakening Policy.
- Add a narrow allowlisted ChatGPT DOM bridge for background composer fill/submit and exact expected bundle-download activation; canonical download and bundle validation remain authoritative.
- Add opaque export/import and explicit clearing of the embedded ChatGPT browser session.
- Add complete Wharness data reset with `APAGAR WHARNESS` confirmation while preserving real project directories and files.
- Add disk-consumption metrics for Wharness-owned browser data, attachments, contexts/sandboxes, temporary data and per-project state.
- Route repair/status transcript messages back to the originating Harness chat even when that chat is in the background.

## v1.2.17.5.3 — ChatGPT composer reference hotfix

- Confirm `preparePromptForChatGPT` uses the background `targetChatGPTComposer` helper after the transport refactor removed `focusChatGPTComposer`.
- Add a Desktop regression test that prevents the stale helper reference from returning in the prepare-prompt path.
- No production source rewrite is required in snapshots where the helper call is already corrected; rebuild/restart is sufficient to load the fixed Desktop process.

## v1.2.17.5.2 — Background repair transport build hotfix

- Remove the stale `setChatgptFocusNonce` call from automatic repair submission after the focus-nonce state was intentionally removed by v1.2.17.5.
- Keep repair prompt delivery on the background ChatGPT bridge without switching the visible Inspector tab or requesting remote WebContents focus.
- Restore the frontend TypeScript/Vite build after the background-transport refactor.
- Make `npm run typecheck` use TypeScript project-reference build mode so it checks `tsconfig.app.json`/`src` instead of succeeding against the empty root `tsconfig.json`.

## v1.2.17.5.1 — Frontend test isolation hotfix

- Explicitly clean up `ChatGPTDesktopPane` test renders between Vitest cases so prior DOM/native-view effects cannot leak into the next assertion.
- Scope the canonical bundle filename assertion to the download step instead of querying the whole document, where the same filename is intentionally repeated in fallback guidance.
- Prevent the failed assertion path from leaving React work scheduled past jsdom teardown and emitting a misleading `window is not defined` unhandled error.

## v1.2.17.5 — Bundle contract hardening and background ChatGPT transport

- Harden manual planner output to one exact `wharness-bundle-<request_id>.zip` attachment with root-layout/self-check rules and no visible prose.
- Bind Desktop downloads to the pending request so generic ChatGPT ZIP names are safely normalized to the canonical filename while mismatched Wharness request ids remain rejected.
- Add narrow non-executable bundle compatibility normalization for one wrapper folder, missing README documentation, and root-level referenced patch files.
- Stop automatic prompt/upload/submit transport from switching the Inspector to ChatGPT or explicitly focusing the remote WebContents.

## Unreleased — v1.2.17.3 ChatGPT overlay suspension hotfix

- Removes the unconditional native ChatGPT `show()` performed during pane bootstrap. Visibility is now controlled only by the dedicated `suspended`/chat effect, so a trusted Wharness modal cannot race with an initial WebContentsView show.
- Restores the overlay regression test expectation: mounting `ChatGPTDesktopPane` already suspended must call `hide()` without any preceding `show()`, then show exactly when suspension is lifted.

## Unreleased — v1.2.17.2 project recovery + IDE Explorer + terminal policy

- Restored sessions self-heal a missing `whaness.yml` through the same validated default creation path used by newly opened projects; the settings dialog now exposes a retryable error state instead of remaining forever on “A carregar configuração…”.
- Project settings temporarily suspend the native ChatGPT `WebContentsView`, preventing remote content from painting above the Wharness modal.
- The Editor Explorer is now dark and IDE-oriented, with create file/folder, rename, recursive delete confirmation, path search/filter, refresh, collapse-all, copy path, context menu, F2/Delete shortcuts, active-file reveal, and file/folder counts.
- Explorer create/rename/delete operations are backend-enforced host mutations with project-root containment, excluded/secret path denial, symlink denial, and corresponding sandbox-copy mirroring when a devspace exists.
- The human interactive terminal now uses a dedicated Policy Engine profile instead of model-plan policy, allowing normal project-development argv commands while continuing to block shells, privilege escalation, container/host administration and inline-code evaluator flags. The UI adds command history (Up/Down) and Ctrl+L clear.
- CORS now advertises PATCH so Explorer rename works from the Vite renderer to the local backend.
- DOMPurify is pinned/overridden to 3.4.14 to remove the direct dependency audit finding exposed by 3.4.8; Monaco remains 0.56.0 until upstream publishes a newer stable release.

## Unreleased — Monaco 0.56 Vite worker export-map hotfix

- Uses Monaco 0.56 public package-export worker specifiers (`monaco-editor/editor/...` and `monaco-editor/language/...`) instead of legacy `monaco-editor/esm/vs/...` deep imports.
- Restores Vite 7/Rollup worker resolution for the editor, JSON, CSS, HTML and TypeScript workers without externalizing Monaco or weakening the bundle.

## Unreleased — React 19 / Monaco build hotfix

- Fixes the Monaco editor ref initialization for React 19 typings by using an explicit nullable ref.
- Uses Monaco 0.56-compatible hover and lightbulb option values instead of incompatible boolean/string literals.
- Clears the disposed editor ref back to `null`, matching its React ref contract.

## Unreleased — rendered plans + IDE editor + terminal targets

- Plan summaries and result README content now render sanitized GitHub-flavoured Markdown instead of displaying raw Markdown syntax.
- The Editor replaces the plain textarea with Monaco, adds multi-file tabs, per-file undo/view state, syntax-aware models, minimap, folding, bracket guides, sticky scroll, search/navigation shortcuts, breadcrumbs, cursor/language/encoding status and explicit save handling.
- The Editor file tree adds path filtering while preserving the existing backend file-policy boundary.
- The interactive terminal now defaults to `Sandbox` but allows an explicit human-only `Host` target after a dedicated confirmation; a persistent HOST warning remains visible while selected.
- Host terminal commands execute argv directly through the host runner and the same executable Policy Engine. Sandbox-only network/reset controls are unavailable in Host mode.
- Switching project/session always resets the interactive terminal to Sandbox so Host selection never leaks into a different project.
- Normative execution, sandbox, security and UI documents plus ADR-0008 record the Host-terminal exception and its guardrails.

## Unreleased — ChatGPT submit acknowledgement hotfix

- Auto mode emits the native Enter submit gesture exactly once after attachments settle; an observation timeout is now diagnostic instead of triggering repeated Enter presses.
- A ChatGPT network-observation miss no longer turns an already-dispatched prompt into a `prepare-prompt` IPC failure or causes the attachment draft to be repeatedly disturbed.
- Confirmed conversation POST observation is still logged when available, while file-first result download remains the authoritative completion signal.

## Unreleased — intent-aware agent turns

- Adds the structured `harness.turn/v1` envelope with answer, clarification, investigation, change, and blocked outcomes.
- Questions and non-mutating analysis now return their complete message to the Harness transcript without entering execution or Apply.
- Manual ChatGPT result bundles use `turn.json`; only change bundles include `plan.json` and patches. Legacy plan-only bundles remain compatible.
- Supported provider results bypass browser downloads, and provider change plans complete the Auto sandbox/verification/Apply pipeline directly.
- A new request supersedes older pending manual requests so delayed stale bundles cannot execute later in Auto mode.
- The embedded ChatGPT UI now states that the remote surface must initiate the result download; Wharness imports it automatically after it starts.
- The Plan inspector now tolerates legacy persisted plans whose empty operation or verification arrays were serialized as `null`; new plans are normalized to arrays before persistence.

## v1.2.14.2 — Definitive ChatGPT conversation binding

- New Harness Chats no longer adopt whichever `/c/...` conversation happens to be visible while the ChatGPT view initializes.
- An unbound Harness Chat is armed only after the trusted ChatGPT new-chat/home surface is observed; the first subsequent concrete `/c/<id>` URL becomes the automatic link.
- Returning to an unbound cached chat preserves the home DOM/draft when already on the new-chat surface, while a stale concrete conversation is reset to home before binding can arm.
- Existing linked chats keep explicit mismatch handling: `Vincular esta conversa` appears only when the current concrete conversation differs from the stored link.

## Unreleased — Harness chat attachments

- The Desktop Harness composer accepts up to 10 user-selected files (25 MiB each, 100 MiB total).
- `Ctrl+V` in the Harness composer now converts files from the native clipboard into attachments.
- Enter prepares the linked ChatGPT draft with the refreshed project context ZIP, selected files, and planner prompt.
- A separate “Confirmar e enviar” action emits Enter only after the user visually confirms the attachments in ChatGPT; Wharness does not inspect the remote DOM.
- In explicit project Auto mode, Desktop now submits the prepared ChatGPT prompt after a bounded attachment settle delay and waits for the validated bundle download event.
- Manual planner prompts now require the final visible response to contain only the downloadable bundle, with no descriptive text, Markdown, inline JSON, or patches.
- Harness chat attachments are now persisted in private Desktop application storage before submission; transcript entries keep durable opaque references so reload/restart restores the files with the conversation.
- Image files get persisted thumbnails when Electron can decode them; other file types fall back to the native OS file icon. Persisted attachment cards can be opened explicitly from chat history.

## v1.2.12.1 — Baseline diagnostic fingerprints

- Protected verification now compares structured TypeScript diagnostics when raw output differs only by runner/npm noise.
- Existing TypeScript failures are tolerated only when the post-patch diagnostic set contains no new error fingerprint.
- Unstructured verification failures keep the previous strict output comparison.

## v1.2.12 — durable agent state + differential verification + ChatGPT DOM cache

- Persiste sessões do backend em `.harness/state/sessions.json`, incluindo plano validado, policy, request ids pendentes, último prompt e último resultado de execução.
- Reiniciar `make stop` / `make start` deixa de apagar o plano/requisição do Harness Chat.
- Protected Mode compara um gate que falhou com uma sandbox pristine; uma falha preexistente só é tolerada quando exit code e diagnóstico permanecem idênticos.
- Regressões novas ou diagnósticos diferentes continuam a bloquear a execução.
- ChatGPT Desktop mantém até 20 `WebContentsView` vivos em LRU, um por Harness Chat, preservando o DOM em memória nas trocas de chat. O botão Reload continua a forçar refresh do chat ativo.

## 1.2.11 — Protected sandbox dependency hydration (2026-09-03)

### Fixed
- Protected Node.js verification no longer fails with `tsc: not found` merely because `node_modules` is excluded from the context/sandbox snapshot.
- `npm run`, `npm test`, `npm exec`, `npx`, and equivalent pnpm/yarn/bun script execution lazily hydrate local `node_modules` into the isolated workspace before the command runs.
- Missing host dependencies now produce an actionable `sandbox node dependencies unavailable` error instead of a misleading package-script exit 127.

### Security
- `node_modules` remains excluded from model context and the initial sandbox copy.
- Dependencies are copied into the temporary sandbox only when a local Node command needs them; the real project is never mounted into the container.
- Dependency symlinks are rewritten only when their targets stay inside the project tree; symlinks escaping the project are rejected.

## 1.2.9 — File-first planner delivery (2026-09-02)

### Added
- Manual ChatGPT planner responses are delivered as downloadable `wharness-plan-<request_id>.json` files.
- Electron intercepts only matching plan downloads from the embedded ChatGPT WebContentsView.
- Downloaded plan files are limited to 2 MiB, validated as JSON, checked for `harness.execution/v1`, and must match the request id encoded in the filename.
- Plan downloads are imported automatically into the Harness Chat owning the pending request and the Inspector switches to the Plan tab after successful validation.

### Changed
- The planner prompt requires the model to serialize the plan with a real JSON encoder instead of hand-writing JSON, preventing TSX/CSS quotes from corrupting transport.
- Clipboard/manual JSON remains available only as a fallback.
- Harness Chat deletion remains local: removing a chat closes its backend session and unlinks its ChatGPT URL without deleting the remote ChatGPT conversation.

### Security
- Non-Wharness downloads remain normal downloads and are not read by the harness.
- Temporary plan files are deleted after import.
- The backend remains authoritative for request correlation, protocol validation, policy evaluation and execution.

## v1.2.8.4

- Repair malformed manual-plan quotes in both `summary` and `patch` string fields before strict v1 validation.
- Harness Chat conversations can be removed from the UI with explicit confirmation. Removing a Harness Chat deletes its local history/session/link but does not delete the remote ChatGPT conversation.
- Deleting the active/last chat automatically selects another chat or creates a fresh one.


## v1.2.8 — Per-project Protected/Unprotected execution + patch diagnostics

- Adds a project-scoped Protected/Unprotected Agent execution switch directly in the workspace UI and persists it per project.
- Protected remains the default sandbox-first flow with a separate host Apply step.
- Unprotected executes validated/policy-approved Agent plan patches, commands, and verification directly in the real project after explicit per-execution confirmation; successful runs end in `applied`.
- Keeps the interactive Editor terminal sandboxed regardless of Agent execution mode.
- Propagates the project execution preference across multiple Harness chat sessions and restores it after reopen/backend restart.
- Replaces generic `git apply --check failed` failures with Git stderr diagnostics.
- Adds conservative patch retries using `git apply --recount` and checked `--3way` when blob index metadata is present; fallback mutation runs only after its check succeeds.
- Uses the same patch strategy for Protected sandbox execution, later host Apply, and Unprotected direct host execution.

## v1.2.7 — Resilient manual JSON patch transport

- Repairs the narrow, common ChatGPT transport failure where source-code double quotes inside an otherwise valid `patch` JSON string were not escaped.
- Repair is limited to `patch` values that clearly start with a supported patch dialect and are immediately followed by the operation `command` field; strict protocol validation and policy still run afterward.
- Accepts JSON wrapped in a Markdown `json` fence for manual import.
- Returns a clearer syntax error with the approximate byte offset when malformed JSON cannot be safely repaired.
- Strengthens the manual planner contract: every source-code quote inside the JSON `patch` string must be escaped as `\"`.

## v1.2.6 — Multi-chat + ChatGPT conversation affinity

- Adds multiple Harness chats per workspace with independent local histories and backend session IDs.
- Persists the active Harness chat and restores it after reload/reopen.
- Stores one ChatGPT conversation URL per Harness chat and automatically navigates the embedded ChatGPT view when chats are switched.
- New Harness chats start from the ChatGPT home/new-chat surface and automatically bind the first concrete `/c/...` conversation created for them.
- Prevents accidental silent rebinding: if the user manually opens a different ChatGPT conversation after a link already exists, the UI asks for an explicit “Vincular esta conversa” action.
- Adds a narrowly validated Desktop IPC navigation capability that accepts only trusted HTTPS `chatgpt.com` URLs.
- Migrates the legacy single-chat local transcript into the first multi-chat conversation.

## v1.2.5 — Git bootstrap + resilient manual plan import

- Automatically initializes a Git repository at every opened project root when `.git` is absent.
- Re-checks Git before host apply.
- Creates an isolated Git baseline inside every sandbox copy so `git diff`, `git diff --check`, and other allowed read-only Git verification commands work reliably.
- Requires `git` in root `make build` dependency checks.
- Normalizes the common manual ChatGPT alias `schema` -> `protocol`, fills conservative missing command defaults, accepts wrapped verification commands, and converts only the safe `*** Add File` patch dialect to a standard unified diff.
- Keeps strict validation/policy authoritative after normalization. Unsupported patch dialects remain rejected.
- Strengthens the manual planner prompt with the exact required JSON wire shape and standard `git apply` unified-diff requirement.

## v1.2.4 — ChatGPT clipboard permission

- Allow `clipboard-sanitized-write` only for the embedded `https://chatgpt.com` origin so ChatGPT's Copy button works in Electron.
- Keep `clipboard-read` denied to remote content; response import remains an explicit trusted Wharness action.
- Add allowlist regression coverage for clipboard permission origins.

## v1.2.3 — ChatGPT stream compatibility

- Presents the isolated ChatGPT session with a Chrome-compatible UA matching Electron 44 Chromium 152.
- Clears HTTP cache at Desktop startup without removing cookies/login state.
- Adds sanitized ChatGPT load/network/HTTP diagnostics to lifecycle logs.
- Keeps the remote surface sandboxed and does not read ChatGPT DOM or response content.


## 1.2.1 — Unified build/start/stop lifecycle (2026-09-02)

### Added
- Root `make build` installs dependencies, builds backend/frontend/desktop checks, and builds the Docker runner.
- Root `make start`, `make stop`, `make restart`, `make status`, and `make logs`.
- Runtime PID tracking under `.harness/run` and combined desktop logs under `.harness/logs`.
- Compiled backend runtime preference (`dist/bin/wharness-backend`) and built frontend preview preference.
- Linux Electron ozone selection with X11/XWayland preference and Wayland Vulkan fallback.

### Fixed
- Docker runner builds no longer depend on the caller being in the repository root.
- Electron launcher no longer inherits an incompatible automatic Wayland/Vulkan combination when XWayland is available.
- Coordinator shutdown terminates only the child process groups it created.

## 1.2.0 — Wharness Desktop / ChatGPT composition (2026-09-02)

### Added
- Electron `WebContentsView` desktop shell with ChatGPT in the same native window.
- Persistent isolated ChatGPT web session.
- Native copied-file context ZIP clipboard.
- Explicit context refresh API before desktop bundle copying.
- Desktop browser controls and state telemetry limited to URL/title/loading/navigation state.
- Clipboard JSON import.
- Desktop security tests and one-command development launcher.

### Security
- Remote ChatGPT renderer has no Node integration and no Wharness preload.
- IPC is sender-checked and capability-specific.
- Context bundle URL is derived in the main process from a local backend and validated session ID.
- Remote permissions are deny-by-default except notifications.
- No ChatGPT DOM/cookie/output extraction was introduced.


## 0.2.0 — Workspace IDE / Agent (2026-09-02)

### Added
- Editor / Agent mode switch.
- Workspace recovery after frontend reload and backend restart fallback.
- Recent workspace memory and per-project local chat history.
- Safe project Explorer.
- UTF-8 text editor with Ctrl+S and SHA-256 optimistic locking.
- Persistent per-session sandbox terminal with argv execution, optional network, and reset.
- ChatGPT/OpenAI provider tab.
- Context refresh before every Agent request.
- OpenAI context attachment on continued Responses conversations, deduplicated by snapshot hash.
- File API and terminal API endpoints.
- Security tests for traversal, symlink parent/file escape, executable-mode preservation, stale writes, and terminal shell denial.

### Changed
- Manual Bridge is now presented inside the ChatGPT tab.
- Agent planner message wording now distinguishes manual provider from automatic OpenAI provider.
- Frontend package version is 0.2.0.

### Deliberately excluded
- Consumer ChatGPT web iframe login inspection, prompt injection into the ChatGPT DOM, scraping, and automated Output extraction.

## 1.2.2 - External OAuth routing

- Route Google/Microsoft/Apple OAuth popups from the embedded ChatGPT surface to the system browser.
- Add an explicit Open in browser control to the ChatGPT toolbar.
- Keep Chrome/Electron cookie stores isolated; no browser-profile or cookie import is performed.

## v1.2.10 — Chat affinity canonicalization + file-first hardening

- Canonicaliza URLs `/c/<id>` antes de comparar o chat atual com o chat vinculado, ignorando trailing slash, query, fragment e subdomínio ChatGPT.
- O aviso “Está a visualizar outra conversa” só aparece depois da navegação estabilizar e apenas quando os IDs de conversa realmente diferem.
- Reforça o planner manual para criar um ficheiro real `wharness-plan-<request_id>.json` com a ferramenta de geração de ficheiros/Python e proíbe fallback inline.
- O importador manual passa a reparar também patches unified diff que começam diretamente em `--- a/...`, além de `diff --git`.

## v1.2.17 — Project Explorer bootstrap + smart context (2026-09-03)

### Added
- Native Desktop folder explorer for opening projects and selecting create/clone destinations.
- New-project creation with automatic Git initialization.
- Git clone bootstrap using `--recurse-submodules`, including nested submodules.
- Per-project `whaness.yml`, created automatically whenever missing.
- Workspace project-settings dialog for context auto-pruning, include/exclude patterns, and per-file size limits.
- Context recognition for IDE metadata, dependency caches, generated build/test output, temp files, binary/archive/media assets, and generated Wharness context snapshots.

### Security
- Folder selection is a sender-checked trusted-renderer IPC unavailable to remote ChatGPT content.
- Project context settings can narrow context but cannot override mandatory secret, symlink, VCS, or protected-path exclusions.
- Clone rejects option-like/unsafe destinations, never overwrites an existing directory, suppresses interactive credential prompts, and redacts the supplied repository string from Git errors.
