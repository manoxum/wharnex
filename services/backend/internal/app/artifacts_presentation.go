package app

import (
	"context"
	"errors"

	"kernl.local/harness/backend/internal/artifactpresentation"
)

func (s *Service) ArtifactPresentation(ctx context.Context, sessionID, artifactID string) (artifactpresentation.Presentation, error) {
	record, raw, err := s.ReadArtifact(ctx, sessionID, artifactID)
	if err != nil {
		return artifactpresentation.Presentation{}, err
	}
	if !record.Bundle {
		return artifactpresentation.Presentation{}, errors.New("artifact is not an explorable ZIP bundle")
	}
	return artifactpresentation.ParseBundle(raw)
}
