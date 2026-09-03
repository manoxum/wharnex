package workspacefs

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	contextbundle "kernl.local/harness/backend/internal/contextbundle"
)

func CreateFile(root, rel string) (File, error) {
	path, err := safeNewPath(root, rel, false)
	if err != nil {
		return File{}, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return File{}, errors.New("file already exists")
		}
		return File{}, err
	}
	if err := file.Close(); err != nil {
		return File{}, err
	}
	return Read(root, rel)
}

func CreateDirectory(root, rel string) error {
	path, err := safeNewPath(root, rel, true)
	if err != nil {
		return err
	}
	if err := os.Mkdir(path, 0o755); err != nil {
		if os.IsExist(err) {
			return errors.New("directory already exists")
		}
		return err
	}
	return nil
}

func Rename(root, from, to string) error {
	source, info, err := safeExistingPath(root, from)
	if err != nil {
		return err
	}
	target, err := safeNewPath(root, to, info.IsDir())
	if err != nil {
		return err
	}
	if err := os.Rename(source, target); err != nil {
		return fmt.Errorf("rename workspace path: %w", err)
	}
	return nil
}

func Delete(root, rel string) error {
	path, info, err := safeExistingPath(root, rel)
	if err != nil {
		return err
	}
	if info.IsDir() {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("delete workspace directory: %w", err)
		}
		return nil
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("delete workspace file: %w", err)
	}
	return nil
}

func safeExistingPath(root, rel string) (string, os.FileInfo, error) {
	path, clean, err := safeRelativePath(root, rel)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", nil, errors.New("symlink workspace paths are not mutable")
	}
	if !info.Mode().IsRegular() && !info.IsDir() {
		return "", nil, errors.New("workspace path must be a regular file or directory")
	}
	if contextbundle.ShouldIgnoreWithPatterns(clean, info.IsDir(), contextbundle.LoadIgnorePatterns(root)) {
		return "", nil, errors.New("path is excluded by harness security/context policy")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", nil, err
	}
	if err := ensureInside(root, resolved); err != nil {
		return "", nil, err
	}
	return path, info, nil
}

func safeNewPath(root, rel string, directory bool) (string, error) {
	path, clean, err := safeRelativePath(root, rel)
	if err != nil {
		return "", err
	}
	if contextbundle.ShouldIgnoreWithPatterns(clean, directory, contextbundle.LoadIgnorePatterns(root)) {
		return "", errors.New("path is excluded by harness security/context policy")
	}
	if _, err := os.Lstat(path); err == nil {
		return "", errors.New("target path already exists")
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if err := validateParentChain(root, filepath.Dir(path)); err != nil {
		return "", err
	}
	return path, nil
}

func safeRelativePath(root, rel string) (string, string, error) {
	if strings.TrimSpace(rel) == "" {
		return "", "", errors.New("workspace path is required")
	}
	if filepath.IsAbs(rel) {
		return "", "", errors.New("absolute workspace path denied")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", "", errors.New("workspace path escapes project root")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", "", err
	}
	target := filepath.Join(rootAbs, clean)
	if err := ensureInside(rootAbs, target); err != nil {
		return "", "", err
	}
	return target, filepath.ToSlash(clean), nil
}

func validateParentChain(root, parent string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if err := ensureInside(rootAbs, parent); err != nil {
		return err
	}
	rel, err := filepath.Rel(rootAbs, parent)
	if err != nil {
		return err
	}
	current := rootAbs
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if os.IsNotExist(statErr) {
			return errors.New("parent directory does not exist")
		}
		if statErr != nil {
			return statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("symlink parent directories are not mutable")
		}
		if !info.IsDir() {
			return errors.New("workspace parent path contains a non-directory component")
		}
	}
	return nil
}
