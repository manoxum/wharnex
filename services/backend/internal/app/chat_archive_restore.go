package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"kernl.local/harness/backend/internal/chatarchive"
	"kernl.local/harness/backend/internal/domain"
)

// restoreCompactedChat reverses compaction: download the package, verify
// it, unpack it, re-upload every artifact and re-append every event, and
// only once all of that has fully succeeded does it commit the session
// update and delete the package. A failure at any earlier step leaves the
// session exactly as compacted, safe to retry.
func (s *Service) restoreCompactedChat(ctx context.Context, sessionID string) (domain.Session, error) {
	if s.artifactStore == nil {
		return domain.Session{}, errors.New("artifact storage is unavailable")
	}
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if item.ArchivePackage == nil {
		return domain.Session{}, errors.New("archived chat is missing its compacted package")
	}
	s.bus.Publish(sessionID, "session.restore_extracting", map[string]any{})

	raw, _, err := s.artifactStore.Get(ctx, item.ArchivePackage.ObjectKey)
	if err != nil {
		return domain.Session{}, fmt.Errorf("download chat archive package: %w", err)
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != item.ArchivePackage.SHA256 {
		return domain.Session{}, errors.New("chat archive package failed integrity verification")
	}
	pkg, err := chatarchive.Unpack(bytes.NewReader(raw))
	if err != nil {
		return domain.Session{}, fmt.Errorf("unpack chat archive package: %w", err)
	}

	restoredArtifacts := make([]domain.ArtifactRecord, 0, len(pkg.Manifest.Artifacts))
	for _, record := range pkg.Manifest.Artifacts {
		body, ok := pkg.Artifacts[record.ID]
		if !ok {
			return domain.Session{}, fmt.Errorf("chat archive package is missing artifact %s", record.ID)
		}
		key := restoredArtifactKey(sessionID, record.ID)
		if err := s.artifactStore.Put(ctx, key, record.ContentType, body); err != nil {
			return domain.Session{}, fmt.Errorf("restore artifact %s: %w", record.ID, err)
		}
		record.ObjectKey = key
		restoredArtifacts = append(restoredArtifacts, record)
	}

	for _, event := range pkg.Events {
		if err := s.store.AppendEvent(event); err != nil {
			return domain.Session{}, fmt.Errorf("restore event %s: %w", event.ID, err)
		}
	}

	restoredContext := make(map[string]string, len(pkg.ContextFiles))
	if len(pkg.ContextFiles) > 0 {
		contextDir, err := os.MkdirTemp("", "wharness-context-*")
		if err != nil {
			return domain.Session{}, fmt.Errorf("create restored context directory: %w", err)
		}
		for requestID, body := range pkg.ContextFiles {
			path := filepath.Join(contextDir, requestID+".zip")
			if err := os.WriteFile(path, body, 0o600); err != nil {
				return domain.Session{}, fmt.Errorf("restore context archive %s: %w", requestID, err)
			}
			restoredContext[requestID] = path
		}
	}

	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.Artifacts = restoredArtifacts
		current.RequestContextArchives = restoredContext
		current.ArchivedAt = nil
		current.CompactedAt = nil
		current.ArchivePackage = nil
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	// Only delete the package once the restore fully committed above; a
	// crash before this point leaves the package intact for a retry.
	_ = s.artifactStore.Delete(ctx, item.ArchivePackage.ObjectKey)
	s.bus.Publish(sessionID, "session.restored", map[string]any{})
	return updated, nil
}
