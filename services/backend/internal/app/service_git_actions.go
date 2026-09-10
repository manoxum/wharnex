package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/pendingcommit"
)

// ErrPendingCommitBlocked reports a selective commit that would silently fold
// an earlier, unselected change into it.
var ErrPendingCommitBlocked = errors.New("committing this selection would absorb an earlier pending change on the same path")

// GitCommitOutcome is one pending record's fate in a commit run.
type GitCommitOutcome struct {
	PendingID string `json:"pending_id"`
	Subject   string `json:"subject"`
	CommitSHA string `json:"commit_sha,omitempty"`
	Skipped   string `json:"skipped,omitempty"`
}

// GitCommitResult reports a whole commit run.
type GitCommitResult struct {
	Outcomes []GitCommitOutcome `json:"outcomes"`
	// Blocked names earlier pending records the selection must include before
	// it can proceed. Non-empty means nothing was committed.
	Blocked []string `json:"blocked,omitempty"`
}

// CommitPending commits pending records, all of them or a chosen subset.
//
// The selection is validated before anything is committed, because committing
// a path takes its current working-tree content — which already contains every
// earlier change to that path. Committing a later record alone would therefore
// fold an earlier one into it under the wrong message, producing history that
// misattributes work rather than merely being incomplete. That is refused with
// the blocking records named, so the operator can widen the selection instead
// of discovering the mislabelling later in a review.
func (s *Service) CommitPending(ctx context.Context, sessionID string, pendingIDs []string) (GitCommitResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitCommitResult{}, err
	}
	if s.pendingCommits == nil {
		return GitCommitResult{}, errors.New("the pending-commit store is not configured")
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()

	records, err := s.pendingCommits.List(item.ProjectPath)
	if err != nil {
		return GitCommitResult{}, err
	}
	if len(records) == 0 {
		return GitCommitResult{}, errors.New("there are no pending commits for this project")
	}
	selected := records
	if len(pendingIDs) > 0 {
		matched, missing := pendingcommit.Select(records, pendingIDs)
		if len(missing) > 0 {
			return GitCommitResult{}, fmt.Errorf("unknown pending commit(s): %s", strings.Join(missing, ", "))
		}
		selected = matched
	}
	chosen := make(map[string]bool, len(selected))
	for _, record := range selected {
		chosen[record.ID] = true
	}
	if blockers := pendingcommit.BlockingPredecessors(records, chosen); len(blockers) > 0 {
		subjects := make([]string, 0, len(blockers))
		blocked := make([]string, 0, len(blockers))
		for _, blocker := range blockers {
			subjects = append(subjects, blocker.Subject)
			blocked = append(blocked, blocker.ID)
		}
		return GitCommitResult{Blocked: blocked}, fmt.Errorf("%w: include %s first", ErrPendingCommitBlocked, strings.Join(subjects, "; "))
	}

	result := GitCommitResult{Outcomes: make([]GitCommitOutcome, 0, len(selected))}
	committed := make([]string, 0, len(selected))
	for _, record := range selected {
		outcome := GitCommitOutcome{PendingID: record.ID, Subject: record.Subject}
		changed, changedErr := hostrepo.PathsWithChanges(ctx, item.ProjectPath, record.Paths)
		if changedErr != nil {
			return result, changedErr
		}
		if len(changed) == 0 {
			// The operator already dealt with these files themselves, in their
			// own terminal or editor. The record describes nothing, so it is
			// retired rather than kept as a permanent phantom entry.
			outcome.Skipped = "these paths no longer differ from HEAD"
			result.Outcomes = append(result.Outcomes, outcome)
			committed = append(committed, record.ID)
			continue
		}
		sha, commitErr := hostrepo.CommitPaths(ctx, item.ProjectPath, record.Message, record.Paths)
		if errors.Is(commitErr, hostrepo.ErrNothingToCommit) {
			outcome.Skipped = "nothing left to commit for these paths"
			result.Outcomes = append(result.Outcomes, outcome)
			committed = append(committed, record.ID)
			continue
		}
		if commitErr != nil {
			// Records already committed in this run stay committed and are
			// retired; stopping here leaves the rest queued rather than
			// half-applying the selection twice on a retry.
			_, _ = s.pendingCommits.Remove(item.ProjectPath, committed)
			return result, commitErr
		}
		outcome.CommitSHA = sha
		result.Outcomes = append(result.Outcomes, outcome)
		committed = append(committed, record.ID)
		s.bus.Publish(sessionID, "git.pending_committed", map[string]any{"pending_id": record.ID, "commit": sha, "subject": record.Subject})
	}
	if _, err := s.pendingCommits.Remove(item.ProjectPath, committed); err != nil {
		return result, err
	}
	return result, nil
}

// DiscardPending removes pending records without touching the working tree.
//
// It drops only Wharnex's note about what the change was for; the change
// itself stays exactly where it is. Deleting the operator's files because they
// dismissed a reminder would be a wildly disproportionate reading of the
// action, so discarding is deliberately only ever a bookkeeping operation.
func (s *Service) DiscardPending(sessionID string, pendingIDs []string) (int, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return 0, err
	}
	if len(pendingIDs) == 0 {
		return 0, errors.New("at least one pending commit id is required")
	}
	removed, err := s.pendingCommits.Remove(item.ProjectPath, pendingIDs)
	if err != nil {
		return 0, err
	}
	s.bus.Publish(sessionID, "git.pending_discarded", map[string]any{"count": removed, "note": "records only; the working tree is untouched"})
	return removed, nil
}
