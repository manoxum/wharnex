package sandbox

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// HostMerge reports everything one integration merge did to the host beyond
// moving HEAD, so the caller can tell the operator the truth rather than
// implying a clean, complete integration.
//
// PreMergeSHA is the exact commit to revert to. Preservation says what of the
// operator's uncommitted work the snapshot could hold — and, just as
// importantly, what it could not. SubmoduleSync says which submodule
// checkouts were realigned with the commits the superproject now records.
type HostMerge struct {
	PreMergeSHA   string
	Preservation  hostrepo.Preservation
	SubmoduleSync hostrepo.SyncResult
}

// MergeBranchOnHost merges branch (already pushed into the host's own repo
// by PushBranchToHost) into the host's currently checked-out branch, and
// returns the exact pre-merge HEAD so a failed post-merge verification can
// be reverted with RevertHostMerge. A conflict confined to Wharnex-managed
// project knowledge is resolved locally by preserving the host side, because
// that subtree is never part of a planner patch. Any remaining real conflict
// is returned as *MergeConflictError, leaving the host working tree exactly
// as it was.
//
// The host is treated as a repository whose shape must be measured, not
// assumed. Before anything is mutated it establishes that the operator has no
// unfinished merge/rebase and no unresolved paths (committing either would
// damage their work), preserves what a superproject commit can genuinely
// hold, and refuses to move a submodule pointer out from under uncommitted
// work. Afterwards it realigns the submodule checkouts the merge moved, which
// Git itself leaves stale.
//
// The merge is three-way from the candidate's own request base
// (CandidateMergeBase), so operator work that was already present when the
// request was taken — and has kept changing since — is never mistaken for a
// change the candidate made.
func MergeBranchOnHost(ctx context.Context, hostPath, branch string, identities ...hostrepo.CommitIdentity) (HostMerge, error) {
	return mergeBranchOnHost(ctx, hostPath, branch, "", nil, nil, identityOrDefault(identities))
}

func mergeBranchOnHost(ctx context.Context, hostPath, branch, requestBaseRef string, gitlinkResolutions map[string]string, sync func([]hostrepo.Submodule) hostrepo.SyncResult, identity hostrepo.CommitIdentity) (HostMerge, error) {
	topology, err := hostrepo.Inspect(ctx, hostPath)
	if err != nil {
		return HostMerge{}, err
	}
	preservation, err := hostrepo.Preserve(ctx, hostPath, hostSnapshotMessage, identity)
	if err != nil {
		return HostMerge{}, err
	}
	if err := hostrepo.GuardDirtySubmodules(ctx, hostPath, branch, preservation.DirtySubmodules); err != nil {
		return HostMerge{}, err
	}
	result := HostMerge{Preservation: preservation}
	result.PreMergeSHA, err = CurrentHeadSHA(ctx, hostPath)
	if err != nil {
		return result, err
	}
	// Re-read the submodule pointers here rather than reusing the pre-snapshot
	// reading: the snapshot may itself have committed a gitlink the operator
	// moved, and realigning against the older reading would check that
	// submodule out to where it already is — detaching a branch the operator
	// deliberately put it on. The baseline must be the merge's own starting
	// point, so only pointers the merge moves are realigned.
	preMerge, preMergeErr := hostrepo.Inspect(ctx, hostPath)
	if preMergeErr != nil {
		preMerge = topology
	}
	merge := treeMerge{hostPath: hostPath, topology: topology, identity: identity, branch: branch, ours: result.PreMergeSHA, gitlinks: gitlinkResolutions}
	merge.base = candidateMergeBaseOrRef(ctx, hostPath, branch, requestBaseRef)
	err = merge.integrate(ctx)
	if errors.Is(err, errMergeTreeUnsupported) {
		err = legacyMergeBranch(ctx, hostPath, topology, identity, branch, requestBaseRef, result.PreMergeSHA, gitlinkResolutions)
	}
	if err != nil {
		return result, err
	}
	// A failed realignment is not a reason to undo a merge that succeeded:
	// the superproject is correct either way, and the skip list names exactly
	// what the operator still has to update themselves.
	result.SubmoduleSync = runSubmoduleSync(ctx, hostPath, preMerge.Submodules, sync)
	return result, nil
}

// legacyMergeBranch is the working-tree `git merge` used only when this Git
// build cannot merge from an explicit base. It cannot be told the candidate's
// request base, so it keeps the narrower BaseContinuationPaths reconciliation.
func legacyMergeBranch(ctx context.Context, hostPath string, topology hostrepo.Topology, identity hostrepo.CommitIdentity, branch, requestBaseRef, preMergeSHA string, gitlinkResolutions map[string]string) error {
	mergeArgs := append(hostrepo.InternalGitArgs(topology, identity), "merge", "--no-ff", "--no-edit", branch)
	output, mergeErr := runGit(ctx, hostPath, mergeArgs...)
	if mergeErr == nil {
		return nil
	}
	conflicted, conflictErr := runGit(ctx, hostPath, "diff", "--name-only", "--diff-filter=U")
	if conflictErr == nil && strings.TrimSpace(conflicted) != "" {
		local, ordinary := partitionLocallyResolvedMergePaths(strings.Fields(conflicted), gitlinkResolutions)
		continuations := BaseContinuationPaths(ctx, hostPath, requestBaseRef, preMergeSHA, ordinary)
		ordinary = withoutPaths(ordinary, continuations)
		if len(ordinary) == 0 && (len(local) > 0 || len(continuations) > 0) {
			if reconcileErr := reconcileMergeLocally(ctx, hostPath, topology, branch, preMergeSHA, local, continuations, gitlinkResolutions); reconcileErr != nil {
				_, _ = runGit(ctx, hostPath, "merge", "--abort")
				return reconcileErr
			}
			return nil
		}
		_, _ = runGit(ctx, hostPath, "merge", "--abort")
		mergeBase, _ := runGit(ctx, hostPath, "merge-base", preMergeSHA, branch)
		return &MergeConflictError{Paths: ordinary, Branch: branch, HostSHA: preMergeSHA, MergeBaseSHA: mergeBase}
	}
	_, _ = runGit(ctx, hostPath, "merge", "--abort")
	// The merge writes into the same repository the snapshot does, so every
	// operator-owned condition surfaces here too — a held index lock, a
	// refused ownership, a full disk. None is a defect in the change.
	if blocked := hostrepo.HostGitBlocked(ctx, hostPath, output); blocked != nil {
		return blocked
	}
	return fmt.Errorf("merge integration branch: %s", output)
}

func runSubmoduleSync(ctx context.Context, hostPath string, before []hostrepo.Submodule, sync func([]hostrepo.Submodule) hostrepo.SyncResult) hostrepo.SyncResult {
	if sync != nil {
		return sync(before)
	}
	result, _ := hostrepo.SyncSubmodules(ctx, hostPath, before)
	return result
}
