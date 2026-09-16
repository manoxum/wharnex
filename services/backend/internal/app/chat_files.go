package app

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// ChatFile is one user-facing file exchanged in a chat. Bundle-backed files
// retain the parent artifact id plus their entry path so callers can preview,
// download, save or reattach them without exposing object-store locations.
type ChatFile struct {
	ArtifactID  string    `json:"artifact_id"`
	RequestID   string    `json:"request_id,omitempty"`
	Direction   string    `json:"direction"`
	Source      string    `json:"source"`
	Name        string    `json:"name"`
	Path        string    `json:"path,omitempty"`
	ContentType string    `json:"content_type,omitempty"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
	Direct      bool      `json:"direct"`
}

// ListChatFiles returns files that crossed the user/model boundary, rather than
// limiting the Files surface to response bundles. Transport-only context and
// durable library objects intentionally stay out of this chat-scoped list.
func (s *Service) ListChatFiles(ctx context.Context, sessionID string) ([]ChatFile, error) {
	artifacts, err := s.ListArtifacts(sessionID)
	if err != nil {
		return nil, err
	}
	files := make([]ChatFile, 0)
	seen := make(map[string]bool)
	appendFile := func(file ChatFile) {
		key := strings.Join([]string{file.RequestID, file.Direction, file.Source, file.Name, fmt.Sprintf("%d", file.Size)}, "\x00")
		if seen[key] {
			return
		}
		seen[key] = true
		files = append(files, file)
	}

	// Prefer direct records when both the direct attachment and the request ZIP
	// contain the same logical input. They have a simpler URL and preserve MIME.
	for _, artifact := range artifacts {
		if artifact.Bundle || !chatVisibleDirectArtifact(artifact) {
			continue
		}
		appendFile(ChatFile{
			ArtifactID: artifact.ID, RequestID: artifact.RequestID, Direction: artifact.Direction,
			Source: chatFileSource(artifact.Direction, artifact.Kind, ""), Name: artifact.Name,
			ContentType: artifact.ContentType, Size: artifact.Size, CreatedAt: artifact.CreatedAt, Direct: true,
		})
	}
	for _, artifact := range artifacts {
		if !artifact.Bundle {
			continue
		}
		entries, entryErr := s.ArtifactEntries(ctx, sessionID, artifact.ID)
		if entryErr != nil {
			continue
		}
		declaredMarkdown := s.declaredMarkdownPaths(ctx, sessionID, artifact)
		for _, entry := range entries {
			if entry.Dir || !chatVisibleBundleEntry(artifact.Direction, entry.Path, declaredMarkdown) {
				continue
			}
			name := filepath.Base(entry.Path)
			contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
			appendFile(ChatFile{
				ArtifactID: artifact.ID, RequestID: artifact.RequestID, Direction: artifact.Direction,
				Source: chatFileSource(artifact.Direction, artifact.Kind, entry.Path), Name: name, Path: entry.Path,
				ContentType: contentType, Size: entry.Size, CreatedAt: artifact.CreatedAt, Direct: false,
			})
		}
	}
	sort.SliceStable(files, func(i, j int) bool { return files[i].CreatedAt.After(files[j].CreatedAt) })
	return files, nil
}

func chatVisibleDirectArtifact(artifact domain.ArtifactRecord) bool {
	if isMarkdownPath(artifact.Name) {
		return false
	}
	switch artifact.Kind {
	case "context", "library", "bundle-preview":
		return false
	default:
		return true
	}
}

func chatVisibleBundleEntry(direction, entryPath string, declaredMarkdown map[string]bool) bool {
	clean := strings.TrimPrefix(filepath.ToSlash(entryPath), "/")
	visiblePrefix := strings.HasPrefix(clean, "artifacts/")
	if direction == "input" {
		visiblePrefix = strings.HasPrefix(clean, "attachments/") || visiblePrefix
	}
	if !visiblePrefix {
		return false
	}
	return !isMarkdownPath(clean) || declaredMarkdown[clean]
}

func isMarkdownPath(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".mdx", ".markdown":
		return true
	default:
		return false
	}
}

func (s *Service) declaredMarkdownPaths(ctx context.Context, sessionID string, artifact domain.ArtifactRecord) map[string]bool {
	declared := map[string]bool{}
	if artifact.Direction != "output" {
		return declared
	}
	presentation, err := s.ArtifactPresentation(ctx, sessionID, artifact.ID)
	if err != nil || presentation.Fallback {
		return declared
	}
	for _, gallery := range presentation.Galleries {
		for _, item := range gallery.Items {
			if item.Kind == "markdown" {
				declared[strings.TrimPrefix(filepath.ToSlash(item.Path), "/")] = true
			}
		}
	}
	return declared
}

func chatFileSource(direction, kind, entryPath string) string {
	clean := strings.TrimPrefix(filepath.ToSlash(entryPath), "/")
	if strings.HasPrefix(clean, "attachments/") || kind == "attachment" {
		return "attachment"
	}
	if direction == "output" || strings.HasPrefix(clean, "artifacts/") {
		return "returned"
	}
	return "system"
}

// SaveChatFileToLibrary copies a chat-visible file into the durable library.
// The copy deliberately gets kind=library so retention cleanup can preserve it
// independently from the transport object it originated from.
func (s *Service) SaveChatFileToLibrary(ctx context.Context, sessionID, artifactID, entryPath string) (domain.ArtifactRecord, error) {
	var (
		raw         []byte
		name        string
		contentType string
		requestID   string
	)
	if strings.TrimSpace(entryPath) == "" {
		record, data, err := s.ReadArtifact(ctx, sessionID, artifactID)
		if err != nil {
			return domain.ArtifactRecord{}, err
		}
		if record.Bundle || !chatVisibleDirectArtifact(record) {
			return domain.ArtifactRecord{}, errors.New("artifact is not a chat-visible file")
		}
		raw, name, contentType, requestID = data, record.Name, record.ContentType, record.RequestID
	} else {
		record, err := s.artifactRecord(sessionID, artifactID)
		if err != nil {
			return domain.ArtifactRecord{}, err
		}
		if !record.Bundle || !chatVisibleBundleEntry(record.Direction, entryPath, s.declaredMarkdownPaths(ctx, sessionID, record)) {
			return domain.ArtifactRecord{}, errors.New("bundle entry is not a chat-visible file")
		}
		data, entryName, err := s.ReadArtifactEntry(ctx, sessionID, artifactID, entryPath)
		if err != nil {
			return domain.ArtifactRecord{}, err
		}
		raw, name, requestID = data, entryName, record.RequestID
		contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	}
	return s.PersistArtifact(ctx, sessionID, requestID, "input", "library", name, contentType, raw)
}
