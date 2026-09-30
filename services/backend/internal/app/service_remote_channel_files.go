package app

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/domain"
)

type remoteFileMapEntry struct {
	Path        string `json:"path"`
	URL         string `json:"url"`
	SHA256      string `json:"sha256"`
	Bytes       int64  `json:"bytes"`
	ContentType string `json:"content_type"`
	Role        string `json:"role"`
	Selected    bool   `json:"selected,omitempty"`
}

type remoteFileMapDocument struct {
	Protocol      string               `json:"protocol"`
	Generation    int64                `json:"generation"`
	ContextSHA256 string               `json:"context_sha256"`
	Files         []remoteFileMapEntry `json:"files"`
}

// buildRemoteFileMapResources publishes only individually-addressable files.
// The ZIP remains a local snapshot/audit artifact; it is never exposed through
// the consumer-Web channel because that runtime cannot reliably retrieve it.
func buildRemoteFileMapResources(dir, contextPath string, manifest domain.ContextManifest, knowledge domain.RequestKnowledgeSnapshot, gitContext RequestGitContext, continuation []continuationArtifact, contextState requestContextMapState, attachments, artifacts []decodedRemoteFile, existing []remoteFileMapEntry, resourceURL func(string) string) ([]RemoteInputChannelResource, []remoteFileMapEntry, error) {
	resources := make([]RemoteInputChannelResource, 0, len(manifest.Files)+len(gitContext.Files)+len(attachments)+len(artifacts))
	entries := make([]remoteFileMapEntry, 0, len(manifest.Files)+len(gitContext.Files)+len(attachments)+len(artifacts))
	selected := make(map[string]struct{}, len(contextState.SelectedPaths))
	for _, item := range contextState.SelectedPaths {
		selected[item] = struct{}{}
	}
	existingResources := make(map[string]remoteFileMapEntry, len(existing))
	for _, entry := range existing {
		if entry.Role != "" && entry.SHA256 != "" {
			existingResources[entry.Role+":"+entry.SHA256] = entry
		}
	}
	seenResources := make(map[string]struct{})
	appendExisting := func(role, displayPath, digestText string, bytes int64, selected bool) bool {
		previous, ok := existingResources[role+":"+digestText]
		if !ok {
			return false
		}
		resourcePath := "files/" + role + "/" + digestText
		entries = append(entries, remoteFileMapEntry{Path: displayPath, URL: resourceURL(resourcePath), SHA256: digestText, Bytes: bytes, ContentType: previous.ContentType, Role: role, Selected: selected})
		return true
	}
	addBytes := func(role, displayPath string, raw []byte, selected bool) error {
		digest := sha256.Sum256(raw)
		digestText := hex.EncodeToString(digest[:])
		if appendExisting(role, displayPath, digestText, int64(len(raw)), selected) {
			return nil
		}
		resourcePath := "files/" + role + "/" + digestText
		contentType := remoteFileContentType(raw)
		if _, exists := seenResources[resourcePath]; !exists {
			target := remoteChannelResourcePath(dir, resourcePath)
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			if err := os.WriteFile(target, raw, 0o600); err != nil {
				return err
			}
			resources = append(resources, RemoteInputChannelResource{Path: resourcePath, FilePath: target, ContentType: contentType, Bytes: int64(len(raw))})
			seenResources[resourcePath] = struct{}{}
		}
		entries = append(entries, remoteFileMapEntry{Path: displayPath, URL: resourceURL(resourcePath), SHA256: digestText, Bytes: int64(len(raw)), ContentType: contentType, Role: role, Selected: selected})
		return nil
	}
	if err := validateRequestKnowledgeSnapshot(knowledge); err != nil {
		return nil, nil, err
	}
	if knowledge.State == domain.KnowledgeStatePresent {
		if len(knowledge.Entries) == 0 {
			if err := addBytes("knowledge", "knowledge/project.md", []byte(knowledge.Content), true); err != nil {
				return nil, nil, err
			}
		} else {
			for _, entry := range knowledge.Entries {
				if err := addBytes("knowledge", "knowledge/"+entry.ID+".md", []byte(strings.TrimSpace(entry.Content)), true); err != nil {
					return nil, nil, err
				}
			}
		}
	}
	// The attempt ledger and divergence report are always selected: they are
	// not optional reference material a planner may skip, they are the record
	// of what this Main Request already proved and what moved underneath it.
	for _, entry := range continuation {
		if err := addBytes("continuation", entry.Name, entry.Raw, true); err != nil {
			return nil, nil, err
		}
	}
	for _, entry := range gitContext.Files {
		if err := addBytes("git-context", entry.Path, []byte(entry.Content), true); err != nil {
			return nil, nil, err
		}
	}
	mapFiles, err := requestContextMapFilesWithState(contextPath, manifest, contextState)
	if err != nil {
		return nil, nil, err
	}
	for _, entry := range mapFiles {
		if err := addBytes("context-map", entry.Path, []byte(entry.Content), true); err != nil {
			return nil, nil, err
		}
	}
	for _, file := range manifest.Files {
		if !safeRemoteMapPath(file.Path) || file.SHA256 == "" {
			continue
		}
		selectedEntry := hasRemoteMapPath(selected, file.Path)
		if appendExisting("context", file.Path, file.SHA256, file.Size, selectedEntry) {
			continue
		}
		resourcePath := "files/context/" + file.SHA256
		contentType := file.ContentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		if _, exists := seenResources[resourcePath]; !exists {
			resources = append(resources, RemoteInputChannelResource{
				Path: resourcePath, ContentType: contentType, Bytes: file.Size,
				ArchivePath: contextPath, ArchiveEntry: file.Path, ArchiveID: manifest.SHA256,
			})
			seenResources[resourcePath] = struct{}{}
		}
		entries = append(entries, remoteFileMapEntry{Path: file.Path, URL: resourceURL(resourcePath), SHA256: file.SHA256, Bytes: file.Size, ContentType: contentType, Role: "context", Selected: selectedEntry})
	}
	for _, entry := range attachments {
		if err := addBytes("attachment", "attachments/"+entry.name, entry.raw, false); err != nil {
			return nil, nil, err
		}
	}
	for _, entry := range artifacts {
		if err := addBytes("artifact", "artifacts/"+entry.name, entry.raw, false); err != nil {
			return nil, nil, err
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Role+":"+entries[i].Path < entries[j].Role+":"+entries[j].Path })
	return resources, entries, nil
}

func hasRemoteMapPath(paths map[string]struct{}, value string) bool { _, ok := paths[value]; return ok }

func safeRemoteMapPath(value string) bool {
	clean := path.Clean(strings.TrimSpace(value))
	return value != "" && clean == value && !strings.HasPrefix(clean, "/") && clean != "." && !strings.HasPrefix(clean, "../")
}

func remoteFileContentType(raw []byte) string {
	if utf8.Valid(raw) && !strings.ContainsRune(string(raw), '\x00') {
		return "text/plain; charset=utf-8"
	}
	return "application/octet-stream"
}

func marshalRemoteChannelJSON(value any) ([]byte, error) { return json.MarshalIndent(value, "", "  ") }

func buildRemoteAttachmentsArchive(target, contextPath string, projectFiles []string, attachments, artifacts []decodedRemoteFile) error {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	archive := zip.NewWriter(file)
	metadata, _ := json.MarshalIndent(map[string]any{"project_files": projectFiles, "note": "Authoritative @file contents are in the context snapshot."}, "", "  ")
	writeErr := writeZipBytes(archive, "project-files.json", metadata)
	if writeErr == nil && len(projectFiles) > 0 {
		contextArchive, openErr := zip.OpenReader(contextPath)
		if openErr != nil {
			writeErr = openErr
		} else {
			selected := make(map[string]struct{}, len(projectFiles))
			for _, path := range projectFiles {
				selected[path] = struct{}{}
			}
			for _, entry := range contextArchive.File {
				if _, ok := selected[entry.Name]; !ok || writeErr != nil {
					continue
				}
				input, readErr := entry.Open()
				if readErr != nil {
					writeErr = readErr
					continue
				}
				raw, readErr := io.ReadAll(input)
				_ = input.Close()
				if readErr != nil {
					writeErr = readErr
					continue
				}
				writeErr = writeZipBytes(archive, "project-files/"+entry.Name, raw)
			}
			_ = contextArchive.Close()
		}
	}
	for _, entry := range attachments {
		if writeErr == nil {
			writeErr = writeZipBytes(archive, "attachments/"+entry.name, entry.raw)
		}
	}
	for _, entry := range artifacts {
		if writeErr == nil {
			writeErr = writeZipBytes(archive, "artifacts/"+entry.name, entry.raw)
		}
	}
	closeErr := archive.Close()
	fileErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return fileErr
}

func writeRemoteChannelJSON(path string, value any) error {
	raw, err := marshalRemoteChannelJSON(value)
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func copyRemoteChannelFile(source, target string) error {
	raw, err := os.ReadFile(filepath.Clean(source))
	if err != nil {
		return err
	}
	return os.WriteFile(target, raw, 0o600)
}
