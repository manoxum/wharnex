package app

import (
	"context"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// extendConflictWithLiveDrift asks Git itself — via an offline merge-tree
// preflight, never planner prose or a patch tool's stdout — which paths a
// fresh merge of this thread's candidate into the CURRENT host HEAD would
// actually conflict on, and folds any path beyond what the thread already
// owns into it.
//
// The path set a conflict thread was opened with is a snapshot. Further host
// commits between rounds can push more of the same candidate's paths out of
// sync — observed in production as three UI files a resolution round's own
// replay failed on while the open capsule still authorized only one file
// (see ADR-0065's amendment). A resolver only receives the paths a capsule
// names, so a stale set there is not an approximation of the problem; it is
// a request that cannot be answered. Every new path is given the same
// CandidateSHA/MergeBaseSHA an already-known path already recorded, since a
// drifted path belongs to the exact same one candidate commit, never a
// separate collision.
//
// Returns the original conflict unchanged when the preflight is unsupported,
// reports the merge as clean, or names no path outside the existing set —
// the caller then keeps ADR-0054's byte-identical retry for a genuinely
// unchanged path set.
func extendConflictWithLiveDrift(ctx context.Context, repoPath, hostSHA string, conflict *domain.ConflictResolution) *domain.ConflictResolution {
	candidateSHA := ""
	if conflict.Git != nil {
		candidateSHA = conflict.Git.TheirsSHA
	} else {
		for _, source := range conflict.PathSources {
			candidateSHA = source.CandidateSHA
			break
		}
	}
	if strings.TrimSpace(candidateSHA) == "" {
		return conflict
	}
	// Measured from the candidate's own request base, as the real merge is, so
	// operator work that predates the candidate is never counted as drift.
	mergeBase := sandbox.CandidateMergeBase(ctx, repoPath, candidateSHA)
	preflight, err := sandbox.PreflightMergeFrom(ctx, repoPath, mergeBase, hostSHA, candidateSHA)
	if err != nil || !preflight.Supported || preflight.Clean {
		return conflict
	}
	known := make(map[string]bool, len(conflict.Paths))
	for _, path := range conflict.Paths {
		known[path] = true
	}
	var newPaths []string
	for _, path := range preflight.ConflictPaths {
		if !known[path] {
			newPaths = append(newPaths, path)
		}
	}
	if len(newPaths) == 0 {
		return conflict
	}
	var fresh domain.ConflictPathSource
	for _, source := range conflict.PathSources {
		fresh = source
		break
	}
	extended := *conflict
	extended.Paths = normalizedPaths(append(append([]string(nil), conflict.Paths...), newPaths...))
	extended.PathSources = make(map[string]domain.ConflictPathSource, len(conflict.PathSources)+len(newPaths))
	for path, source := range conflict.PathSources {
		extended.PathSources[path] = source
	}
	for _, path := range newPaths {
		extended.PathSources[path] = fresh
	}
	return &extended
}

// conflictNeedsCapsuleExtension reports whether the session's open conflict
// thread is missing a path the live host would actually conflict on, per
// extendConflictWithLiveDrift. It is the decision point between the cheap
// same-capsule retry ADR-0054 describes and a full refreshConflictCapsule
// rebuild: only the latter can add an authorized path.
func (s *Service) conflictNeedsCapsuleExtension(ctx context.Context, item domain.Session) bool {
	conflict := item.IntegrationConflict
	if conflict == nil {
		return false
	}
	hostSHA, err := sandbox.ResolveRef(ctx, item.ProjectPath, "HEAD")
	if err != nil {
		return false
	}
	extended := extendConflictWithLiveDrift(ctx, item.ProjectPath, hostSHA, conflict)
	return len(extended.Paths) > len(conflict.Paths)
}
