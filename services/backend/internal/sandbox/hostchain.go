package sandbox

import (
	"context"
	"fmt"
)

// ChainCandidate is one pending candidate of an Apply batch, in the order the
// batch will merge it.
type ChainCandidate struct {
	Branch           string
	RequestBaseRef   string
	IntegratingUnits []string
}

// PreflightIntegrationChain simulates merging a whole Apply batch, in order,
// into the host's current tree — committed and uncommitted — without touching
// the host. Each candidate is merged from its own request base onto the result
// of the ones before it, exactly as the real batch will be.
//
// It returns the index of the first candidate that would stop the batch on a
// planner-resolvable conflict, with that conflict (HostSHA is the simulated
// tree the candidate meets, so a capsule shows the resolver the content the
// real merge will face), or -1 when the whole batch integrates.
//
// This is what makes an Apply batch all-or-nothing before it starts. Checking
// each candidate only just before its own merge let a batch merge its first
// candidates, meet a conflict on a later one, and depend on a revert to undo
// them; when that revert failed, verified-but-unverified-together merges were
// left on the host with no post-merge verification at all.
//
// supported is false when Git cannot answer; the caller then keeps the
// per-candidate checks, which remain authoritative either way.
func PreflightIntegrationChain(ctx context.Context, hostPath string, candidates []ChainCandidate) (failed int, conflict *MergeConflictError, supported bool, err error) {
	ours, err := CaptureWorkingTreeCommit(ctx, hostPath, "Wharnex batch preflight")
	if err != nil {
		return -1, nil, false, err
	}
	for index, candidate := range candidates {
		theirs, err := ResolveRef(ctx, hostPath, candidate.Branch)
		if err != nil {
			return -1, nil, false, err
		}
		base := candidateMergeBaseOrRef(ctx, hostPath, candidate.Branch, candidate.RequestBaseRef)
		preflight, err := PreflightMergeFrom(ctx, hostPath, base, ours, theirs)
		if err != nil || !preflight.Supported || preflight.Tree == "" {
			return -1, nil, false, err
		}
		if !preflight.Clean {
			_, ordinary := partitionManagedMergePaths(preflight.ConflictPaths)
			ordinary = withoutIntegratingUnits(ordinary, candidate.IntegratingUnits)
			if len(ordinary) > 0 {
				if base == "" {
					base, _ = runGit(ctx, hostPath, "merge-base", ours, theirs)
				}
				return index, &MergeConflictError{Paths: ordinary, Branch: candidate.Branch, HostSHA: ours, MergeBaseSHA: base}, true, nil
			}
		}
		// Carry the merged result forward so the next candidate meets what the
		// real batch will have produced by then. Conflicts Wharnex decides
		// locally (managed state, owned gitlinks) stay as merge-tree wrote them,
		// which is close enough for predicting ordinary-path collisions.
		next, err := runGit(ctx, hostPath, "-c", "user.name="+gitCommitAuthorName, "-c", "user.email="+gitCommitAuthorEmail, "-c", "commit.gpgSign=false",
			"commit-tree", preflight.Tree, "-p", ours, "-p", theirs, "-m", "Wharnex batch preflight step")
		if err != nil {
			return -1, nil, false, fmt.Errorf("record batch preflight step: %s", next)
		}
		ours = next
	}
	return -1, nil, true, nil
}
