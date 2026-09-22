package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// compactionItemPause is the fixed pause CompactArchivedChats takes between
// sessions in one sweep. Go has no portable OS thread-priority API, so this
// plus strictly-sequential (never concurrent) processing is the honest
// "smooth"/throttled mechanism ADR-0031 relies on: it bounds burstiness and
// peak memory, it does not grant OS-level CPU niceness.
const compactionItemPause = 2 * time.Second

func archivePackageKey(sessionID string) string {
	return fmt.Sprintf("sessions/%s/archive-package", sessionID)
}

func restoredArtifactKey(sessionID, artifactID string) string {
	return fmt.Sprintf("sessions/%s/%s", sessionID, artifactID)
}

// ArchiveChat is an instant, idempotent state flip: closing a chat must
// never itself do heavy work (ADR-0031). The throttled CompactArchivedChats
// sweep is the only place that later folds the session's data into one
// package, and only once it has sat archived past the grace period.
//
// Closing a chat also disposes of whatever verified candidates it was still
// holding (ADR-0031): each one pins a whx/req_* branch in the operator's own
// repository that the startup orphan sweep deliberately retains for as long
// as the candidate is pending, so an abandoned candidate polluted the branch
// list permanently. The records are cleared in this same flip, because a
// candidate whose branch is gone can only produce an Apply that fails. Only
// the Git deletions run off this goroutine, so the flip itself stays instant.
func (s *Service) ArchiveChat(sessionID string) (domain.Session, error) {
	var disposed []domain.PendingHostChange
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		// Disposal rides the real nil -> set transition only: re-archiving an
		// already-archived session must stay the no-op this flip promises.
		if current.ArchivedAt != nil {
			disposed = nil
			return nil
		}
		now := time.Now().UTC()
		current.ArchivedAt = &now
		disposed = hostApplicablePendingChanges(pendingHostChanges(*current))
		current.PendingHostChanges = nil
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.bus.Publish(sessionID, "session.archived", map[string]any{})
	if len(disposed) > 0 {
		s.bus.Publish(sessionID, "host.pending_disposed", map[string]any{"reason": "chat_archived", "plan_count": len(disposed), "patch_count": pendingPatchCount(disposed)})
		go s.disposeIntegrationBranches(sessionID, updated.ProjectPath, disposed)
	}
	return updated, nil
}

// disposeIntegrationBranches releases the host branches behind candidates the
// owning chat has just abandoned. Best effort by contract: a branch that
// cannot be removed is reported and leaves the merge history untouched, and
// the candidate records are already cleared either way, so a failure here
// cannot resurrect an Apply the session no longer offers.
func (s *Service) disposeIntegrationBranches(sessionID, projectPath string, disposed []domain.PendingHostChange) {
	ctx := context.Background()
	branches := make([]string, 0, len(disposed))
	for _, change := range disposed {
		if branch := strings.TrimSpace(change.IntegrationBranch); branch != "" {
			branches = append(branches, branch)
		}
		if len(change.SubmoduleIntegrations) > 0 {
			s.deleteSubmoduleIntegrationBranches(ctx, sessionID, projectPath, change.SubmoduleIntegrations)
		}
	}
	if len(branches) > 0 {
		s.deleteIntegrationBranches(ctx, sessionID, projectPath, branches)
	}
}

// RestoreChat reopens an archived chat. Before compaction this is a pure
// state flip (the fast path the 72h grace period promises); once compacted
// it must extract the package back into place (the slow path, see
// restoreCompactedChat in chat_archive_restore.go).
func (s *Service) RestoreChat(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if item.ArchivedAt == nil {
		return item, nil
	}
	if item.CompactedAt != nil {
		return s.restoreCompactedChat(ctx, sessionID)
	}

	var strayPackage *domain.ArchivePackageRecord
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.ArchivedAt = nil
		strayPackage = current.ArchivePackage
		current.ArchivePackage = nil
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	// A compaction sweep may have already written its Phase 1 checkpoint
	// (ArchivePackage set) before this restore raced in ahead of Phase 2's
	// deletes. That checkpoint package is now orphaned: best-effort clean it
	// up so a future compaction of this session doesn't wrongly believe
	// Phase 1 is already done for a session whose artifacts have since
	// changed.
	if strayPackage != nil && s.artifactStore != nil {
		_ = s.artifactStore.Delete(ctx, strayPackage.ObjectKey)
	}
	s.bus.Publish(sessionID, "session.restored", map[string]any{})
	return updated, nil
}

// CompactArchivedChats is the throttled sweep: every session archived more
// than cutoff ago and not yet compacted is folded into one package,
// strictly one session at a time, with a pause between each.
func (s *Service) CompactArchivedChats(ctx context.Context, cutoff time.Time) error {
	if s.artifactStore == nil {
		return nil
	}
	var due []domain.Session
	for _, item := range s.store.List() {
		if item.ArchivedAt != nil && item.ArchivedAt.Before(cutoff) && item.CompactedAt == nil {
			due = append(due, item)
		}
	}
	var errs []error
	for index, item := range due {
		if err := s.compactOneSession(ctx, item.ID); err != nil {
			errs = append(errs, fmt.Errorf("compact session %s: %w", item.ID, err))
		}
		if index == len(due)-1 {
			break
		}
		select {
		case <-time.After(compactionItemPause):
		case <-ctx.Done():
			return errors.Join(append(errs, ctx.Err())...)
		}
	}
	return errors.Join(errs...)
}
