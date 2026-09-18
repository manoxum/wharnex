package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const requestContextMapProtocol = "harness.context-map/v1"

type RequestContextMapFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type RequestContextMaps struct {
	Protocol string                  `json:"protocol"`
	Files    []RequestContextMapFile `json:"files"`
}

type requestContextMapDocument struct {
	Protocol string                   `json:"protocol"`
	Source   string                   `json:"source"`
	Project  string                   `json:"project"`
	Coverage string                   `json:"coverage"`
	Entries  []requestContextMapEntry `json:"entries"`
	Note     string                   `json:"note"`
}

type requestContextMapEntry struct {
	Path        string `json:"path"`
	Status      string `json:"status"`
	Kind        string `json:"kind,omitempty"`
	Reason      string `json:"reason,omitempty"`
	Size        int64  `json:"size,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	ContentType string `json:"content_type,omitempty"`
}

type requestContextMapSource struct {
	label    string
	project  string
	root     string
	manifest domain.ContextManifest
}

func (s *Service) RequestContextMaps(sessionID string) (RequestContextMaps, error) {
	item, err := s.EnsureContextArtifacts(sessionID)
	if err != nil {
		return RequestContextMaps{}, fmt.Errorf("ensure context artifacts: %w", err)
	}
	files, err := requestContextMapFiles(item.Context.ZipPath, item.Context.Manifest)
	if err != nil {
		return RequestContextMaps{}, err
	}
	return RequestContextMaps{Protocol: requestContextMapProtocol, Files: files}, nil
}

func requestContextMapFiles(contextPath string, primary domain.ContextManifest) ([]RequestContextMapFile, error) {
	sources, err := requestContextMapSources(contextPath, primary)
	if err != nil {
		return nil, err
	}
	files := make([]RequestContextMapFile, 0, len(sources)*2)
	for _, source := range sources {
		mapRaw, err := requestContextMapJSON(source)
		if err != nil {
			return nil, err
		}
		files = append(files,
			RequestContextMapFile{Path: requestContextMapRoot + source.label + "/maps", Content: string(mapRaw)},
			RequestContextMapFile{Path: requestContextMapRoot + source.label + "/sensitive-file-map", Content: requestSensitiveFileMap(source)},
		)
	}
	return files, nil
}

func requestContextMapSources(contextPath string, primary domain.ContextManifest) ([]requestContextMapSource, error) {
	sources := []requestContextMapSource{{label: "main", project: filepath.Base(primary.ProjectRoot), root: primary.ProjectRoot, manifest: primary}}
	archive, err := zip.OpenReader(filepath.Clean(contextPath))
	if err != nil {
		return nil, fmt.Errorf("open context archive for map: %w", err)
	}
	defer archive.Close()
	for _, entry := range archive.File {
		if filepath.ToSlash(filepath.Clean(entry.Name)) != legacyContextSourcesIndex || entry.FileInfo().IsDir() {
			continue
		}
		input, openErr := entry.Open()
		if openErr != nil {
			return nil, fmt.Errorf("open context source index for map: %w", openErr)
		}
		raw, readErr := io.ReadAll(io.LimitReader(input, 4<<20))
		closeErr := input.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read context source index for map: %w", readErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("close context source index for map: %w", closeErr)
		}
		var document requestContextSourcesDocument
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, fmt.Errorf("decode context source index for map: %w", err)
		}
		for index, project := range document.Projects {
			label := strings.Trim(strings.TrimPrefix(filepath.ToSlash(project.Prefix), legacyRelatedContextRoot), "/")
			if label == "" || !safeRemoteMapPath(label) {
				label = fmt.Sprintf("ref-%02d", index+1)
			}
			sources = append(sources, requestContextMapSource{label: "@ref/" + label, project: project.Name, root: project.ProjectPath, manifest: project.Manifest})
		}
		break
	}
	return sources, nil
}

func requestContextMapJSON(source requestContextMapSource) ([]byte, error) {
	entries := make([]requestContextMapEntry, 0, len(source.manifest.Files)+len(source.manifest.Excluded))
	for _, file := range source.manifest.Files {
		entries = append(entries, requestContextMapEntry{Path: file.Path, Status: "included", Kind: "file", Size: file.Size, SHA256: file.SHA256, ContentType: file.ContentType})
	}
	for _, excluded := range source.manifest.Excluded {
		path, reason := splitContextExclusion(excluded)
		if path == "" {
			continue
		}
		entries = append(entries, requestContextMapEntry{Path: path, Status: "excluded", Kind: contextMapPathKind(source.root, path), Reason: reason})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Path == entries[j].Path {
			return entries[i].Status < entries[j].Status
		}
		return entries[i].Path < entries[j].Path
	})
	document := requestContextMapDocument{
		Protocol: requestContextMapProtocol,
		Source:   source.label,
		Project:  source.project,
		Coverage: "included files plus excluded files or subtree roots recorded by the context manifest",
		Entries:  entries,
		Note:     "This is path metadata only. Excluded subtree roots stand for their skipped descendants; secret values and excluded file contents are never exported here.",
	}
	raw, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode context map: %w", err)
	}
	return append(raw, '\n'), nil
}

func splitContextExclusion(value string) (string, string) {
	value = strings.TrimSpace(value)
	if strings.HasSuffix(value, ")") {
		if index := strings.LastIndex(value, " ("); index > 0 {
			return strings.TrimSpace(value[:index]), strings.TrimSpace(value[index+2 : len(value)-1])
		}
	}
	return value, "excluded by context policy"
}

func contextMapPathKind(root, relative string) string {
	path, ok := contextMapHostPath(root, relative)
	if !ok {
		return "unknown"
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "unknown"
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	if info.IsDir() {
		return "directory"
	}
	if info.Mode().IsRegular() {
		return "file"
	}
	return "other"
}

func contextMapHostPath(root, relative string) (string, bool) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(relative)))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", false
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return "", false
	}
	candidate := filepath.Join(absoluteRoot, clean)
	rel, err := filepath.Rel(absoluteRoot, candidate)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return candidate, true
}
