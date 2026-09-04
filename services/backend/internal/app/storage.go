package app

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

type ProjectStorageUsage struct {
	ProjectPath  string `json:"project_path"`
	SessionCount int    `json:"session_count"`
	ContextBytes int64  `json:"context_bytes"`
	SandboxBytes int64  `json:"sandbox_bytes"`
	TotalBytes   int64  `json:"total_bytes"`
}

type StorageUsage struct {
	TotalBytes   int64                 `json:"total_bytes"`
	StateBytes   int64                 `json:"state_bytes"`
	ContextBytes int64                 `json:"context_bytes"`
	SandboxBytes int64                 `json:"sandbox_bytes"`
	OrphanBytes  int64                 `json:"orphan_bytes"`
	Projects     []ProjectStorageUsage `json:"projects"`
}

func (s *Service) StorageUsage() StorageUsage {
	usage := StorageUsage{Projects: make([]ProjectStorageUsage, 0)}
	usage.StateBytes = fileSize(s.store.Path())
	projects := map[string]*ProjectStorageUsage{}
	seen := map[string]struct{}{}
	for _, item := range s.store.List() {
		project := projects[item.ProjectPath]
		if project == nil {
			project = &ProjectStorageUsage{ProjectPath: item.ProjectPath}
			projects[item.ProjectPath] = project
		}
		project.SessionCount++
		if dir := ownedContextDir(item); dir != "" {
			if _, ok := seen[dir]; !ok {
				bytes := directorySize(dir)
				seen[dir] = struct{}{}
				project.ContextBytes += bytes
				usage.ContextBytes += bytes
			}
		}
		if workspace, ok := s.devspace(item.ID); ok {
			root := filepath.Clean(workspace.Path)
			if _, already := seen[root]; !already {
				bytes := directorySize(root)
				seen[root] = struct{}{}
				project.SandboxBytes += bytes
				usage.SandboxBytes += bytes
			}
		}
	}
	usage.OrphanBytes = orphanWharnessTempBytes(seen)
	for _, project := range projects {
		project.TotalBytes = project.ContextBytes + project.SandboxBytes
		usage.Projects = append(usage.Projects, *project)
	}
	sort.Slice(usage.Projects, func(i, j int) bool { return usage.Projects[i].ProjectPath < usage.Projects[j].ProjectPath })
	usage.TotalBytes = usage.StateBytes + usage.ContextBytes + usage.SandboxBytes + usage.OrphanBytes
	return usage
}

func (s *Service) ClearAllData() error {
	items := s.store.List()
	if err := s.store.Clear(); err != nil {
		return err
	}
	for _, item := range items {
		s.resetDevspace(item.ID)
		if dir := ownedContextDir(item); dir != "" {
			_ = os.RemoveAll(dir)
		}
	}
	// Only remove artifacts explicitly owned by this Service instance above.
	// A global kernl-workspace-* sweep can delete an active Protected workspace
	// belonging to another Wharness instance or a concurrent verification.
	s.bus.ClearAll()
	return nil
}

func ownedContextDir(item domain.Session) string {
	dir := filepath.Dir(item.Context.ZipPath)
	if dir == "" || dir == "." || !strings.HasPrefix(filepath.Base(dir), "wharness-context-") {
		return ""
	}
	return filepath.Clean(dir)
}

func fileSize(path string) int64 {
	if strings.TrimSpace(path) == "" {
		return 0
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return 0
	}
	return info.Size()
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type().IsRegular() {
			if info, infoErr := entry.Info(); infoErr == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

func orphanWharnessTempBytes(seen map[string]struct{}) int64 {
	var total int64
	entries, err := os.ReadDir(os.TempDir())
	if err != nil {
		return 0
	}
	for _, entry := range entries {
		if !entry.IsDir() || !wharnessTempName(entry.Name()) {
			continue
		}
		root := filepath.Join(os.TempDir(), entry.Name())
		if _, ok := seen[filepath.Clean(root)]; ok {
			continue
		}
		total += directorySize(root)
	}
	return total
}

func wharnessTempName(name string) bool {
	return strings.HasPrefix(name, "wharness-context-") || strings.HasPrefix(name, "kernl-workspace-")
}

var errStorageClearConfirmation = errors.New("storage clear confirmation mismatch")

func ValidateStorageClearConfirmation(value string) error {
	if strings.TrimSpace(value) != "APAGAR WHARNESS" {
		return errStorageClearConfirmation
	}
	return nil
}
