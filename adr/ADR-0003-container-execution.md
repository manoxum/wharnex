# ADR-0003: Container-first execution

**Status:** Accepted

Model-proposed operations execute in an isolated Docker workspace by default. Successful verification permits host integration under the informed execution approval; an explicit Apply is integration recovery only.

Network remains disabled by default. When an offline Go module-cache preflight fails, Wharnex classifies the condition as local infrastructure and pauses instead of asking the planner to repair source code. A dedicated, prominent human action may retry only Go dependency/build/verification argv commands from that failed plan with Docker bridge networking. Downloads populate the copied workspace's private module cache; the original project and host module cache are never mounted or mutated, and subsequent unapproved commands return to offline execution.

## 2026-10-09 — nested Node package hydration

The DRCAE RLS verification used `pnpm --dir services/drcae-backend run be:build`, with a root cwd. Dependency copying and acquisition inspected only that cwd, so frozen installation ran at `/workspace` without a package manifest. Resolve the supported leading pnpm directory selector once for both preflight paths, preserve the original execution contract, and validate both source and sandbox containment. Missing or ambiguous selectors are local infrastructure failures. The existing deterministic install, bounded network posture and no-planner-repair classification remain unchanged; no protocol migration is required.
