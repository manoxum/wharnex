package app

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// A Git-origin conflict is a request to finish one specific merge. Once the
// incoming side is already reachable from the branch that merge would have
// advanced — because the operator merged it by hand, pulled it, or a later
// Wharnex merge succeeded — there is nothing left to reconcile. Keeping the
// record anyway blocks Apply (an active integration conflict is an Apply
// guard) and turns the eventual planner answer into a replay of a merge that
// no longer exists, which fails with "nothing to commit".

// gitConflictDestination names the ref the recorded merge would have advanced.
func gitConflictDestination(g *domain.GitConflictContext) string {
	target := strings.TrimSpace(g.TargetBranch)
	if g.Origin == domain.GitConflictOriginRemoteMerge && target != "" {
		return "refs/remotes/" + target
	}
	if target != "" {
		return "refs/heads/" + target
	}
	return "HEAD"
}

func gitConflictObsolete(ctx context.Context, projectPath string, g *domain.GitConflictContext) bool {
	if g == nil || strings.TrimSpace(g.TheirsSHA) == "" {
		return false
	}
	return hostrepo.IsAncestor(ctx, projectPath, g.TheirsSHA, gitConflictDestination(g))
}

// retireObsoleteGitConflict clears a Git-origin conflict whose merge has
// already landed. It reports whether the record was retired.
func (s *Service) retireObsoleteGitConflict(ctx context.Context, sessionID string, item domain.Session) (domain.Session, bool) {
	conflict := item.IntegrationConflict
	if conflict == nil || conflict.Git == nil || !gitConflictObsolete(ctx, item.ProjectPath, conflict.Git) {
		return item, false
	}
	retired := false
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if current.IntegrationConflict == nil || current.IntegrationConflict.ID != conflict.ID {
			return nil
		}
		retired = true
		releaseGitConflict(current, conflict)
		return nil
	})
	if err != nil || !retired {
		return item, false
	}
	s.bus.Publish(sessionID, "git.conflict_obsolete", map[string]any{
		"conflict_id": conflict.ID, "request_id": conflict.RequestID, "origin": conflict.Git.Origin,
		"ref": conflict.Git.Ref, "destination": gitConflictDestination(conflict.Git),
	})
	return updated, true
}

// retireObsoleteGitConflictByID is the entry point for callers that only hold
// the session id, such as a Git operation that has just succeeded.
func (s *Service) retireObsoleteGitConflictByID(ctx context.Context, sessionID string) {
	if item, err := s.store.Get(sessionID); err == nil {
		s.retireObsoleteGitConflict(ctx, sessionID, item)
	}
}

// ignoreObsoleteConflictAnswer drops a planner answer to a conflict request
// whose conflict no longer exists. Without it the answer would fall through
// to the ordinary change path and be planned — and, in an automatic mode,
// applied — as if it were new work.
func (s *Service) ignoreObsoleteConflictAnswer(sessionID string, current domain.Session, requestID string) (BundleSubmission, bool, error) {
	lineage, ok := current.RequestLineages[requestID]
	if !ok || lineage.Kind != requestKindConflict || current.IntegrationConflict != nil {
		return BundleSubmission{}, false, nil
	}
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, requestID)
		return nil
	})
	if err != nil {
		return BundleSubmission{}, true, err
	}
	s.releaseRemoteInputLease(sessionID, requestID)
	s.bus.Publish(sessionID, "conflict.bundle_obsolete", map[string]any{"request_id": requestID})
	return BundleSubmission{Session: updated, AutoError: fmt.Sprintf("ignored conflict resolution for request %s; the conflict it answered is no longer open", requestID)}, true, nil
}
