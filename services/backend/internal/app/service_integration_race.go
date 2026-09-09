package app

import (
	"context"
	"errors"
	"fmt"

	"kernl.local/harness/backend/internal/changeset"
	"kernl.local/harness/backend/internal/domain"
)

// escalateExhaustedIntegrationRace converts a compare-and-swap race that
// survived every restage attempt into the ordinary focused conflict path.
//
// A retryable race means the host's value for a path changed between staging
// and writing. Retrying is right the first few times, because an unrelated
// one-off write really can lose to a restage. But once the same path has raced
// through every attempt, the candidate and the host have genuinely diverged
// there, and the operation is definitionally non-convergent: Apply replays the
// same diff against the same host and observes the same mismatch, forever. The
// previous behavior classified that as "host concurrency, safe to retry",
// which offered the operator a retry button whose only possible outcome was
// the identical failure, and no way to involve the planner at all.
//
// Escalating instead reuses the machinery that already exists for divergence:
// a bounded harness.conflict/v1 capsule carrying BASE (what the candidate was
// built on), CURRENT (what the host actually holds now) and RESULT (what the
// candidate intended), scoped to exactly the racing paths.
//
// Returns escalated=false when no owning ChangeSet can be attributed to the
// racing path, in which case the caller keeps the previous error classification
// rather than inventing a conflict with nothing to resolve against.
func (s *Service) escalateExhaustedIntegrationRace(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange, cause error) (domain.Session, bool, error) {
	conflicts := racingConflictDetails(pending, cause)
	if len(conflicts) == 0 {
		return item, false, nil
	}
	s.bus.Publish(sessionID, "integration.race_escalated", map[string]any{
		"paths": conflictPaths(conflicts), "reason": "compare-and-swap race persisted across every restage attempt",
	})
	updated, err := s.prepareConflictResolution(ctx, sessionID, item, pending, conflicts)
	if err != nil {
		return item, false, fmt.Errorf("prepare focused conflict resolution after exhausted integration race: %w", err)
	}
	return updated, true, nil
}

// racingConflictDetails names the paths a persistent race is about, attributed
// to the pending ChangeSet that owns each one so the capsule can be built from
// that candidate's own base/result content.
func racingConflictDetails(pending []domain.PendingHostChange, cause error) []domain.IntegrationConflictDetail {
	var race *changeset.ExternalWriteRaceError
	if !errors.As(cause, &race) || race.Path == "" {
		return nil
	}
	changeSetID := changeSetIDForPath(pending, race.Path)
	if changeSetID == "" {
		return nil
	}
	return []domain.IntegrationConflictDetail{{
		ChangeSetID: changeSetID,
		Path:        race.Path,
		Reason:      "host changed this path repeatedly while the verified change was being integrated",
	}}
}

// changeSetIDForPath finds which pending ChangeSet declares a mutation at a
// path. The inverse of mutationForConflict, needed because a compare-and-swap
// race is reported by path while the capsule is assembled per ChangeSet.
func changeSetIDForPath(pending []domain.PendingHostChange, path string) string {
	for _, change := range pending {
		if change.ChangeSet == nil {
			continue
		}
		for _, mutation := range change.ChangeSet.Mutations {
			if mutation.Path == path {
				return change.ChangeSet.ID
			}
		}
	}
	return ""
}
