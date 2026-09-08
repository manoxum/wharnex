package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"kernl.local/harness/backend/internal/chatarchive"
	"kernl.local/harness/backend/internal/domain"
)

// compactOneSession runs the crash-safe two-phase compaction for one
// session. Phase 1 (pack + upload + checkpoint) is skipped when a prior
// attempt already left a checkpoint (ArchivePackage set); Phase 2/3
// (delete originals, finalize) is always retried until it fully succeeds.
// Never advances past a checkpoint until the destructive step after it has
// confirmed success.
func (s *Service) compactOneSession(ctx context.Context, sessionID string) error {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	if item.ArchivedAt == nil || item.CompactedAt != nil {
		return nil
	}
	if item.ArchivePackage == nil {
		if err := s.compactPhaseOnePack(ctx, item); err != nil {
			return err
		}
		item, err = s.store.Get(sessionID)
		if err != nil {
			return err
		}
		if item.ArchivePackage == nil {
			// Restored mid-flight (see the checkpoint guard below): nothing
			// left to compact.
			return nil
		}
	}
	return s.compactPhaseTwoAndThree(ctx, item)
}

// compactPhaseOnePack gathers every backend-owned byte for item, packs and
// compresses them via chatarchive.Build, uploads the single package, and
// checkpoints its location on the session. The checkpoint write is guarded
// against a restore racing in ahead of it: if ArchivedAt has gone nil by the
// time the checkpoint would land, the just-uploaded package is deleted
// instead of being attached to a session that is no longer archived.
func (s *Service) compactPhaseOnePack(ctx context.Context, item domain.Session) error {
	artifacts := make(map[string][]byte, len(item.Artifacts))
	for _, record := range item.Artifacts {
		if record.ObjectKey == "" {
			continue
		}
		raw, _, err := s.artifactStore.Get(ctx, record.ObjectKey)
		if err != nil {
			return fmt.Errorf("fetch artifact %s: %w", record.ID, err)
		}
		artifacts[record.ID] = raw
	}
	contextFiles := make(map[string][]byte, len(item.RequestContextArchives))
	for requestID, path := range item.RequestContextArchives {
		raw, err := os.ReadFile(path)
		if err != nil {
			// Best-effort: these are ephemeral working files that may
			// already be gone by the time compaction runs, days later.
			continue
		}
		contextFiles[requestID] = raw
	}
	events, err := s.store.EventHistory(item.ID)
	if err != nil {
		return fmt.Errorf("read session events: %w", err)
	}

	manifest := chatarchive.Manifest{SessionID: item.ID, CreatedAt: time.Now().UTC(), Artifacts: item.Artifacts}
	var buf bytes.Buffer
	hasher := sha256.New()
	entryCount, err := chatarchive.Build(io.MultiWriter(&buf, hasher), manifest, events, artifacts, contextFiles)
	if err != nil {
		return fmt.Errorf("build chat archive package: %w", err)
	}

	key := archivePackageKey(item.ID)
	if err := s.artifactStore.Put(ctx, key, "application/zstd", buf.Bytes()); err != nil {
		return fmt.Errorf("upload chat archive package: %w", err)
	}
	record := domain.ArchivePackageRecord{ObjectKey: key, SHA256: hex.EncodeToString(hasher.Sum(nil)), Size: int64(buf.Len()), EntryCount: entryCount, CreatedAt: time.Now().UTC()}

	checkpointed := false
	if _, err := s.store.Update(item.ID, func(current *domain.Session) error {
		if current.ArchivedAt == nil {
			return nil
		}
		current.ArchivePackage = &record
		checkpointed = true
		return nil
	}); err != nil {
		return fmt.Errorf("checkpoint chat archive package: %w", err)
	}
	if !checkpointed {
		_ = s.artifactStore.Delete(ctx, key)
	}
	return nil
}

// compactPhaseTwoAndThree deletes every source the checkpointed package now
// covers, then finalizes the session. It is idempotent/retriable: a MinIO
// 404 on delete is already treated as success by the object-store adapter,
// deleting zero event rows is a no-op, and a missing context file is
// ignored — so a partial prior attempt can safely resume here without
// re-uploading anything.
func (s *Service) compactPhaseTwoAndThree(ctx context.Context, item domain.Session) error {
	var errs []error
	for _, record := range item.Artifacts {
		if record.ObjectKey == "" {
			continue
		}
		if err := s.artifactStore.Delete(ctx, record.ObjectKey); err != nil {
			errs = append(errs, fmt.Errorf("delete original artifact %s: %w", record.ID, err))
		}
	}
	if err := s.store.DeleteSessionEvents(item.ID); err != nil {
		errs = append(errs, fmt.Errorf("delete session events: %w", err))
	}
	for _, path := range item.RequestContextArchives {
		_ = os.Remove(path)
	}
	if len(errs) > 0 {
		// Left parked with ArchivePackage set, CompactedAt nil: the next
		// sweep tick retries only this phase, per compactOneSession.
		return errors.Join(errs...)
	}

	now := time.Now().UTC()
	if _, err := s.store.Update(item.ID, func(current *domain.Session) error {
		current.Artifacts = nil
		current.RequestContextArchives = nil
		current.CompactedAt = &now
		return nil
	}); err != nil {
		return fmt.Errorf("finalize chat archive compaction: %w", err)
	}
	entryCount, bytesTotal := 0, int64(0)
	if item.ArchivePackage != nil {
		entryCount, bytesTotal = item.ArchivePackage.EntryCount, item.ArchivePackage.Size
	}
	s.bus.Publish(item.ID, "session.archive_compacted", map[string]any{"entry_count": entryCount, "bytes": bytesTotal})
	return nil
}
