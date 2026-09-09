package projectknowledge

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const (
	DirectoryName = ".wharnex/knowledge"
	catalogName   = "catalog.json"
	maxEntries    = 128
	maxBytes      = 256 << 10
)

var entryIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)

type catalogMarker struct {
	Protocol string   `json:"protocol"`
	Entries  []string `json:"entries"`
}

// Load reads the shareable project-side knowledge catalog. present is false
// only when the managed directory has never been created for this project.
func Load(projectRoot string) ([]domain.ProjectKnowledgeEntry, bool, error) {
	root := filepath.Clean(projectRoot)
	managedRoot := filepath.Join(root, ".wharnex")
	rootInfo, err := os.Lstat(managedRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, true, errors.New("project knowledge parent must be a real directory")
	}
	dir := filepath.Join(managedRoot, "knowledge")
	info, err := os.Lstat(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, true, errors.New("project knowledge path must be a real directory")
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, true, err
	}
	entries := make([]domain.ProjectKnowledgeEntry, 0, len(items))
	markerPresent := false
	total := 0
	for _, item := range items {
		name := item.Name()
		if name == catalogName {
			entryInfo, err := item.Info()
			if err != nil {
				return nil, true, err
			}
			if entryInfo.Mode()&os.ModeSymlink != 0 || !entryInfo.Mode().IsRegular() {
				return nil, true, errors.New("project knowledge catalog marker must be a regular file")
			}
			raw, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				return nil, true, err
			}
			var marker catalogMarker
			if err := json.Unmarshal(raw, &marker); err != nil || marker.Protocol != domain.KnowledgeProtocolV2 {
				return nil, true, errors.New("project knowledge catalog marker is invalid")
			}
			markerPresent = true
			continue
		}
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			continue
		}
		id := strings.TrimSuffix(strings.ToLower(name), filepath.Ext(name))
		if !entryIDPattern.MatchString(id) || name != id+".md" {
			return nil, true, fmt.Errorf("invalid project knowledge filename %q", name)
		}
		entryInfo, err := item.Info()
		if err != nil {
			return nil, true, err
		}
		if entryInfo.Mode()&os.ModeSymlink != 0 || !entryInfo.Mode().IsRegular() {
			return nil, true, fmt.Errorf("project knowledge %q must be a regular file", name)
		}
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, true, err
		}
		content := strings.TrimSpace(string(raw))
		if content == "" {
			return nil, true, fmt.Errorf("project knowledge %q is empty", name)
		}
		total += len(content)
		if total > maxBytes {
			return nil, true, errors.New("project knowledge files exceed 256 KiB")
		}
		entries = append(entries, domain.ProjectKnowledgeEntry{ID: id, Content: content})
		if len(entries) > maxEntries {
			return nil, true, errors.New("project knowledge files exceed 128 entries")
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	if len(entries) == 0 && !markerPresent {
		return nil, false, nil
	}
	return entries, true, nil
}

// Save mirrors the current catalog into .wharnex/knowledge using one Markdown
// file per knowledge record. The small catalog.json marker keeps an empty
// catalog representable in Git while all actual knowledge remains separate MD.
func Save(projectRoot string, entries []domain.ProjectKnowledgeEntry) error {
	root := filepath.Clean(projectRoot)
	if info, err := os.Stat(root); err != nil {
		return err
	} else if !info.IsDir() {
		return errors.New("project root is not a directory")
	}
	if len(entries) > maxEntries {
		return errors.New("project knowledge catalog exceeds 128 entries")
	}
	dir := filepath.Join(root, filepath.FromSlash(DirectoryName))
	if err := ensureManagedDirectory(filepath.Join(root, ".wharnex")); err != nil {
		return err
	}
	if err := ensureManagedDirectory(dir); err != nil {
		return err
	}
	wanted := make(map[string]struct{}, len(entries))
	ids := make([]string, 0, len(entries))
	total := 0
	for _, entry := range entries {
		id := strings.TrimSpace(strings.ToLower(entry.ID))
		content := strings.TrimSpace(entry.Content)
		if !entryIDPattern.MatchString(id) {
			return fmt.Errorf("invalid project knowledge id %q", entry.ID)
		}
		if content == "" {
			return fmt.Errorf("project knowledge %q is empty", id)
		}
		if _, duplicate := wanted[id]; duplicate {
			return fmt.Errorf("duplicate project knowledge id %q", id)
		}
		total += len(content)
		if total > maxBytes {
			return errors.New("project knowledge catalog exceeds 256 KiB")
		}
		wanted[id] = struct{}{}
		ids = append(ids, id)
		if err := writeAtomic(filepath.Join(dir, id+".md"), []byte(content+"\n")); err != nil {
			return fmt.Errorf("write project knowledge %q: %w", id, err)
		}
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, item := range items {
		name := item.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			continue
		}
		id := strings.TrimSuffix(strings.ToLower(name), filepath.Ext(name))
		if _, keep := wanted[id]; keep {
			continue
		}
		info, err := item.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return fmt.Errorf("refusing to remove non-regular project knowledge %q", name)
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	sort.Strings(ids)
	marker, err := json.MarshalIndent(catalogMarker{Protocol: domain.KnowledgeProtocolV2, Entries: ids}, "", "  ")
	if err != nil {
		return err
	}
	marker = append(marker, '\n')
	return writeAtomic(filepath.Join(dir, catalogName), marker)
}

func ensureManagedDirectory(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return os.Mkdir(path, 0o755)
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("managed knowledge path %s must be a real directory", path)
	}
	return nil
}

func writeAtomic(target string, content []byte) error {
	dir := filepath.Dir(target)
	temp, err := os.CreateTemp(dir, ".knowledge-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(0o644); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(content); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, target)
}
