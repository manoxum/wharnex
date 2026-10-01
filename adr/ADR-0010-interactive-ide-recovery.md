# ADR-0010 — Interactive IDE recovery boundaries

Status: Accepted

## Context

The v1.2.17 project-config flow exposed three integration problems: persisted sessions could reference projects whose `whaness.yml` had since disappeared; the native ChatGPT `WebContentsView` could paint above renderer modals; and the Editor terminal reused model-plan policy even though the command was explicitly typed by a human. The Editor Explorer also needed normal IDE filesystem operations without weakening project-root security.

## Decision

1. `ProjectConfig` uses `projectconfig.Ensure` for every read. A missing file is recreated from the validated default, an audit event is emitted, and context refresh is attempted. The UI shows a retryable failure state if loading still fails.
2. Renderer overlays that intersect ChatGPT suspend the native view through the existing narrow Desktop bridge. CSS z-index is not treated as a native-view isolation mechanism. *(Superseded in v1.3.42: project windows show only a mirror of the ChatGPT view, so overlays render above it and never suspend it.)*
3. Human terminal input has a dedicated Policy Engine profile. It still validates `CommandSpec`, relative cwd, argv shape and target rules. Normal developer argv commands may mutate the project; shell interpreters, privilege escalation, container/host administration and inline evaluator flags remain denied. This profile is never used for model execution plans.
4. Explorer create/rename/delete are backend APIs. They reject absolute/traversal paths, context/security exclusions and symlink boundaries, and mirror successful host mutations into an already-existing sandbox devspace on a best-effort basis.
5. Explorer rename uses PATCH and the local CORS contract explicitly allows PATCH.

## Consequences

The Editor behaves like a useful local development surface without granting model plans the same privileges. Native ChatGPT content cannot cover trusted project configuration dialogs. Existing sessions recover when project config is deleted. Explorer filesystem actions remain constrained to the same project boundary as editing/context access.
