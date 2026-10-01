package app

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/app/contextbudget"
	"kernl.local/harness/backend/internal/domain"
)

const maxSelectedContextBytes = contextbudget.MaxSelectedBytes

func contextArchiveEntries(contextPath string) (map[string]*zip.File, *zip.ReadCloser, error) {
	source, err := zip.OpenReader(filepath.Clean(contextPath))
	if err != nil {
		return nil, nil, fmt.Errorf("open context archive: %w", err)
	}
	workspace := false
	for _, file := range source.File {
		if file.Name == legacyContextSourcesIndex {
			workspace = true
		}
	}
	entries := make(map[string]*zip.File, len(source.File))
	for _, file := range source.File {
		clean := filepath.ToSlash(filepath.Clean(file.Name))
		if clean == "." || clean != file.Name || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || file.FileInfo().Mode()&os.ModeSymlink != 0 {
			_ = source.Close()
			return nil, nil, fmt.Errorf("invalid context entry %q", file.Name)
		}
		if file.FileInfo().IsDir() {
			continue
		}
		name := requestArchiveContextEntry(clean, workspace)
		if _, duplicate := entries[name]; duplicate {
			_ = source.Close()
			return nil, nil, fmt.Errorf("duplicate context entry %q", name)
		}
		entries[name] = file
	}
	return entries, source, nil
}

func contextContentPath(name string) bool {
	return strings.HasPrefix(name, requestPrimaryContextRoot) || strings.HasPrefix(name, requestReferenceContextRoot) || strings.HasPrefix(name, requestAttachedContextRoot)
}

// A model can only request content already admitted to this immutable snapshot.
// No model-supplied path is opened on the host filesystem.
func selectContextPaths(contextPath string, previous, requested []string) ([]string, error) {
	if len(requested) == 0 {
		return nil, fmt.Errorf("context request requires at least one path")
	}
	entries, source, err := contextArchiveEntries(contextPath)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	selected := make(map[string]struct{}, len(previous)+len(requested))
	var total uint64
	for _, name := range append(append([]string(nil), previous...), requested...) {
		if !contextContentPath(name) || path.Clean(name) != name || strings.Contains(name, "\\") {
			return nil, fmt.Errorf("invalid context path %q", name)
		}
		file, ok := entries[name]
		if !ok {
			return nil, fmt.Errorf("context path %q is not in the captured snapshot", name)
		}
		if _, exists := selected[name]; exists {
			continue
		}
		selected[name] = struct{}{}
		total += file.UncompressedSize64
		if total > maxSelectedContextBytes {
			return nil, fmt.Errorf("selected context exceeds %d bytes", maxSelectedContextBytes)
		}
	}
	if len(selected) == len(previous) {
		return nil, fmt.Errorf("context request did not add a new file")
	}
	result := make([]string, 0, len(selected))
	for name := range selected {
		result = append(result, name)
	}
	sort.Strings(result)
	return result, nil
}

func selectedContextBytes(contextPath string, paths []string) uint64 {
	entries, source, err := contextArchiveEntries(contextPath)
	if err != nil {
		return 0
	}
	defer source.Close()
	var total uint64
	seen := make(map[string]struct{}, len(paths))
	for _, name := range paths {
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		if file := entries[name]; file != nil {
			total += file.UncompressedSize64
		}
	}
	return total
}

func writeContextDirectorySelected(target *zip.Writer, contextPath string, mode domain.ContextMode, paths []string) error {
	entries, source, err := contextArchiveEntries(contextPath)
	if err != nil {
		return err
	}
	defer source.Close()
	selected := make(map[string]struct{}, len(paths))
	for _, name := range paths {
		if !contextContentPath(name) || entries[name] == nil {
			return fmt.Errorf("selected context path %q is absent", name)
		}
		selected[name] = struct{}{}
	}
	for _, file := range source.File {
		name := requestArchiveContextEntry(file.Name, entries[requestContextSourcesIndex] != nil)
		if file.FileInfo().IsDir() || (mode == domain.ContextModePartial && name != requestContextSourcesIndex && !hasSelectedContextPath(selected, name)) {
			continue
		}
		input, err := file.Open()
		if err != nil {
			return err
		}
		raw, readErr := io.ReadAll(input)
		_ = input.Close()
		if readErr != nil {
			return readErr
		}
		if name == requestContextSourcesIndex {
			raw, err = rewriteRequestContextSources(raw)
			if err != nil {
				return err
			}
		}
		if err := writeZipBytes(target, name, raw); err != nil {
			return err
		}
	}
	return nil
}

func hasSelectedContextPath(selected map[string]struct{}, name string) bool {
	_, ok := selected[name]
	return ok
}
