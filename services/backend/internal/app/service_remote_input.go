package app

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const (
	maxRemotePromptBytes     = 1 << 20
	maxRemoteAttachmentBytes = 100 << 20
	maxRemoteArtifactBytes   = 6 << 20
)

var remoteFilenamePattern = regexp.MustCompile(`^[^/\\\x00-\x1f\x7f]{1,180}$`)

func (s *Service) PublishRemoteInput(ctx context.Context, sessionID string, request RemoteInputRequest) (RemoteInputResult, error) {
	status := s.RemoteInputStatus()
	if !status.Enabled || s.remoteInputs == nil {
		return RemoteInputResult{}, errors.New("remote storage is not configured")
	}
	// SubmitMessage already refreshed the project context for this request. Live
	// channels reuse that exact prepared snapshot here and let their bounded
	// context monitor publish any edits that happen after planner preparation.
	// Immutable remote archives still refresh once more below because they have no
	// live channel capable of carrying a later context delta.
	item, err := s.store.Get(sessionID)
	if err != nil {
		return RemoteInputResult{}, err
	}
	request.RequestID = strings.TrimSpace(request.RequestID)
	if request.RequestID == "" || request.RequestID != item.LastRequestID || !containsString(item.PendingManualRequestIDs, request.RequestID) {
		return RemoteInputResult{}, errors.New("remote input request_id is not the active manual request")
	}
	if len(request.Prompt) == 0 || len(request.Prompt) > maxRemotePromptBytes {
		return RemoteInputResult{}, errors.New("remote input prompt is empty or exceeds 1 MiB")
	}
	attachments, err := decodeRemoteFiles(request.Attachments, maxRemoteAttachmentBytes)
	if err != nil {
		return RemoteInputResult{}, fmt.Errorf("attachments: %w", err)
	}
	artifacts, err := decodeRemoteFiles(request.Artifacts, maxRemoteArtifactBytes)
	if err != nil {
		return RemoteInputResult{}, fmt.Errorf("artifacts: %w", err)
	}
	request.ProjectFiles, err = validateProjectFileReferences(item, request.ProjectFiles)
	if err != nil {
		return RemoteInputResult{}, err
	}
	request.IncludeContext = true
	if s.artifactStore != nil {
		if err := s.persistRemoteInputArtifacts(ctx, item, request, attachments, artifacts); err != nil {
			return RemoteInputResult{}, fmt.Errorf("persist remote input artifacts: %w", err)
		}
	}
	if channels, ok := s.remoteInputs.(RemoteInputChannelStore); ok && channels.SupportsRemoteInputChannels() {
		result, publishErr := s.publishRemoteInputChannel(ctx, channels, item, request, attachments, artifacts)
		if publishErr == nil {
			s.bus.Publish(sessionID, "remote_input.published", map[string]any{
				"request_id": request.RequestID, "provider": result.Provider, "instance_id": result.InstanceID,
				"bytes": result.Bytes, "sha256": result.SHA256, "expires_at": result.ExpiresAt,
				"tunnel_count": len(result.Tunnels), "context_reused": true,
			})
		}
		return result, publishErr
	}

	// A one-shot remote object has no live context monitor, so preserve its
	// stronger publication-time freshness guarantee.
	item, err = s.refreshContext(sessionID)
	if err != nil {
		return RemoteInputResult{}, err
	}
	if request.RequestID != item.LastRequestID || !containsString(item.PendingManualRequestIDs, request.RequestID) {
		return RemoteInputResult{}, errors.New("remote input request_id is not the active manual request")
	}
	request.ProjectFiles, err = validateProjectFileReferences(item, request.ProjectFiles)
	if err != nil {
		return RemoteInputResult{}, err
	}

	token, err := randomToken()
	if err != nil {
		return RemoteInputResult{}, err
	}
	objectName := fmt.Sprintf("wharness-input-%s-%s.zip", request.RequestID, token)
	temporary, err := os.CreateTemp("", "wharness-remote-input-*.zip")
	if err != nil {
		return RemoteInputResult{}, err
	}
	temporaryPath := temporary.Name()
	_ = temporary.Close()
	defer os.Remove(temporaryPath)
	digest, size, err := buildRemoteInputArchive(temporaryPath, item.Context.ZipPath, request, attachments, artifacts)
	if err != nil {
		return RemoteInputResult{}, err
	}
	rawArchive, err := os.ReadFile(temporaryPath)
	if err != nil {
		return RemoteInputResult{}, err
	}
	if s.artifactStore != nil {
		if _, err := s.PersistArtifact(ctx, sessionID, request.RequestID, "input", "bundle", "wharness-input-"+request.RequestID+".zip", "application/zip", rawArchive); err != nil {
			return RemoteInputResult{}, fmt.Errorf("persist remote input bundle: %w", err)
		}
	}
	fileCount, maxFileSize, err := remoteInputShape(item.Context.ZipPath, request, attachments, artifacts)
	if err != nil {
		return RemoteInputResult{}, err
	}
	publication, err := s.remoteInputs.Publish(ctx, RemoteInputObject{ObjectName: objectName, FilePath: temporaryPath, Bytes: size, FileCount: fileCount, MaxFileSize: maxFileSize})
	if err != nil {
		return RemoteInputResult{}, err
	}
	if err := s.retainRemoteInputLease(sessionID, request.RequestID, publication.InstanceID, objectName); err != nil {
		return RemoteInputResult{}, fmt.Errorf("retain remote input request: %w", err)
	}
	expiresAt := publication.ExpiresAt
	if expiresAt.IsZero() || expiresAt.After(time.Now().UTC().Add(RemoteInputRetention)) {
		expiresAt = time.Now().UTC().Add(RemoteInputRetention)
	}
	bootstrap := remoteBootstrapPrompt(publication.URL, digest, request.RequestID)
	s.bus.Publish(sessionID, "remote_input.published", map[string]any{
		"request_id": request.RequestID, "provider": publication.Provider, "instance_id": publication.InstanceID,
		"bytes": size, "sha256": digest, "expires_at": expiresAt, "cleanup_warning": publication.CleanupWarning,
	})
	return RemoteInputResult{Mode: "remote_url", Provider: publication.Provider, InstanceID: publication.InstanceID, BootstrapPrompt: bootstrap, SHA256: digest, Bytes: size, ExpiresAt: expiresAt, IncludedContext: request.IncludeContext}, nil
}

type remoteInputLease struct {
	instanceID string
	objectName string
}

func (s *Service) retainRemoteInputLease(sessionID, requestID, instanceID, objectName string) error {
	store, ok := s.remoteInputs.(RemoteInputLeaseStore)
	if !ok {
		return nil
	}
	if err := store.RetainRemoteInput(instanceID, objectName); err != nil {
		return err
	}
	s.remoteLeaseMu.Lock()
	if s.remoteLeases[sessionID] == nil {
		s.remoteLeases[sessionID] = make(map[string]remoteInputLease)
	}
	previous := s.remoteLeases[sessionID][requestID]
	s.remoteLeases[sessionID][requestID] = remoteInputLease{instanceID: instanceID, objectName: objectName}
	s.remoteLeaseMu.Unlock()
	if previous.objectName != "" && (previous.instanceID != instanceID || previous.objectName != objectName) {
		_ = store.ReleaseRemoteInput(previous.instanceID, previous.objectName)
	}
	return nil
}

func (s *Service) releaseRemoteInputLease(sessionID, requestID string) {
	s.remoteLeaseMu.Lock()
	leases := s.remoteLeases[sessionID]
	lease, exists := leases[requestID]
	if exists {
		delete(leases, requestID)
		if len(leases) == 0 {
			delete(s.remoteLeases, sessionID)
		}
	}
	s.remoteLeaseMu.Unlock()
	if !exists {
		return
	}
	if store, ok := s.remoteInputs.(RemoteInputLeaseStore); ok {
		_ = store.ReleaseRemoteInput(lease.instanceID, lease.objectName)
	}
}

func (s *Service) releaseSupersededRemoteInputLeases(sessionID string, pending []string) {
	s.remoteLeaseMu.Lock()
	requestIDs := make([]string, 0)
	for requestID := range s.remoteLeases[sessionID] {
		if !containsString(pending, requestID) {
			requestIDs = append(requestIDs, requestID)
		}
	}
	s.remoteLeaseMu.Unlock()
	for _, requestID := range requestIDs {
		s.releaseRemoteInputLease(sessionID, requestID)
	}
}

func remoteInputShape(contextPath string, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile) (int, int64, error) {
	count := 2 + len(attachments) + len(artifacts) // transport manifest + prompt
	if len(request.ProjectFiles) > 0 {
		count++
	}
	largest := int64(len(request.Prompt))
	if request.IncludeContext {
		info, err := os.Stat(contextPath)
		if err != nil {
			return 0, 0, err
		}
		count++
		largest = max(largest, info.Size())
	}
	for _, entries := range [][]decodedRemoteFile{attachments, artifacts} {
		for _, entry := range entries {
			largest = max(largest, int64(len(entry.raw)))
		}
	}
	return count, largest, nil
}

type decodedRemoteFile struct {
	name string
	mime string
	raw  []byte
}

func decodeRemoteFiles(files []RemoteInputFile, totalLimit int) ([]decodedRemoteFile, error) {
	if len(files) > 32 {
		return nil, errors.New("too many files")
	}
	decoded := make([]decodedRemoteFile, 0, len(files))
	total := 0
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		name := strings.TrimSpace(file.Name)
		if !remoteFilenamePattern.MatchString(name) || name == "." || name == ".." || strings.HasSuffix(name, ".") {
			return nil, errors.New("invalid filename")
		}
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate filename %s", name)
		}
		seen[key] = struct{}{}
		raw, err := base64.StdEncoding.Strict().DecodeString(file.ContentBase64)
		if err != nil || len(raw) == 0 {
			return nil, fmt.Errorf("invalid base64 for %s", name)
		}
		total += len(raw)
		if total > totalLimit {
			return nil, errors.New("files exceed total size limit")
		}
		decoded = append(decoded, decodedRemoteFile{name: name, mime: strings.TrimSpace(file.MIME), raw: raw})
	}
	return decoded, nil
}

func buildRemoteInputArchive(target, contextPath string, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile) (string, int64, error) {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", 0, err
	}
	hash := sha256.New()
	archive := zip.NewWriter(io.MultiWriter(file, hash))
	manifest := map[string]any{"protocol": "wharness.remote-input/v1", "request_id": request.RequestID, "prompt": "prompt/wharness-planner-prompt.md", "context_included": request.IncludeContext, "project_files": request.ProjectFiles}
	manifestRaw, _ := json.MarshalIndent(manifest, "", "  ")
	writeErr := writeZipBytes(archive, "transport.json", manifestRaw)
	if writeErr == nil {
		writeErr = writeZipBytes(archive, "prompt/wharness-planner-prompt.md", []byte(request.Prompt))
	}
	if writeErr == nil && request.IncludeContext {
		writeErr = writeContextDirectory(archive, contextPath)
	}
	if writeErr == nil && len(request.ProjectFiles) > 0 {
		references, _ := json.MarshalIndent(map[string]any{
			"paths":       request.ProjectFiles,
			"instruction": "Treat these paths as explicit user-selected references. Their authoritative contents are directly inside the context/ directory.",
		}, "", "  ")
		writeErr = writeZipBytes(archive, "references/project-files.json", references)
	}
	for _, entry := range artifacts {
		if writeErr == nil {
			writeErr = writeZipBytes(archive, "artifacts/"+entry.name, entry.raw)
		}
	}
	for _, entry := range attachments {
		if writeErr == nil {
			writeErr = writeZipBytes(archive, "attachments/"+entry.name, entry.raw)
		}
	}
	closeErr := archive.Close()
	fileErr := file.Close()
	if writeErr != nil {
		return "", 0, writeErr
	}
	if closeErr != nil {
		return "", 0, closeErr
	}
	if fileErr != nil {
		return "", 0, fileErr
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), info.Size(), nil
}

func writeContextDirectory(target *zip.Writer, contextPath string) error {
	source, err := zip.OpenReader(filepath.Clean(contextPath))
	if err != nil {
		return fmt.Errorf("open context archive: %w", err)
	}
	defer source.Close()
	for _, file := range source.File {
		clean := filepath.ToSlash(filepath.Clean(file.Name))
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || file.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("invalid context entry %q", file.Name)
		}
		if file.FileInfo().IsDir() {
			continue
		}
		input, openErr := file.Open()
		if openErr != nil {
			return fmt.Errorf("open context entry %q: %w", clean, openErr)
		}
		header := &zip.FileHeader{Name: "context/" + clean, Method: zip.Deflate}
		header.SetMode(0o600)
		output, createErr := target.CreateHeader(header)
		if createErr == nil {
			_, createErr = io.Copy(output, input)
		}
		closeErr := input.Close()
		if createErr != nil {
			return fmt.Errorf("copy context entry %q: %w", clean, createErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close context entry %q: %w", clean, closeErr)
		}
	}
	return nil
}

func writeZipBytes(archive *zip.Writer, name string, raw []byte) error {
	entry, err := archive.Create(name)
	if err != nil {
		return err
	}
	_, err = entry.Write(raw)
	return err
}

func writeZipFile(archive *zip.Writer, name, source string) error {
	input, err := os.Open(filepath.Clean(source))
	if err != nil {
		return err
	}
	defer input.Close()
	header := &zip.FileHeader{Name: name, Method: zip.Store}
	header.SetMode(0o600)
	entry, err := archive.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(entry, input)
	return err
}

func randomToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func remoteBootstrapPrompt(publicURL, digest, requestID string) string {
	return fmt.Sprintf(`WHARNESS INPUT %s
ZIP: %s
SHA-256: %s
Download the raw ZIP, read prompt/wharness-planner-prompt.md, then return only wharness-bundle-%s.zip.`, requestID, publicURL, digest, requestID)
}

func validateProjectFileReferences(item domain.Session, values []string) ([]string, error) {
	if len(values) > 32 {
		return nil, errors.New("at most 32 project file references are allowed")
	}
	eligible := make(map[string]struct{}, len(item.Context.Manifest.Files))
	for _, file := range item.Context.Manifest.Files {
		eligible[file.Path] = struct{}{}
	}
	seen := make(map[string]struct{}, len(values))
	references := make([]string, 0, len(values))
	for _, value := range values {
		candidate := strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(value)), "./")
		if candidate == "" {
			continue
		}
		if _, ok := eligible[candidate]; !ok {
			return nil, fmt.Errorf("project file reference %q is not present in the eligible context snapshot", candidate)
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		references = append(references, candidate)
	}
	sort.Strings(references)
	return references, nil
}

func (s *Service) persistRemoteInputArtifacts(ctx context.Context, item domain.Session, request RemoteInputRequest, attachments, artifacts []decodedRemoteFile) error {
	contextRaw, err := os.ReadFile(item.Context.ZipPath)
	if err != nil {
		return err
	}
	if _, err := s.PersistArtifact(ctx, item.ID, request.RequestID, "input", "context", "wharness-context-"+item.ID+".zip", "application/zip", contextRaw); err != nil {
		return err
	}
	for _, entry := range attachments {
		if _, err := s.PersistArtifact(ctx, item.ID, request.RequestID, "input", "attachment", entry.name, entry.mime, entry.raw); err != nil {
			return err
		}
	}
	for _, entry := range artifacts {
		if _, err := s.PersistArtifact(ctx, item.ID, request.RequestID, "input", "system-artifact", entry.name, entry.mime, entry.raw); err != nil {
			return err
		}
	}
	return nil
}
