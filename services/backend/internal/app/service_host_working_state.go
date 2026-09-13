package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// ErrHostWorkingStateBlocked marks an Apply that Wharnex refused to perform
// because the host working tree is in a state where integrating would damage
// the operator's own uncommitted work.
//
// This is the deliberate inverse of the behavior it replaces. Each condition
// it covers was previously handled by proceeding: an unfinished merge had its
// conflict markers committed as though resolved, an untracked nested
// repository was recorded as a bare pointer with its files left out of the
// snapshot that claims to preserve them, and a submodule holding uncommitted
// work had its recorded commit moved out from under it. Refusing costs the
// operator one explicit action; proceeding cost them work they never agreed to
// put at risk.
var ErrHostWorkingStateBlocked = errors.New("host working tree must be resolved before verified changes can be integrated")

// failHostStateBlocked retains the verified candidate, classifies the refusal
// so the UI can offer the operator's own remedy instead of a repair prompt,
// and returns the actionable message.
func (s *Service) failHostStateBlocked(
	sessionID string,
	item domain.Session,
	planID string,
	blocked *hostrepo.BlockedError,
	abort func(error) error,
) (domain.Session, error) {
	detail := hostStateBlockedDetail(blocked)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		// PendingHostChanges is deliberately untouched: the candidate is
		// verified and still applies, so Apply must remain available the
		// moment the operator clears the condition.
		current.LastRepairError = detail
		current.FailureKind = domain.FailureKindHostWorkingStateBlocked
		return nil
	})
	if err != nil {
		return item, abort(fmt.Errorf("%s; retain host apply refusal for correction: %w", detail, err))
	}
	s.bus.Publish(sessionID, "host.apply_blocked", map[string]any{
		"plan_id": planID,
		"reason":  string(blocked.Reason),
		"paths":   blocked.Paths,
		"remedy":  blocked.Remedy,
	})
	return updated, abort(fmt.Errorf("%w: %s", ErrHostWorkingStateBlocked, detail))
}

// ErrSubmoduleWrite marks a change plan whose patch set writes into a submodule
// Wharnex cannot integrate into at all.
//
// Its scope narrowed with adr/ADR-0050. Writing inside an ordinary initialized
// submodule is now supported end to end: the path is routed to the repository
// that owns it, committed there, and the parent's pointer moved to match. What
// remains refused is the case where that is impossible — a submodule with no
// checkout, or one Wharnex could not measure as a repository of its own. There
// is nothing to patch and nothing to commit into, and no planner repair can
// change that, so it keeps the original non-repairable classification.
var ErrSubmoduleWrite = errors.New("change writes inside a Git submodule that has no usable checkout in this project")

// routeSubmoduleWrites classifies a change plan's write set against the
// project's real repository-unit tree, refusing only the writes no repository
// can receive.
//
// The previous behavior refused every write inside any submodule, which was
// correct for the mechanism as it then existed — the superproject's index holds
// one gitlink per submodule, so `git add -- <submodule>/<file>` is a hard error
// and the whole verification round was spent before reaching it. It was the
// wrong contract for the projects Wharnex hosts: a deployment superproject
// whose entire source lives in submodules could receive no change at all.
//
// Routing is a measurement, never a plan field. A project Wharnex cannot
// inspect resolves entirely to the superproject and is admitted exactly as
// before, because a measurement failure must never reject a legitimate change.
func (s *Service) routeSubmoduleWrites(ctx context.Context, sessionID, projectPath string, plan *domain.ExecutionPlan) error {
	paths := actualPatchFiles(plan)
	if plan == nil || len(paths) == 0 || strings.TrimSpace(projectPath) == "" {
		return nil
	}
	units, err := hostrepo.InspectUnits(ctx, projectPath)
	if err != nil || !units.HasSubmodules() {
		return nil
	}
	blocked := units.UnintegrableWrites(paths)
	if len(blocked) == 0 {
		if routed := submoduleWriteRouting(units, paths); len(routed) > 0 {
			s.bus.Publish(sessionID, "bundle.submodule_write_routed", map[string]any{
				"plan_id": plan.PlanID, "units": routed,
				"note": "these paths are committed in their own submodule repository and the superproject pointer is moved to match",
			})
		}
		return nil
	}
	names := make([]string, 0, len(blocked))
	offending := make([]string, 0, len(paths))
	reasons := make([]string, 0, len(blocked))
	for name, set := range blocked {
		names = append(names, name)
		offending = append(offending, set.ProjectPaths...)
		reasons = append(reasons, fmt.Sprintf("%s (%s)", name, firstNonEmpty(set.Unit.Unmeasurable, "not a usable repository in this worktree")))
	}
	sort.Strings(names)
	sort.Strings(offending)
	sort.Strings(reasons)
	s.bus.Publish(sessionID, "bundle.submodule_write_rejected", map[string]any{
		"plan_id": plan.PlanID, "submodules": names, "paths": offending, "reasons": reasons,
	})
	return fmt.Errorf(
		"%w: %s belong(s) to %s. Wharnex integrates a submodule by committing in that submodule's own repository, and there is no repository to commit into here. Initialize the submodule (git submodule update --init -- %s) and repeat the request, or change files outside it",
		ErrSubmoduleWrite, strings.Join(offending, ", "), strings.Join(reasons, ", "), strings.Join(names, " "),
	)
}

// submoduleWriteRouting reports which submodule each routed path landed in, for
// the ingestion event. It exists so that a change crossing a repository
// boundary is visible in the audit trail at the moment it is accepted, rather
// than only later as an unexplained commit in another repository.
func submoduleWriteRouting(units hostrepo.Units, paths []string) map[string][]string {
	routed := map[string][]string{}
	for _, set := range units.Group(paths) {
		if !set.Unit.IsRoot() {
			routed[set.Unit.Path] = set.ProjectPaths
		}
	}
	return routed
}

// partitionSubmoduleConflictPaths separates conflicting paths that are
// submodule pointers from ones a planner can actually resolve.
//
// A gitlink conflict is three commit ids, not three versions of a file:
// `git show <ref>:<submodule>` fails outright, so the capsule would tell the
// planner the path exists on no side and then ask it to write a file there —
// a request the patch validator rejects on arrival, every round, until the
// bounded budget is exhausted.
//
// Only a path that IS a submodule root is partitioned out. A path *inside* a
// submodule is an ordinary file in that submodule's own repository and is
// perfectly resolvable there (adr/ADR-0050); a superproject merge cannot report
// one anyway, because the gitlink shadows the directory, so partitioning by
// prefix only ever removed paths a submodule's own merge had legitimately
// reported.
func partitionSubmoduleConflictPaths(topology hostrepo.Topology, paths []string) (submodulePaths, resolvable []string) {
	roots := map[string]bool{}
	for _, submodule := range topology.Submodules {
		roots[submodule.Path] = true
	}
	for _, path := range paths {
		if roots[strings.TrimSuffix(strings.TrimSpace(path), "/")] {
			submodulePaths = append(submodulePaths, path)
			continue
		}
		resolvable = append(resolvable, path)
	}
	return submodulePaths, resolvable
}

// hostStateBlockedDetail renders the refusal for the session's own failure
// text: what was found, where, and the single action that clears it.
func hostStateBlockedDetail(blocked *hostrepo.BlockedError) string {
	detail := blocked.Detail
	if len(blocked.Paths) > 0 {
		detail += ": " + strings.Join(blocked.Paths, ", ")
	}
	if blocked.Remedy != "" {
		detail += "; " + blocked.Remedy
	}
	return detail
}
