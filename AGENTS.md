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
- Explorer/editor APIs MUST enforce project-root containment, excluded/secret paths, symlink denial, UTF-8 text limits, and optimistic SHA-256 writes.
- The interactive Editor terminal MUST default to a copied sandbox workspace. A human MAY explicitly switch that terminal to `Host` only after a dedicated confirmation; Host terminal commands execute directly in the project root, remain argv-only, remain subject to Policy Engine denial, and MUST display a persistent host-direct warning. The terminal target is independent from Agent Protected/Unprotected mode.
- Terminal commands MUST be argv, never an implicit shell string.
- Editor saves are explicit human host mutations. Agent mutations are sandbox-first in Protected mode; only an explicitly selected Unprotected project may execute the Agent plan directly on the host.
- Every agent request MUST refresh project context so manually edited files are visible to the planner.
- Consumer ChatGPT web UI scraping, login-cookie inspection, DOM prompt injection, or automatic Output extraction MUST NOT be introduced. Automatic planning uses supported provider adapters.


## 8. Desktop composition invariants (v1.2)

- Remote ChatGPT content MUST run in a separate `WebContentsView` with Node integration disabled, Chromium sandbox enabled, context isolation enabled, and no Wharness preload.
- The privileged Wharness preload MUST be attached only to the trusted local frontend origin and MUST expose narrow, named IPC capabilities rather than `ipcRenderer` or generic send/invoke primitives.
- Wharness MUST NOT inspect ChatGPT cookies, DOM, local storage, prompt content, generated output, or authentication state. Login is rendered and controlled by ChatGPT itself; Electron only persists the remote browser partition.
- The desktop context-copy IPC MUST derive the backend bundle URL internally from an allowlisted local backend plus a validated session ID. Renderer-supplied arbitrary fetch URLs are forbidden.
- ChatGPT remote permissions are denied unless explicitly allowlisted in the security model.
- Native clipboard file references MUST point only to context artifacts generated by Wharness in its temporary context directory.
- Durable Harness chat attachments MUST live in Wharness-owned application storage, never inside the target project, and renderer IPC MUST address them through validated opaque references rather than arbitrary paths.
- Leaving the ChatGPT tab or Agent mode MUST hide the native remote view so it cannot intercept interaction over other Wharness surfaces.

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
- Protected/Unprotected choice MUST persist per project, not globally, and switching to Unprotected MUST require explicit UI confirmation. Every Unprotected plan execution MUST require another explicit confirmation.
- The interactive Editor terminal target is independent of Agent Protected/Unprotected mode: `Sandbox` remains the default; `Host` is a separate explicit human-only target with confirmation and a persistent warning.
- Patch fallback may use `git apply --recount` or checked `--3way` only after a dry/check pass; never partially apply a failed fallback. Surface Git stderr on failure.

## Chat conversation affinity invariant (v1.2.6)

- A workspace MAY contain multiple Harness chats; each chat MUST own an independent Harness session identity and local transcript.
- Each Harness chat MAY bind to exactly one stable ChatGPT conversation URL. The binding is local metadata and MUST survive frontend/Desktop restart.
- Switching Harness chats MUST navigate the remote ChatGPT surface to the URL linked to the selected chat when one exists.
- An unbound Harness chat MUST begin from the ChatGPT new-chat/home surface and MAY auto-bind only after a concrete trusted `chatgpt.com/.../c/...` URL exists.
- Once a chat already has a ChatGPT URL, navigation to a different conversation MUST NOT silently replace that binding; rebinding requires explicit user intent.
- Desktop navigation IPC MUST accept only trusted HTTPS `chatgpt.com` origins. Never expose arbitrary renderer-controlled navigation.
## Manual plan transport normalization

- Manual ChatGPT import may normalize only narrowly defined transport mistakes before strict protocol validation.
- It may repair unescaped source-code double quotes only inside a `patch` value that is clearly a supported patch dialect and is structurally followed by the operation `command` field.
- Never broaden this into a general "best effort" parser that invents operations, paths, commands, protocol values, or security-sensitive semantics.
- Every normalized plan MUST still pass `protocol.Validate` and the policy engine unchanged.
