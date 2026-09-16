package app

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrArtifactStorageFull = errors.New("artifact storage is full")

func (s *Service) putArtifactWithRecovery(ctx context.Context, key, contentType string, raw []byte) error {
	err := s.artifactStore.Put(ctx, key, contentType, raw)
	if err == nil || !isArtifactStorageFullDiagnostic(err.Error()) {
		return err
	}

	before := time.Now().UTC().Add(-time.Duration(s.ArtifactSettings().RetentionDays) * 24 * time.Hour)
	cleanupErr := s.CleanupArtifacts(ctx, before)
	retryErr := s.artifactStore.Put(ctx, key, contentType, raw)
	if retryErr == nil {
		return nil
	}
	if !isArtifactStorageFullDiagnostic(retryErr.Error()) {
		return retryErr
	}
	if cleanupErr != nil {
		return fmt.Errorf("%w: automatic cleanup also failed: %v", ErrArtifactStorageFull, cleanupErr)
	}
	return fmt.Errorf("%w after automatic cleanup", ErrArtifactStorageFull)
}
