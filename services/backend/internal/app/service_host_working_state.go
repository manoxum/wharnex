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

// ErrSubmoduleWrite marks a change plan whose patch writes inside a Git
// submodule of the open project.
var ErrSubmoduleWrite = errors.New("change writes inside a Git submodule, which Wharnex integrates as a pointer rather than as content")

// rejectSubmoduleWrites refuses, at ingestion, a change plan that patches a
// path inside one of the host project's submodules.
//
// A submodule shadows its own directory in the superproject: the index holds a
// single gitlink there, so `git add -- <submodule>/<file>` is a hard error
// ("Pathspec is in submodule"), and a local clone of the superproject does not
// even carry the submodule's content. The result was a change that applied to
// disk, passed every verification gate, and then died at commit time with an
// opaque Git message — after the model turn, the container run and the full
// verification suite had all been spent, and with no repair a planner could
// possibly produce, because the defect is in the repository topology rather
// than in the source.
//
// Rejecting here costs one re-request and states the real constraint. The
// project's own context is what teaches the planner to avoid those paths on
// the retry; this check is the enforcement, not the explanation.
//
// It is best effort with respect to measurement: a project Wharnex cannot
// inspect (no git, an unreadable repository) is admitted exactly as before,
// because a measurement failure must never reject a user's legitimate change.
func (s *Service) rejectSubmoduleWrites(ctx context.Context, sessionID, projectPath string, plan *domain.ExecutionPlan) error {
	paths := actualPatchFiles(plan)
	if plan == nil || len(paths) == 0 || strings.TrimSpace(projectPath) == "" {
		return nil
	}
	topology, err := hostrepo.Inspect(ctx, projectPath)
	if err != nil || len(topology.Submodules) == 0 {
		return nil
	}
	blocked := map[string][]string{}
	for _, path := range paths {
		if submodule, found := topology.SubmoduleFor(path); found {
			blocked[submodule.Path] = append(blocked[submodule.Path], path)
		}
	}
	if len(blocked) == 0 {
		return nil
	}
	names := make([]string, 0, len(blocked))
	offending := make([]string, 0, len(paths))
	for submodule, inside := range blocked {
		names = append(names, submodule)
		offending = append(offending, inside...)
	}
	sort.Strings(names)
	sort.Strings(offending)
	s.bus.Publish(sessionID, "bundle.submodule_write_rejected", map[string]any{
		"plan_id": plan.PlanID, "submodules": names, "paths": offending,
	})
	return fmt.Errorf(
		"%w: %s belong(s) to submodule(s) %s. The superproject records only a commit pointer there, so those files cannot be staged, committed or merged from this project. Change files in the superproject itself, or make the change in the submodule's own repository and update the pointer there",
		ErrSubmoduleWrite, strings.Join(offending, ", "), strings.Join(names, ", "),
	)
}

// partitionSubmoduleConflictPaths separates conflicting paths that are
// submodule pointers from ones a planner can actually resolve.
//
// A gitlink conflict is three commit ids, not three versions of a file:
// `git show <ref>:<submodule>` fails outright, so the capsule would tell the
// planner the path exists on no side and then ask it to write a file there —
// a request the patch validator rejects on arrival, every round, until the
// bounded budget is exhausted.
func partitionSubmoduleConflictPaths(topology hostrepo.Topology, paths []string) (submodulePaths, resolvable []string) {
	for _, path := range paths {
		if _, found := topology.SubmoduleFor(path); found {
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
