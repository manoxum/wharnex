package app

import (
	"context"
	"errors"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

type ManagedArtifact struct {
	SessionID   string                `json:"session_id"`
	ProjectPath string                `json:"project_path"`
	ChatID      string                `json:"chat_id,omitempty"`
	Artifact    domain.ArtifactRecord `json:"artifact"`
}

// ListManagedArtifacts exposes the artifact metadata Wharnex already owns.
// Object keys and MinIO credentials intentionally remain server-only.
func (s *Service) ListManagedArtifacts(query string, bundlesOnly bool) []ManagedArtifact {
	query = strings.ToLower(strings.TrimSpace(query))
	items := make([]ManagedArtifact, 0)
	for _, session := range s.store.List() {
		for _, artifact := range session.Artifacts {
			if bundlesOnly && !artifact.Bundle {
				continue
			}
			if query != "" && !managedArtifactMatches(query, session, artifact) {
				continue
			}
			items = append(items, ManagedArtifact{
				SessionID: session.ID, ProjectPath: session.ProjectPath,
				ChatID: session.ChatID, Artifact: artifact,
			})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Artifact.CreatedAt.After(items[j].Artifact.CreatedAt) })
	return items
}

func managedArtifactMatches(query string, session domain.Session, artifact domain.ArtifactRecord) bool {
	values := []string{session.ID, session.ProjectPath, session.ChatID, artifact.ID, artifact.Name, artifact.RequestID, artifact.Direction, artifact.Kind, artifact.SHA256}
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	return false
}

func (s *Service) DeleteManagedArtifact(ctx context.Context, sessionID, artifactID string) error {
	record, err := s.artifactRecord(sessionID, artifactID)
	if err != nil {
		return err
	}
	if s.artifactStore == nil {
		return errors.New("artifact storage is unavailable")
	}
	if record.ObjectKey == "" {
		return errors.New("artifact object location is unavailable")
	}
	if err := s.artifactStore.Delete(ctx, record.ObjectKey); err != nil {
		return err
	}
	_, err = s.store.Update(sessionID, func(item *domain.Session) error {
		kept := item.Artifacts[:0]
		for _, candidate := range item.Artifacts {
			if candidate.ID != artifactID {
				kept = append(kept, candidate)
			}
		}
		item.Artifacts = kept
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "artifact.deleted", map[string]any{"artifact_id": artifactID, "name": record.Name})
	}
	return err
}
