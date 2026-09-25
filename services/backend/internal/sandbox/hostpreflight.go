package sandbox

import (
	"context"
	"path/filepath"
	"strings"
)

// PreflightMergeIntoHost answers whether merging branch into the host would
// conflict, against the host's real current content — committed and
// uncommitted alike — while leaving the host completely untouched.
//
// It compares against a throwaway commit of the working tree rather than bare
// HEAD because the real merge commits that same dirty state first
// (snapshotUncommittedHostState); preflighting against HEAD alone would miss a
// conflict with an operator's uncommitted edit and report a false "clean".
//
// A nil error with a nil conflict means the merge is expected to succeed, the
// only predicted conflicts are Wharnex-managed knowledge (which the real merge
// preserves from the host locally), or this Git build cannot answer. The real
// merge stays authoritative: this exists so a merge already known to be doomed
// on planner-resolvable paths never reaches the host and never leaves a
// pre-merge snapshot commit behind for nothing.
func PreflightMergeIntoHost(ctx context.Context, hostPath, branch string) (*MergeConflictError, error) {
	return PreflightMergeIntoHostExcept(ctx, hostPath, branch, "", nil)
}

// PreflightMergeIntoHostExcept is PreflightMergeIntoHost with the gitlinks of
// the submodules this same integration is about to merge treated as
// already-decided rather than as conflicts.
//
// The superproject's branch records each submodule at the commit the SANDBOX
// made; the host records wherever its own copy is. A dry-run merge of the
// superproject alone therefore reports a gitlink conflict whenever a submodule
// moved on either side — which is exactly the case this whole mechanism exists
// to handle, and which the real repository-tree transaction reconciles by
// selecting the proven descendant gitlink locally. Counting it as an ordinary
// conflict would abort a legitimate integration and hand a planner a commit id
// to patch (adr/ADR-0039).
func PreflightMergeIntoHostExcept(ctx context.Context, hostPath, branch, requestBaseRef string, integratingUnits []string) (*MergeConflictError, error) {
	comparison, err := CaptureWorkingTreeCommit(ctx, hostPath, "Wharnex merge preflight")
	if err != nil {
		return nil, err
	}
	// The same base the real merge will use, so the preflight predicts that
	// merge rather than a different one (see CandidateMergeBase).
	mergeBase := candidateMergeBaseOrRef(ctx, hostPath, branch, requestBaseRef)
	preflight, err := PreflightMergeFrom(ctx, hostPath, mergeBase, comparison, branch)
	if err != nil || !preflight.Supported || preflight.Clean {
		return nil, err
	}
	_, ordinary := partitionManagedMergePaths(preflight.ConflictPaths)
	ordinary = withoutIntegratingUnits(ordinary, integratingUnits)
	if len(ordinary) == 0 {
		return nil, nil
	}
	if mergeBase == "" {
		mergeBase, _ = runGit(ctx, hostPath, "merge-base", comparison, branch)
	}
	return &MergeConflictError{Paths: ordinary, Branch: branch, HostSHA: comparison, MergeBaseSHA: mergeBase}, nil
}

// withoutIntegratingUnits removes only the gitlink paths for submodules that
// this same host integration is already merging independently. A nested file
// path is not equivalent to the gitlink itself and must remain an ordinary
// conflict for the caller to resolve.
func withoutIntegratingUnits(paths, integratingUnits []string) []string {
	if len(paths) == 0 || len(integratingUnits) == 0 {
		return paths
	}
	integrating := make(map[string]struct{}, len(integratingUnits))
	for _, unit := range integratingUnits {
		unit = filepath.ToSlash(filepath.Clean(strings.TrimSpace(unit)))
		unit = strings.TrimPrefix(unit, "./")
		if unit == "" || unit == "." {
			continue
		}
		integrating[unit] = struct{}{}
	}
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		normalized := filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
		normalized = strings.TrimPrefix(normalized, "./")
		if _, ignored := integrating[normalized]; ignored {
			continue
		}
		out = append(out, path)
	}
	return out
}
