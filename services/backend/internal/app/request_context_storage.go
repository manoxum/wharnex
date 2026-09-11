package app

import (
	"os"
	"path/filepath"
	"strings"
)

func (s *Service) cleanupPrunedRequestContexts(paths []string) {
	if len(paths) == 0 {
		return
	}
	referencedFiles := map[string]struct{}{}
	referencedDirs := map[string]struct{}{}
	for _, item := range s.store.List() {
		archives := make([]string, 0, len(item.RequestContextArchives)+1)
		archives = append(archives, item.Context.ZipPath)
		for _, path := range item.RequestContextArchives {
			archives = append(archives, path)
		}
		for _, path := range archives {
			clean := filepath.Clean(strings.TrimSpace(path))
			if clean == "" || clean == "." {
				continue
			}
			referencedFiles[clean] = struct{}{}
			referencedDirs[filepath.Dir(clean)] = struct{}{}
		}
	}
	removed := map[string]struct{}{}
	for _, path := range paths {
		clean := filepath.Clean(strings.TrimSpace(path))
		if clean == "" || clean == "." {
			continue
		}
		if _, ok := referencedFiles[clean]; ok {
			continue
		}
		dir := filepath.Dir(clean)
		if !strings.HasPrefix(filepath.Base(dir), "wharness-context-") {
			continue
		}
		if _, ok := referencedDirs[dir]; ok {
			continue
		}
		if _, ok := removed[dir]; ok {
			continue
		}
		_ = os.RemoveAll(dir)
		removed[dir] = struct{}{}
	}
}
