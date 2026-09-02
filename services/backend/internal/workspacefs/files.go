package workspacefs

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	contextbundle "kernl.local/harness/backend/internal/contextbundle"
)

const MaxEditableBytes int64 = 2 * 1024 * 1024

type Entry struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Size int64  `json:"size"`
}

type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
}

func List(root string) ([]Entry, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	patterns := contextbundle.LoadIgnorePatterns(root)
	entries := make([]Entry, 0, 256)
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if contextbundle.ShouldIgnoreWithPatterns(rel, entry.IsDir(), patterns) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		kind := "file"
		if entry.IsDir() {
			kind = "directory"
		}
		entries = append(entries, Entry{Path: rel, Name: entry.Name(), Kind: kind, Size: info.Size()})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == "directory"
		}
		return entries[i].Path < entries[j].Path
	})
	return entries, nil
}

func Read(root, rel string) (File, error) {
	path, err := safeExistingFile(root, rel)
	if err != nil {
		return File{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return File{}, err
	}
	if info.Size() > MaxEditableBytes {
		return File{}, fmt.Errorf("file exceeds %d byte editor limit", MaxEditableBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return File{}, err
	}
	if !utf8.Valid(data) || containsNUL(data) {
		return File{}, errors.New("binary/non-UTF8 file cannot be opened in text editor")
	}
	return File{Path: filepath.ToSlash(filepath.Clean(rel)), Content: string(data), SHA256: hash(data), Size: int64(len(data))}, nil
}

func Write(root, rel, content, expectedSHA string) (File, error) {
	if int64(len(content)) > MaxEditableBytes {
		return File{}, fmt.Errorf("file exceeds %d byte editor limit", MaxEditableBytes)
	}
	path, err := safeTargetFile(root, rel)
	if err != nil {
		return File{}, err
	}
	mode := os.FileMode(0o644)
	if existing, err := os.ReadFile(path); err == nil {
		if expectedSHA != "" && hash(existing) != expectedSHA {
			return File{}, errors.New("file changed on disk; reload before saving")
		}
		if info, statErr := os.Stat(path); statErr == nil {
			mode = info.Mode().Perm()
		}
	} else if !os.IsNotExist(err) {
		return File{}, err
	}

	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return File{}, err
	}
	tmp, err := os.CreateTemp(parent, ".kernl-save-*")
	if err != nil {
		return File{}, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return File{}, err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return File{}, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return File{}, err
	}
	if err := tmp.Close(); err != nil {
		return File{}, err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return File{}, err
	}
	return Read(root, rel)
}

func safeExistingFile(root, rel string) (string, error) {
	path, err := safeTargetFile(root, rel)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("symlink files are not editable")
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("path is not a regular file")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	if err := ensureInside(root, resolved); err != nil {
		return "", err
	}
	return path, nil
}

func safeTargetFile(root, rel string) (string, error) {
	if strings.TrimSpace(rel) == "" {
		return "", errors.New("file path is required")
	}
	if filepath.IsAbs(rel) {
		return "", errors.New("absolute file path denied")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("file path escapes project root")
	}
	relSlash := filepath.ToSlash(clean)
	if contextbundle.ShouldIgnoreWithPatterns(relSlash, false, contextbundle.LoadIgnorePatterns(root)) {
		return "", errors.New("file is excluded by harness security/context policy")
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	target := filepath.Join(absoluteRoot, clean)
	if err := ensureInside(absoluteRoot, target); err != nil {
		return "", err
	}
	if info, statErr := os.Lstat(target); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("symlink files are not editable")
		}
		if !info.Mode().IsRegular() {
			return "", errors.New("target path is not a regular file")
		}
	} else if !os.IsNotExist(statErr) {
		return "", statErr
	}
	parent := filepath.Dir(target)
	parentRel, err := filepath.Rel(absoluteRoot, parent)
	if err != nil {
		return "", err
	}
	current := absoluteRoot
	for _, part := range strings.Split(parentRel, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if os.IsNotExist(statErr) {
			continue
		}
		if statErr != nil {
			return "", statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("symlink parent directories are not editable")
		}
		if !info.IsDir() {
			return "", errors.New("file parent path contains a non-directory component")
		}
	}
	return target, nil
}

func ensureInside(root, target string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return errors.New("path escapes project root")
	}
	return nil
}

func containsNUL(data []byte) bool {
	for _, b := range data {
		if b == 0 {
			return true
		}
	}
	return false
}

func hash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
