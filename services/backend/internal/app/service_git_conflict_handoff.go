package app

import (
	"context"
	"errors"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// markGitConflictAutoDispatch records that the operator's choice already
// covers sending this conflict's prompt. Integration conflicts are unaffected.
func markGitConflictAutoDispatch(conflict *domain.ConflictResolution) {
	if conflict != nil && conflict.Git != nil {
		conflict.Git.AutoDispatch = true
	}
}

// releaseGitConflict clears a Git-origin conflict record and the request that
// was waiting on it, leaving the session free for new work.
func releaseGitConflict(current *domain.Session, conflict *domain.ConflictResolution) {
	current.IntegrationConflict = nil
	current.ConflictAttempt = 0
	current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, conflict.RequestID)
	if current.LastRequestID == conflict.RequestID {
		current.LastManualPrompt = ""
	}
	if current.State == "conflict_resolution_pending" {
		current.State = "ready"
		clearSessionFailure(current)
	}
}

// HandOffGitConflict moves a Git-origin conflict from the session whose Git
// surface detected it into a dedicated session (and its own chat), so the
// resolution runs in a fresh conversation instead of inside unrelated work.
//
// The conflict is prepared anew on the target rather than copied: the request
// id, capsule artifact and expected bundle filename all belong to the chat
// that will receive the answer. The source is released only after the target
// holds the conflict, so a failure leaves the original record intact.
func (s *Service) HandOffGitConflict(ctx context.Context, sourceID, targetID string) (domain.Session, error) {
	source, err := s.store.Get(sourceID)
	if err != nil {
		return domain.Session{}, err
	}
	conflict := source.IntegrationConflict
	if conflict == nil || conflict.Git == nil {
		return domain.Session{}, errors.New("this session has no Git conflict to hand off")
	}
	if len(conflict.ManualPaths) > 0 {
		return domain.Session{}, errors.New("a partially hand-resolved conflict stays in its own chat")
	}
	target, err := s.store.Get(targetID)
	if err != nil {
		return domain.Session{}, err
	}
	if sourceID == targetID || target.ProjectPath != source.ProjectPath || strings.TrimSpace(target.ChatID) == "" {
		return domain.Session{}, errors.New("the dedicated conflict session must be another chat of the same project")
	}
	if target.IntegrationConflict != nil {
		return domain.Session{}, errors.New("the dedicated conflict session already holds a conflict")
	}
	g := conflict.Git
	prepared, _, err := s.prepareGitConflictResolution(ctx, targetID, target, gitConflictRequest{
		origin: g.Origin, ref: g.Ref, remote: g.Remote, remoteBranch: g.RemoteBranch, targetBranch: g.TargetBranch,
		sourceRefs: append([]string(nil), g.SourceRefs...),
		sides:      hostrepo.MergeSides{BaseSHA: g.BaseSHA, OursSHA: g.OursSHA, TheirsSHA: g.TheirsSHA, Ref: g.Ref},
		paths:      append([]string(nil), conflict.Paths...),
	})
	if err != nil {
		return domain.Session{}, err
	}
	dedicated, err := s.store.Update(targetID, func(current *domain.Session) error {
		markGitConflictAutoDispatch(current.IntegrationConflict)
		return nil
	})
	if err != nil {
		return prepared, err
	}
	if _, err := s.store.Update(sourceID, func(current *domain.Session) error {
		if current.IntegrationConflict != nil && current.IntegrationConflict.ID == conflict.ID {
			releaseGitConflict(current, conflict)
		}
		return nil
	}); err != nil {
		return dedicated, err
	}
	s.bus.Publish(sourceID, "git.conflict_handed_off", map[string]any{
		"conflict_id": conflict.ID, "target_session_id": targetID, "target_chat_id": target.ChatID,
		"target_conflict_id": dedicated.IntegrationConflict.ID, "ref": g.Ref, "origin": g.Origin,
	})
	return dedicated, nil
}
