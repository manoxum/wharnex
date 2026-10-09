package app

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/app/remotemap"
	"kernl.local/harness/backend/internal/domain"
)

type remoteFileMapEntry = remotemap.Entry

type remoteFileMapDocument struct {
	Protocol      string               `json:"protocol"`
	Generation    int64                `json:"generation"`
	ContextSHA256 string               `json:"context_sha256"`
	Files         []remoteFileMapEntry `json:"files"`
}

// buildRemoteFileMapResources composes validated request metadata with the
// snapshot-backed remote map domain. Legacy protocol spellings stay at the
// serialization boundary in remoteFileMapDocument.
func buildRemoteFileMapResources(dir, contextPath string, manifest domain.ContextManifest, knowledge domain.RequestKnowledgeSnapshot, gitContext RequestGitContext, continuation []continuationArtifact, contextState requestContextMapState, attachments, artifacts []decodedRemoteFile, existing []remoteFileMapEntry, resourceURL func(string) string) ([]RemoteInputChannelResource, []remoteFileMapEntry, error) {
	if err := validateRequestKnowledgeSnapshot(knowledge); err != nil {
		return nil, nil, err
	}
	var files []remotemap.File
	add := func(role, path string, raw []byte, selected bool) {
		files = append(files, remotemap.File{Role: role, Path: path, Raw: raw, Selected: selected})
	}
	if knowledge.State == domain.KnowledgeStatePresent {
		if len(knowledge.Entries) == 0 {
			add("knowledge", "knowledge/project.md", []byte(knowledge.Content), true)
		} else {
			for _, entry := range knowledge.Entries {
				add("knowledge", "knowledge/"+entry.ID+".md", []byte(strings.TrimSpace(entry.Content)), true)
			}
		}
	}
	for _, entry := range continuation {
		add("continuation", entry.Name, entry.Raw, true)
		if entry.Name == mainRequestArtifactPath {
			contextState.SelectedPaths = remotemap.FromPrompt(contextState.SelectedPaths, string(entry.Raw), manifest)
		}
	}
	for _, entry := range gitContext.Files {
		add("git-context", entry.Path, []byte(entry.Content), true)
	}
	mapFiles, err := requestContextMapFilesWithState(contextPath, manifest, contextState)
	if err != nil {
		return nil, nil, err
	}
	for _, entry := range mapFiles {
		add("context-map", entry.Path, []byte(entry.Content), true)
	}
	for _, entry := range attachments {
		add("attachment", "attachments/"+entry.name, entry.raw, false)
	}
	for _, entry := range artifacts {
		add("artifact", "artifacts/"+entry.name, entry.raw, false)
	}
	return remotemap.Build(dir, contextPath, manifest, contextState.SelectedPaths, files, existing, resourceURL)
}

func safeRemoteMapPath(value string) bool { return remotemap.SafePath(value) }

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
