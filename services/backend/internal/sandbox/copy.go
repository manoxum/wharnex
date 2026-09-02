package sandbox

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	contextbundle "kernl.local/harness/backend/internal/contextbundle"
)

func copyProject(source string) (Workspace, error) {
	root, err := filepath.Abs(source)
	if err != nil {
		return Workspace{}, err
	}
	patterns := contextbundle.LoadIgnorePatterns(root)
	tmp, err := os.MkdirTemp("", "kernl-workspace-*")
	if err != nil {
		return Workspace{}, err
	}
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." {
			return err
		}
		relSlash := filepath.ToSlash(rel)
		if contextbundle.ShouldIgnoreWithPatterns(relSlash, entry.IsDir(), patterns) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		dst := filepath.Join(tmp, rel)
		if entry.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyFile(path, dst, info.Mode().Perm())
	}); err != nil {
		_ = os.RemoveAll(tmp)
		return Workspace{}, fmt.Errorf("copy project: %w", err)
	}
	return Workspace{Path: tmp}, nil
}

func copyFile(source, dest string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}

func safeWorkspaceCwd(workspace, cwd string) (string, error) {
	if cwd == "" || cwd == "." {
		return workspace, nil
	}
	joined := filepath.Join(workspace, filepath.Clean(cwd))
	rel, err := filepath.Rel(workspace, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("cwd escapes workspace")
	}
	if info, err := os.Stat(joined); err != nil || !info.IsDir() {
		return "", fmt.Errorf("cwd does not exist: %s", cwd)
	}
	resolved, err := filepath.EvalSymlinks(joined)
	if err != nil {
		return "", err
	}
	rel, err = filepath.Rel(workspace, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("cwd symlink escapes workspace")
	}
	return joined, nil
}
