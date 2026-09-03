package sandbox

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
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
	if err := initializeWorkspaceGit(tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return Workspace{}, fmt.Errorf("initialize sandbox git baseline: %w", err)
	}
	return Workspace{Path: tmp, SourcePath: root}, nil
}

func prepareCommandDependencies(workspace Workspace, command domain.CommandSpec) error {
	if !requiresLocalNodeDependencies(command.Argv) || workspace.SourcePath == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(workspace.Path, ".pnp.cjs")); err == nil {
		return nil
	}

	relCwd := command.Cwd
	if relCwd == "" || relCwd == "." {
		relCwd = "."
	}
	if _, err := safeRelativePath(workspace.SourcePath, relCwd); err != nil {
		return err
	}
	if _, err := safeRelativePath(workspace.Path, relCwd); err != nil {
		return err
	}

	candidates := [][2]string{{workspace.SourcePath, workspace.Path}}
	if relCwd != "." {
		candidates = append(candidates, [2]string{
			filepath.Join(workspace.SourcePath, filepath.Clean(relCwd)),
			filepath.Join(workspace.Path, filepath.Clean(relCwd)),
		})
	}
	copied := false
	for _, candidate := range candidates {
		sourceModules := filepath.Join(candidate[0], "node_modules")
		destModules := filepath.Join(candidate[1], "node_modules")
		if info, err := os.Stat(destModules); err == nil && info.IsDir() {
			copied = true
			continue
		}
		info, err := os.Stat(sourceModules)
		if err != nil || !info.IsDir() {
			continue
		}
		if err := copyDependencyTree(sourceModules, destModules, workspace.SourcePath, workspace.Path); err != nil {
			return fmt.Errorf("prepare sandbox node dependencies: %w", err)
		}
		copied = true
	}
	if copied {
		return nil
	}
	return errors.New("sandbox node dependencies unavailable: node_modules was not found in the project; install dependencies on the host before Protected execution")
}

func requiresLocalNodeDependencies(argv []string) bool {
	if len(argv) == 0 {
		return false
	}
	tool := filepath.Base(argv[0])
	switch tool {
	case "npx":
		return true
	case "npm":
		if len(argv) < 2 {
			return false
		}
		switch argv[1] {
		case "run", "run-script", "test", "start", "exec":
			return true
		}
	case "pnpm", "yarn", "bun":
		if len(argv) < 2 {
			return false
		}
		switch argv[1] {
		case "install", "add", "remove", "update", "config", "cache", "--version", "-v":
			return false
		default:
			return true
		}
	}
	return false
}

func copyDependencyTree(source, dest, sourceRoot, destRoot string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		dst := dest
		if rel != "." {
			dst = filepath.Join(dest, rel)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			resolved := target
			if !filepath.IsAbs(resolved) {
				resolved = filepath.Join(filepath.Dir(path), resolved)
			}
			resolved = filepath.Clean(resolved)
			targetRel, err := filepath.Rel(sourceRoot, resolved)
			if err != nil || targetRel == ".." || strings.HasPrefix(targetRel, ".."+string(filepath.Separator)) {
				return fmt.Errorf("dependency symlink escapes project: %s -> %s", path, target)
			}
			destTarget := filepath.Join(destRoot, targetRel)
			rewritten, err := filepath.Rel(filepath.Dir(dst), destTarget)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			return os.Symlink(rewritten, dst)
		}
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
	})
}

func safeRelativePath(root, relative string) (string, error) {
	joined := filepath.Join(root, filepath.Clean(relative))
	rel, err := filepath.Rel(root, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("cwd escapes project")
	}
	return joined, nil
}

func initializeWorkspaceGit(root string) error {
	if _, err := exec.LookPath("git"); err != nil {
		return errors.New("git executable not found")
	}
	commands := [][]string{
		{"git", "-C", root, "init", "-q"},
		{"git", "-C", root, "add", "-A"},
		{"git", "-C", root, "-c", "user.name=Wharness", "-c", "user.email=wharness@localhost", "-c", "commit.gpgSign=false", "commit", "-q", "--allow-empty", "-m", "Wharness sandbox baseline"},
	}
	for _, argv := range commands {
		cmd := exec.Command(argv[0], argv[1:]...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %s", strings.Join(argv, " "), strings.TrimSpace(string(output)))
		}
	}
	return nil
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
