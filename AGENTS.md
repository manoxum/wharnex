# AGENTS.md — Wharness normative root

This file is normative. Any human or coding agent modifying Wharness MUST follow it.

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
- Consumer ChatGPT response scraping, login-cookie inspection, arbitrary DOM extraction, or automatic prose/output scraping MUST NOT be introduced. The Desktop MAY use a tightly allowlisted DOM bridge only to locate/focus the composer, write a prepared Wharness prompt, click submit, and click the download control for the exact expected `wharness-bundle-<request_id>.zip`; downloaded bytes still pass the normal strict bundle validator. Automatic planning otherwise uses supported provider adapters.
- ASK/advice is a first-class Agent outcome and MUST NOT be converted to a coding/change task merely because project context exists or Auto is enabled. A non-terminal `workflow` MAY gather missing local evidence, but it MUST be command-only, network-disabled, Protected-sandbox-only, never host-applied, and bounded to six rounds before a terminal result.
- Future MCP integration MUST be implemented as an adapter behind Wharness application/security ports. Remote consumer ChatGPT MUST NOT receive direct localhost MCP access that bypasses protocol validation, Policy, path containment, or Protected execution.
- Project/context exports MUST include synthetic `EXPORTS.md` provenance with safe Git status/worktree state; `.git` internals and remote URLs remain excluded, and managed-context metadata must not introduce volatile timestamp churn into the context fingerprint. The Wharness repository `make export` additionally MUST include bounded/redacted Wharness runtime status and recent desktop logs in `EXPORTS.md`; managed-project context bundles MUST NOT inherit those host-runtime diagnostics.


## 8. Desktop composition invariants (v1.2)

- Remote ChatGPT content MUST run in a separate `WebContentsView` with Node integration disabled, Chromium sandbox enabled, context isolation enabled, and no Wharness preload.
- The privileged Wharness preload MUST be attached only to the trusted local frontend origin and MUST expose narrow, named IPC capabilities rather than `ipcRenderer` or generic send/invoke primitives.
- Wharness MUST NOT inspect ChatGPT cookies, local storage, generated response prose, or authentication state during normal ChatGPT transport. The only permitted DOM interaction is the allowlisted transport bridge described above (composer focus/fill, submit, exact expected bundle download control); it MUST NOT enumerate arbitrary DOM or infer model content/completion from response text. Electron persists the remote browser partition and MAY export/import that partition only as an opaque user-requested Wharness session backup that is treated as a secret. ChatGPT authentication has two explicit user-selectable modes: **Embedded**, where compatible login navigation remains inside the sandboxed ChatGPT `WebContentsView`; and **External browser**, where Wharness launches a real Chrome/Chromium/Brave process with a Wharness-owned persistent dedicated profile and loopback-only DevTools endpoint, always starting again at `https://chatgpt.com/auth/login`. An in-flight OAuth URL created in Electron MUST NEVER be handed to another browser. The sole credential-inspection exception is the external-auth callback relay: after the managed browser proves an authenticated return to `chatgpt.com`, main-process code MAY read only `chatgpt.com` cookies from that Wharness-owned dedicated profile and write them directly to the dedicated Electron cookie store. Cookie values MUST never enter the renderer, logs, project context, or generic IPC; unrelated-domain and Cloudflare/anti-bot cookies MUST be excluded, and the dedicated browser profile MUST remain private under Wharness `userData`, persist across successful/cancelled login attempts, and be deleted only by an explicit browser-session/full-data clear.
- The desktop context-copy IPC MUST derive the backend bundle URL internally from an allowlisted local backend plus a validated session ID. Renderer-supplied arbitrary fetch URLs are forbidden.
- ChatGPT remote permissions are denied unless explicitly allowlisted in the security model.
- Native clipboard file references MUST point only to context artifacts generated by Wharness in its temporary context directory.
- Automatic ChatGPT input transport MUST NOT switch the visible Inspector tab or explicitly focus the remote WebContents. Native mouse/key events may target the ChatGPT WebContents while the Wharness window is already focused; explicit focus is reserved for user-invoked bridge actions.
- While the user-selected **External browser** authentication flow is active, the affected embedded remote view stays hidden. The managed browser must be a real Chrome/Chromium/Brave executable, use a Wharness-owned persistent dedicated profile, bind DevTools only to `127.0.0.1`, and begin from `https://chatgpt.com/auth/login`. Return to non-auth `chatgpt.com` plus a successful in-browser auth-session check is the callback signal. Wharness then performs the narrow ChatGPT-cookie relay described above, closes the managed browser, preserves its dedicated profile for future Google/ChatGPT sign-in reuse, and reloads the embedded view. The ordinary personal Chrome profile MAY be opened only as a manual isolated shortcut and MUST NOT be inspected, debugged, or presented as callback-capable. Google OAuth MUST be handed to this managed-browser flow when selected from Embedded mode because Google disallows embedded user-agents. The ordinary operating-system browser remains a manual, session-isolated fallback and MUST NOT be presented as callback-capable.
- While one manual request is pending, the Desktop MAY normalize a generic downloaded ZIP filename to the exact canonical `wharness-bundle-<request_id>.zip` bound to that active chat. It MUST NOT rewrite a different valid Wharness request id.
- Durable Harness chat attachments MUST live in Wharness-owned application storage, never inside the target project, and renderer IPC MUST address them through validated opaque references rather than arbitrary paths.
- Leaving the ChatGPT tab or Agent mode MUST hide the native remote view so it cannot intercept interaction over other Wharness surfaces. Any trusted Wharness modal/overlay that occupies the ChatGPT viewport MUST also suspend the native remote view until the overlay closes.

## 9. Local lifecycle invariants (v1.2.1)

- Repository-root `make build`, `make start`, `make stop`, `make status`, and `make logs` are the canonical local lifecycle commands.
- Build commands MUST resolve Docker/build paths from the repository root, not from the caller's current service directory.
- `make start` MUST track only processes it owns under `.harness/run`; `make stop` MUST NOT indiscriminately kill unrelated processes already using the same ports.
- Linux Electron startup MUST support an explicit `WHARNESS_OZONE_PLATFORM=x11|wayland` override and default safely when both Wayland and XWayland are present.
- Runtime PID/log files belong under `.harness/` and MUST remain excluded from project context and source control.


## Git workspace invariant

- Every opened project root must own a Git repository. The backend may run `git init` automatically when `.git` is absent.
- Do not auto-commit or rewrite host history during Git bootstrap.
- Sandbox copies use a fresh local Git baseline; never copy the host `.git` directory into a model execution workspace.
- Opening/restoring a project MUST initialize the Agent workspace in Protected + Auto. A user may switch that open project to Unprotected only through explicit confirmation; doing so disables Auto, and every Unprotected plan execution MUST require another explicit confirmation.
- The interactive Editor terminal target is independent of Agent Protected/Unprotected mode: `Sandbox` remains the default; `Host` is a separate explicit human-only target with confirmation and a persistent warning.
- Patch fallback may use `git apply --recount` or checked `--3way` only after a dry/check pass; never partially apply a failed fallback. Surface Git stderr on failure.
- Restored/legacy sessions MUST self-heal a missing `whaness.yml` through the validated default config creator before project settings are returned; a missing config file must not strand the UI in an indefinite loading state.

## Chat conversation affinity invariant (v1.2.6)

- A workspace MAY contain multiple Harness chats; each chat MUST own an independent Harness session identity and local transcript.
- Each Harness chat MAY bind to exactly one stable ChatGPT conversation URL. The binding is local metadata and MUST survive frontend/Desktop restart.
- Switching Harness chats MUST navigate the remote ChatGPT surface to the URL linked to the selected chat when one exists.
- An unbound Harness chat MUST begin from the ChatGPT new-chat/home surface and MAY auto-bind only after a concrete trusted `chatgpt.com/.../c/...` URL exists.
- Once a chat already has a ChatGPT URL, navigation alone MUST NOT silently replace that binding. An explicit rebind action or an explicit Harness Send while a different concrete ChatGPT conversation is open counts as user intent; the latter MUST refresh the project context for the newly targeted conversation.
- Desktop navigation IPC MUST accept only trusted HTTPS `chatgpt.com` origins. Never expose arbitrary renderer-controlled navigation.
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
- Context inspection MUST derive final inclusion from the current manifest/ZIP snapshot, expose structured exclusion reasons and effective rules, and never claim a file is included merely because its parent directory is eligible.
