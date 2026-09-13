# ADR-0046: Engine-owned project versioning

- Status: Accepted
- Date: 2026-09-12

## Context

Projects may have no root `VERSION`, and planner-generated patches could previously edit whatever version file happened to exist. That couples release metadata to generated diff bytes rather than to the point where Wharnex knows that a candidate actually integrated and verified on the host. It also makes grouped changes and failed Apply attempts ambiguous: a patch can say the version changed even when the implementation never became accepted host state.

The existing Wharnex version format in active projects is four-part (for example `v1.2.46.13`). A plan therefore needs a small semantic instruction that survives verification and integration without allowing the planner to own the file itself.

## Decision

Wharnex owns root `VERSION` lifecycle. Session/project preparation creates a missing file as `v0.0.0.0`. Protocol validation rejects planner patches to root `VERSION`.

Every `change` plan declares `version_increment = {component, amount}`. The canonical component names are `major`, `medium`, `minor`, and `patch`, mapped to the four stored segments in `vA.B.C.D`; `amount` is 1..1000. Incrementing a component resets all lower components to zero. `workflow` plans do not carry this field.

Wharnex applies increments only after source integration and post-integration verification succeed. Multiple accepted pending plans are applied in order. Auto-commit records the version mutation as Wharnex-owned Git history; no-auto-commit unwinds that history together with the verified source integration and leaves both changes in the working tree. The successful session records before/after values so deterministic revert can restore the previous value with a compare-and-swap guard.

## Consequences

- A planner can choose version significance without editing release metadata directly.
- Failed or conflicted host integrations do not advance the project version.
- Missing `VERSION` is self-healed before context capture, so all later planner requests see a concrete version.
- Existing one-, two-, or three-component numeric versions can be read and are normalized to four components on the next successful increment.
- Root `VERSION` becomes a reserved project path in the patch protocol; external edits after Apply are preserved because revert refuses to overwrite an unexpected current value.
