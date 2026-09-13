package app

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// maxConflictIntentChanges bounds how many already-integrated changes are
// described back to the resolver. A conflict is about a small number of
// colliding edits; an unbounded history would crowd out the file content that
// the resolution actually has to be written against.
const maxConflictIntentChanges = 8

// buildConflictIntent assembles why both sides of a collision exist.
//
// Three versions of a file describe what differs. They do not say which
// reconciliation is correct — that depends on what each side was for, and a
// resolver given only text has to infer purpose from the diff, which is
// exactly where a textual "fix" that silently drops the other side's behavior
// comes from. Both purposes are already recorded and cost nothing to attach:
// this candidate's own planner-authored summary and commit message, and the
// commit subjects of the already-integrated changes it collides with, which
// the protocol obliges every change plan to write as meaningful history.
func (s *Service) buildConflictIntent(ctx context.Context, item domain.Session, repoPath string, conflict *sandbox.MergeConflictError, paths []string) *conflictCapsuleIntent {
	intent := &conflictCapsuleIntent{
		Attempt:     item.ConflictAttempt + 1,
		MaxAttempts: policyForEffort(item.EffortLevel).MaxAttempts,
	}
	if item.Plan != nil {
		intent.OurGoal = strings.TrimSpace(item.Plan.Summary)
		intent.OurCommitMessage = strings.TrimSpace(item.Plan.CommitMessage)
	}
	if item.IntegrationConflict != nil {
		intent.PreviousAttempts = append([]string(nil), item.IntegrationConflict.AttemptHistory...)
	}
	if conflict != nil {
		// The incoming side's history lives in the repository the conflict
		// happened in, addressed by that repository's own paths.
		unitRepo := sandbox.UnitRepoPath(repoPath, conflict.Unit)
		unitPaths := make([]string, 0, len(paths))
		for _, path := range paths {
			unitPaths = append(unitPaths, sandbox.UnitRelativePath(conflict.Unit, path))
		}
		changes, err := sandbox.CommitsTouching(ctx, unitRepo, conflict.MergeBaseSHA, conflict.HostSHA, unitPaths)
		if err == nil {
			for index, change := range changes {
				if index >= maxConflictIntentChanges {
					break
				}
				intent.IncomingChanges = append(intent.IncomingChanges, conflictCapsuleChange{
					Commit: shortCommit(change.SHA), Purpose: change.Subject,
				})
			}
		}
	}
	return intent
}

// conflictAttemptRecord is the one-line description of an attempt that is
// carried into the next round of the same conflict, so a resolver can see
// which reconciliations have already been tried and failed.
func conflictAttemptRecord(item domain.Session, paths []string) string {
	goal := ""
	if item.Plan != nil {
		goal = strings.TrimSpace(item.Plan.CommitMessage)
		if goal == "" {
			goal = strings.TrimSpace(item.Plan.Summary)
		}
	}
	if goal == "" {
		goal = "unnamed change"
	}
	return fmt.Sprintf("attempt %d: %q still collided on %s", item.ConflictAttempt+1, goal, strings.Join(paths, ", "))
}

// intentHistory returns the attempt history already accumulated for the
// conflict currently in progress, or nil when this is the first round.
func intentHistory(item domain.Session) []string {
	if item.IntegrationConflict == nil {
		return nil
	}
	return append([]string(nil), item.IntegrationConflict.AttemptHistory...)
}

func shortCommit(sha string) string {
	sha = strings.TrimSpace(sha)
	if len(sha) > 12 {
		return sha[:12]
	}
	return sha
}

// appendConflictAttempt bounds the retained history so a long-running conflict
// cannot grow the capsule without limit; the oldest entries are dropped first
// because the most recent failures are the informative ones.
func appendConflictAttempt(history []string, record string) []string {
	history = append(history, record)
	if len(history) > maxAutoRepairAttempts+1 {
		history = append([]string(nil), history[len(history)-(maxAutoRepairAttempts+1):]...)
	}
	return history
}
