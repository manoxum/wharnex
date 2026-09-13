# ADR-0050 — Published repository topology (`wharness.repository/v1`)

## Status

Partially superseded before release. This ADR originally proposed a second
submodule-integration engine ("repository units"). That engine was **not
kept**: `adr/ADR-0039` already carries the accepted decision, implemented by
`internal/sandbox/repositorytree.go`, which had more testing and production
exposure. Two implementations of the same mechanism is precisely what
`AGENTS.md` §4 forbids, so the unit engine was removed rather than carried
alongside it.

What remains in force, and what this ADR now records, is the part that was
genuinely additive and that no other decision covers: **publishing the
repository topology to the planner**.

## Decision

Every planner request for a project that is a Git superproject with submodules
carries a Wharnex-measured `wharness.repository/v1` manifest: the superproject
and every submodule reachable from an index, each with its HEAD, its branch or
detached state, the pointer its parent records, and whether a patch can be
delivered there.

It is published **only** for a project that has submodules. Publishing it
everywhere would spend context restating what a planner already assumes, and
would train planners to skim past the section in the one case that matters.
Repository URLs are deliberately omitted, for the same reason project exports
omit them.

## Context

The reported failure was a deployment superproject (`flowKey-deploy`) whose
entire source lives in submodules — `services/app`, `services/portal`,
`services/server`, `bin`. A request to fix an `npm install` failure in
`services/app/Dockerfile` produced a correct, minimal change that Wharnex
refused, because writing inside a submodule was unsupported at the time.

`adr/ADR-0039` fixes the refusal. But fixing it leaves a second problem
untouched: the planner still cannot see that the project is several
repositories. Without that, it either avoids the only paths that can answer the
request, or writes them while explaining the change as though one repository
held everything — and its `commit_message`, which becomes real project history
in more than one repository, is written blind.

## Decision detail

`internal/repomanifest` measures the manifest from `hostrepo.InspectUnits`, a
read-only recursive inventory of the superproject and its submodules, and
renders it as the `LOCAL REPOSITORY TOPOLOGY` prompt section beside the existing
`LOCAL EXECUTION ENVIRONMENT` section.

The manifest is **descriptive only**, exactly like `wharness.environment/v1`. It
grants no capability and relaxes no check. Routing a path to the repository that
owns it is performed by Wharnex whether or not a planner ever reads this, so the
section cannot be wrong about where a change will land — it can only make the
planner's prose, commit message and impact set true about a change that crosses
repositories.

The protocol rules it carries are correspondingly narrow: paths stay
project-relative in every plan field and every patch header whichever repository
owns them; there is no protocol field by which a plan selects a repository and a
planner must not invent one; a unit marked `patchable: false` has no checkout to
write into; and a submodule pointer or `.gitmodules` gitlink entry is a commit
id, not content, so a patch targeting one is rejected on arrival.

## Alternatives rejected

- **An explicit per-operation `repository` field in the plan.** It makes every
  planner responsible for a topology it cannot verify, breaks every existing
  behavior document, and adds a way for a plan to be wrong about something
  Wharnex can simply measure. A measurement against the index cannot disagree
  with the index.
- **Publishing the section for every project.** Context spent restating what is
  already assumed, and a section planners learn to skip.
- **Publishing remote URLs with it.** They carry credentials often enough that
  the marginal context is not worth it; the project export already decided this.
- **Keeping both integration engines behind a flag.** Two implementations of one
  mechanism rot in opposite directions and double the surface every future
  submodule fix has to be applied to.

## Consequences

- A planner working on a superproject is told which repositories exist, which
  accept a patch, and that it writes ordinary project-relative paths regardless.
- An ordinary single-repository project sees no change at all: no section is
  published and no behavior differs.
- `hostrepo.InspectUnits` exists solely as the measurement behind this manifest.
  It performs no mutation and is not part of the integration path.
