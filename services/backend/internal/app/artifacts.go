package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

const (
	defaultArtifactRetentionDays   = 30
	defaultRequestBundleTotalBytes = int64(100 << 20)
	defaultRequestBundlePartBytes  = int64(30 << 20)
	defaultRequestBundlePartLimit  = 10
)

type ArtifactObjectStore interface {
	Put(context.Context, string, string, []byte) error
	Get(context.Context, string) ([]byte, string, error)
	Delete(context.Context, string) error
}

type ArtifactSettings struct {
	RetentionDays           int   `json:"retention_days"`
	BundleWindowLimit       int   `json:"bundle_window_limit"`
	AttachmentCountLimit    int   `json:"attachment_count_limit"`
	RequestBundleTotalBytes int64 `json:"request_bundle_total_bytes"`
	RequestBundlePartBytes  int64 `json:"request_bundle_part_bytes"`
	RequestBundlePartLimit  int   `json:"request_bundle_part_limit"`
}

func (s *Service) SetArtifactStore(store ArtifactObjectStore, retentionDays int) {
	s.artifactStore = store
	s.SetArtifactRetentionDays(retentionDays)
}

func (s *Service) SetArtifactRetentionDays(days int) {
	if days < 1 {
		days = defaultArtifactRetentionDays
	}
	if days > 3650 {
		days = 3650
	}
	s.artifactRetentionDays.Store(int64(days))
}

func (s *Service) SetChatInputLimits(attachmentCount int, totalBytes, partBytes int64, partLimit int) {
	if attachmentCount < 0 {
		attachmentCount = 0
	}
	if attachmentCount > 65500 {
		attachmentCount = 65500
	}
	if totalBytes < 1<<20 {
		totalBytes = defaultRequestBundleTotalBytes
	}
	if partBytes < 1<<20 {
		partBytes = defaultRequestBundlePartBytes
	}
	if partBytes > 256<<20 {
		partBytes = 256 << 20
	}
	if partLimit < 1 || partLimit > 20 {
		partLimit = defaultRequestBundlePartLimit
	}
	s.attachmentCountLimit.Store(int64(attachmentCount))
	s.requestBundleTotalBytes.Store(totalBytes)
	s.requestBundlePartBytes.Store(partBytes)
	s.requestBundlePartLimit.Store(int64(partLimit))
}

func (s *Service) ArtifactSettings() ArtifactSettings {
	days := int(s.artifactRetentionDays.Load())
	if days < 1 {
		days = defaultArtifactRetentionDays
	}
	totalBytes := s.requestBundleTotalBytes.Load()
	if totalBytes < 1<<20 {
		totalBytes = defaultRequestBundleTotalBytes
	}
	partBytes := s.requestBundlePartBytes.Load()
	if partBytes < 1<<20 {
		partBytes = defaultRequestBundlePartBytes
	}
	partLimit := int(s.requestBundlePartLimit.Load())
	if partLimit < 1 {
		partLimit = defaultRequestBundlePartLimit
	}
	attachmentCount := int(s.attachmentCountLimit.Load())
	if attachmentCount < 0 {
		attachmentCount = 0
	}
	return ArtifactSettings{
		RetentionDays: days, BundleWindowLimit: s.BundleWindowLimit(), AttachmentCountLimit: attachmentCount,
		RequestBundleTotalBytes: totalBytes, RequestBundlePartBytes: partBytes, RequestBundlePartLimit: partLimit,
	}
}

func (s *Service) PersistArtifact(ctx context.Context, sessionID, requestID, direction, kind, name, contentType string, raw []byte) (domain.ArtifactRecord, error) {
	if s.artifactStore == nil {
		return domain.ArtifactRecord{}, errors.New("artifact storage is unavailable")
	}
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	name = filepath.Base(strings.TrimSpace(name))
	if name == "." || name == "" || strings.ContainsAny(name, "\x00\r\n") {
		return domain.ArtifactRecord{}, errors.New("invalid artifact filename")
	}
	if len(raw) == 0 {
		return domain.ArtifactRecord{}, errors.New("artifact is empty")
	}
	if len(raw) > 256<<20 {
		return domain.ArtifactRecord{}, errors.New("artifact exceeds 256 MiB limit")
	}
	direction = strings.ToLower(strings.TrimSpace(direction))
	if direction != "input" && direction != "output" {
		return domain.ArtifactRecord{}, errors.New("artifact direction must be input or output")
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "" {
		kind = "file"
	}
	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	now := time.Now().UTC()
	id := ids.New("artifact")
	key := fmt.Sprintf("sessions/%s/%s", sessionID, id)
	digest := sha256.Sum256(raw)
	digestHex := hex.EncodeToString(digest[:])
	for _, existing := range item.Artifacts {
		if existing.RequestID == strings.TrimSpace(requestID) && existing.Direction == direction && existing.Kind == kind && existing.Name == name && existing.SHA256 == digestHex {
			return existing, nil
		}
	}
	bundle, entries := inspectArtifactBundle(raw, name)
	record := domain.ArtifactRecord{
		ID: id, RequestID: strings.TrimSpace(requestID), Direction: direction, Kind: kind, Name: name,
		ContentType: contentType, Size: int64(len(raw)), SHA256: digestHex, ObjectKey: key,
		CreatedAt: now, ExpiresAt: now.Add(time.Duration(s.ArtifactSettings().RetentionDays) * 24 * time.Hour), Bundle: bundle,
		BundleType: classifyTransportBundleType(item, requestID, direction, kind, raw, bundle), EntryCount: entries,
	}
	if kind == "library" {
		record.ExpiresAt = time.Time{}
	}
	if err := s.putArtifactWithRecovery(ctx, key, record.ContentType, raw); err != nil {
		return domain.ArtifactRecord{}, err
	}
	_, err = s.store.Update(sessionID, func(item *domain.Session) error {
		item.Artifacts = append(item.Artifacts, record)
		return nil
	})
	if err != nil {
		_ = s.artifactStore.Delete(ctx, key)
		return domain.ArtifactRecord{}, err
	}
	s.bus.Publish(sessionID, "artifact.persisted", map[string]any{"artifact_id": id, "request_id": record.RequestID, "direction": direction, "kind": kind, "name": name, "bytes": record.Size, "sha256": record.SHA256})
	return record, nil
}

func (s *Service) ListArtifacts(sessionID string) ([]domain.ArtifactRecord, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	result := append([]domain.ArtifactRecord(nil), item.Artifacts...)
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (s *Service) ReadArtifact(ctx context.Context, sessionID, artifactID string) (domain.ArtifactRecord, []byte, error) {
	record, err := s.artifactRecord(sessionID, artifactID)
	if err != nil {
		return domain.ArtifactRecord{}, nil, err
	}
	if s.artifactStore == nil {
		return domain.ArtifactRecord{}, nil, errors.New("artifact storage is unavailable")
	}
	if record.ObjectKey == "" {
		return domain.ArtifactRecord{}, nil, errors.New("artifact object location is unavailable")
	}
	raw, _, err := s.artifactStore.Get(ctx, record.ObjectKey)
	return record, raw, err
}

func (s *Service) ArtifactEntries(ctx context.Context, sessionID, artifactID string) ([]domain.ArtifactEntry, error) {
	_, raw, err := s.ReadArtifact(ctx, sessionID, artifactID)
	if err != nil {
		return nil, err
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, errors.New("artifact is not an explorable ZIP bundle")
	}
	entries := make([]domain.ArtifactEntry, 0, len(reader.File))
	for _, file := range reader.File {
		entries = append(entries, domain.ArtifactEntry{Path: file.Name, Size: int64(file.UncompressedSize64), Dir: file.FileInfo().IsDir()})
	}
	return entries, nil
}

func (s *Service) ReadArtifactEntry(ctx context.Context, sessionID, artifactID, entryPath string) ([]byte, string, error) {
	_, raw, err := s.ReadArtifact(ctx, sessionID, artifactID)
	if err != nil {
		return nil, "", err
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, "", errors.New("artifact is not an explorable ZIP bundle")
	}
	clean := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(entryPath)), "./")
	if clean == "" || clean == "." || strings.HasPrefix(clean, "../") {
		return nil, "", errors.New("invalid bundle entry path")
	}
	for _, file := range reader.File {
		if file.Name != clean || file.FileInfo().IsDir() {
			continue
		}
		if file.UncompressedSize64 > 128<<20 {
			return nil, "", errors.New("bundle entry exceeds 128 MiB preview/download limit")
		}
		handle, err := file.Open()
		if err != nil {
			return nil, "", err
		}
		defer handle.Close()
		data, err := io.ReadAll(io.LimitReader(handle, (128<<20)+1))
		return data, filepath.Base(file.Name), err
	}
	return nil, "", errors.New("bundle entry not found")
}

func (s *Service) CleanupArtifacts(ctx context.Context, before time.Time) error {
	if s.artifactStore == nil {
		return nil
	}
	var cleanupErrors []error
	for _, item := range s.store.List() {
		for _, record := range item.Artifacts {
			if record.Kind == "library" {
				continue
			}
			if !record.CreatedAt.Before(before) {
				continue
			}
			if record.ObjectKey == "" {
				cleanupErrors = append(cleanupErrors, fmt.Errorf("artifact %s has no object location", record.ID))
				continue
			}
			if err := s.artifactStore.Delete(ctx, record.ObjectKey); err != nil {
				cleanupErrors = append(cleanupErrors, fmt.Errorf("delete artifact %s: %w", record.ID, err))
				continue
			}
			if _, err := s.store.Update(item.ID, func(current *domain.Session) error {
				kept := current.Artifacts[:0]
				for _, candidate := range current.Artifacts {
					if candidate.ID != record.ID {
						kept = append(kept, candidate)
					}
				}
				current.Artifacts = kept
				return nil
			}); err != nil {
				cleanupErrors = append(cleanupErrors, fmt.Errorf("remove artifact metadata %s: %w", record.ID, err))
			}
		}
	}
	return errors.Join(cleanupErrors...)
}

func (s *Service) artifactRecord(sessionID, artifactID string) (domain.ArtifactRecord, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ArtifactRecord{}, err
	}
	for _, record := range item.Artifacts {
		if record.ID == artifactID {
			return record, nil
		}
	}
	return domain.ArtifactRecord{}, errors.New("artifact not found")
}

func inspectArtifactBundle(raw []byte, name string) (bool, int) {
	if !strings.HasSuffix(strings.ToLower(name), ".zip") || len(raw) < 4 {
		return false, 0
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return false, 0
	}
	return true, len(reader.File)
}
