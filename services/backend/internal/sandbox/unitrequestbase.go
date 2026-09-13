package sandbox

import (
	"context"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/projectknowledge"
)

// UnitBase is one repository unit's anchored request base.
//
// CommitSHA empty with a Reason means that unit degraded to executing against
// its current content, which is the pre-ADR-0035 behavior for that unit alone.
// One unit degrading never disqualifies the units that could be anchored.
type UnitBase struct {
	UnitPath  string
	CommitSHA string
	Reason    string
}

// CaptureRequestBaseUnits anchors the exact tree each repository unit is being
// planned against, in that unit's own repository.
//
// A submodule's content lives in another repository, so there is no single
// commit that can describe what a planner was shown for a project that has
// any. Anchoring per unit is what lets a patch written for a file inside a
// submodule be applied to the tree it was actually authored against, exactly as
// `adr/ADR-0035` already guarantees for the superproject.
func CaptureRequestBaseUnits(ctx context.Context, hostPath, requestID string) ([]UnitBase, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return nil, nil
	}
	units, err := hostrepo.InspectUnits(ctx, hostPath)
	if err != nil {
		return nil, err
	}
	bases := make([]UnitBase, 0, len(units.List))
	for _, unit := range units.List {
		if !unit.Integrable() {
			continue
		}
		base := UnitBase{UnitPath: unit.Path}
		// The Wharnex-managed knowledge subtree lives at the project root only.
		// Excluding it inside a submodule would be meaningless, and excluding a
		// same-named path there would silently drop real project content.
		var excluded []string
		if unit.IsRoot() {
			excluded = []string{projectknowledge.DirectoryName}
		}
		commit, captureErr := captureWorkingTreeCommit(ctx, unit.Root, "Wharnex request base "+requestID, excluded)
		if captureErr != nil {
			base.Reason = truncateForError(captureErr.Error(), 300)
			bases = append(bases, base)
			continue
		}
		if output, refErr := runGit(ctx, unit.Root, "update-ref", RequestBaseRef(requestID), commit); refErr != nil {
			base.Reason = truncateForError(output, 300)
			bases = append(bases, base)
			continue
		}
		base.CommitSHA = commit
		bases = append(bases, base)
	}
	return bases, nil
}

// DeleteRequestBaseUnitRefs releases every unit's anchor for a request. Each
// failure is returned rather than aborting: an orphaned ref costs one
// unreachable commit and never affects correctness.
func DeleteRequestBaseUnitRefs(ctx context.Context, hostPath, requestID string, unitPaths []string) []string {
	failures := make([]string, 0)
	for _, unitPath := range unitPaths {
		unitRoot := UnitRepoPath(hostPath, unitPath)
		if output, err := runGit(ctx, unitRoot, "update-ref", "-d", RequestBaseRef(requestID)); err != nil {
			failures = append(failures, unitLabel(unitPath)+": "+truncateForError(output, 200))
		}
	}
	return failures
}

// CheckoutRequestBaseUnits repoints a verification sandbox at each unit's own
// anchored base and opens the integration branch there.
//
// The superproject goes first. Its `git clean` runs without `-x` and without
// `-ff`, so neither the lazily hydrated gitignored dependency trees nor the
// submodule repositories the sandbox just cloned are removed — Git refuses to
// descend into a nested repository without `-ff`, which is exactly the behavior
// wanted here.
//
// Rooting stays best effort per unit: a unit whose base could not be fetched or
// checked out is reported and keeps executing against its current content,
// while every other unit still gets the tree its patch was authored against.
func CheckoutRequestBaseUnits(
	ctx context.Context,
	workspacePath, hostPath, requestID, branch string,
	bases []UnitBase,
) (rooted map[string]bool, degraded map[string]string) {
	rooted, degraded = map[string]bool{}, map[string]string{}
	ordered := append([]UnitBase(nil), bases...)
	// Shallowest first: the superproject's checkout must settle before a
	// submodule inside it is repointed.
	for index := 0; index < len(ordered); index++ {
		for other := index + 1; other < len(ordered); other++ {
			if unitDepth(ordered[other].UnitPath) < unitDepth(ordered[index].UnitPath) {
				ordered[index], ordered[other] = ordered[other], ordered[index]
			}
		}
	}
	ref := RequestBaseRef(strings.TrimSpace(requestID))
	for _, base := range ordered {
		if strings.TrimSpace(base.CommitSHA) == "" {
			degraded[base.UnitPath] = firstNonEmptyText(base.Reason, "no anchored base was recorded for this unit")
			continue
		}
		unitWorkspace := UnitRepoPath(workspacePath, base.UnitPath)
		unitHost := UnitRepoPath(hostPath, base.UnitPath)
		if err := FetchRefFromHost(ctx, unitWorkspace, unitHost, ref); err != nil {
			degraded[base.UnitPath] = truncateForError(err.Error(), 300)
			continue
		}
		if err := CheckoutRequestBase(ctx, unitWorkspace, branch, base.CommitSHA); err != nil {
			degraded[base.UnitPath] = truncateForError(err.Error(), 300)
			continue
		}
		rooted[base.UnitPath] = true
	}
	return rooted, degraded
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
