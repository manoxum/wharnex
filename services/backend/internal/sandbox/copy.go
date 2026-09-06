package sandbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
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
	tmp, err := os.MkdirTemp("", "kernl-workspace-*")
	if err != nil {
		return Workspace{}, err
	}
	tracked, err := isGitRepositoryRoot(root)
	if err != nil {
		_ = os.RemoveAll(tmp)
		return Workspace{}, fmt.Errorf("inspect source git repository: %w", err)
	}
	if tracked {
		if err := cloneGitBaseline(root, tmp); err != nil {
			_ = os.RemoveAll(tmp)
			return Workspace{}, fmt.Errorf("clone sandbox git baseline: %w", err)
		}
		if err := clearSandboxWorkTree(tmp); err != nil {
			_ = os.RemoveAll(tmp)
			return Workspace{}, fmt.Errorf("clear sandbox worktree: %w", err)
		}
	}
	if err := copyEligibleProjectFiles(root, tmp, false); err != nil {
		_ = os.RemoveAll(tmp)
		return Workspace{}, fmt.Errorf("copy project: %w", err)
	}
	if tracked {
		if err := configureSandboxGitRemotes(root, tmp); err != nil {
			_ = os.RemoveAll(tmp)
			return Workspace{}, fmt.Errorf("configure sandbox git remotes: %w", err)
		}
	} else if err := initializeWorkspaceGit(tmp); err != nil {
		_ = os.RemoveAll(tmp)
		return Workspace{}, fmt.Errorf("initialize sandbox git baseline: %w", err)
	}
	return Workspace{Path: tmp, SourcePath: root}, nil
}

// HydrateMissingProjectFiles completes a private partial request base with
// safe files from the current project without replacing any historical file
// already present in that base. Patch/read/barrier paths must be proven present
// separately before this compatibility operation is selected.
func HydrateMissingProjectFiles(target, source string) error {
	root, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	destination, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	if filepath.Clean(root) == filepath.Clean(destination) {
		return errors.New("partial base target must differ from project source")
	}
	return copyEligibleProjectFiles(root, destination, true)
}

func copyEligibleProjectFiles(root, target string, onlyMissing bool) error {
	patterns := contextbundle.LoadIgnorePatterns(root)
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
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
		dst := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		if onlyMissing {
			if _, statErr := os.Lstat(dst); statErr == nil {
				return nil
			} else if !errors.Is(statErr, os.ErrNotExist) {
				return statErr
			}
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

func isGitRepositoryRoot(root string) (bool, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return false, errors.New("git executable not found")
	}
	cmd := exec.Command("git", "-C", root, "rev-parse", "--show-toplevel")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return false, nil
		}
		return false, err
	}
	topLevel, err := filepath.Abs(strings.TrimSpace(string(output)))
	if err != nil {
		return false, err
	}
	return filepath.Clean(topLevel) == filepath.Clean(root), nil
}

func cloneGitBaseline(source, dest string) error {
	cmd := exec.Command("git", "clone", "-q", "--local", "--no-hardlinks", source, dest)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git clone: %s", strings.TrimSpace(string(output)))
	}
	// A clone creates fresh repository metadata and does not copy source hooks or
	// arbitrary local config. Keep signing and hooks disabled inside Protected.
	for _, args := range [][]string{{"config", "commit.gpgSign", "false"}, {"config", "tag.gpgSign", "false"}, {"config", "--unset-all", "core.hooksPath"}} {
		cmd := exec.Command("git", append([]string{"-C", dest}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if output, err := cmd.CombinedOutput(); err != nil && !(len(args) > 1 && args[0] == "config" && args[1] == "--unset-all") {
			return fmt.Errorf("git %s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func clearSandboxWorkTree(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == ".git" {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func configureSandboxGitRemotes(source, dest string) error {
	cmd := exec.Command("git", "-C", source, "remote")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err != nil {
		return err
	}
	sourceRemotes := map[string]string{}
	for _, name := range strings.Fields(string(output)) {
		urlCmd := exec.Command("git", "-C", source, "remote", "get-url", name)
		urlCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		raw, urlErr := urlCmd.Output()
		if urlErr != nil {
			continue
		}
		if safe, ok := safeSandboxRemoteURL(strings.TrimSpace(string(raw))); ok {
			sourceRemotes[name] = safe
		}
	}
	current := exec.Command("git", "-C", dest, "remote")
	current.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	currentOutput, _ := current.Output()
	currentRemotes := map[string]bool{}
	for _, name := range strings.Fields(string(currentOutput)) {
		currentRemotes[name] = true
	}
	for name := range currentRemotes {
		if _, ok := sourceRemotes[name]; ok {
			continue
		}
		remove := exec.Command("git", "-C", dest, "remote", "remove", name)
		remove.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		_ = remove.Run()
	}
	for name, remoteURL := range sourceRemotes {
		var remoteCmd *exec.Cmd
		if currentRemotes[name] {
			remoteCmd = exec.Command("git", "-C", dest, "remote", "set-url", name, remoteURL)
		} else {
			remoteCmd = exec.Command("git", "-C", dest, "remote", "add", name, remoteURL)
		}
		remoteCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if output, err := remoteCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("configure remote %s: %s", name, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func safeSandboxRemoteURL(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	return parsed.String(), true
}

func prepareCommandDependencies(workspace Workspace, command domain.CommandSpec) error {
	if workspace.SourcePath == "" {
		return nil
	}
	if requiresLocalGoDependencies(command.Argv) {
		if err := prepareGoDependencies(workspace, command); err != nil {
			return err
		}
	}
	if !requiresLocalNodeDependencies(command.Argv) {
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

type goModuleDownload struct {
	Path  string
	Dir   string
	Info  string
	GoMod string
	Zip   string
	Error string
}

func prepareGoDependencies(workspace Workspace, command domain.CommandSpec) error {
	sourceCwd, err := safeRelativePath(workspace.SourcePath, command.Cwd)
	if err != nil {
		return err
	}
	moduleRoot, ok := nearestGoModuleRoot(workspace.SourcePath, sourceCwd)
	if !ok {
		return nil
	}
	targetCache := filepath.Join(workspace.Path, ".kernl", "go-mod")
	marker := filepath.Join(targetCache, ".wharness-ready")
	if _, err := os.Stat(marker); err == nil {
		return nil
	}
	cacheOutput, err := exec.Command("go", "env", "GOMODCACHE").Output()
	if err != nil {
		return fmt.Errorf("%w: resolve host Go module cache: %v", ErrOfflineDependenciesUnavailable, err)
	}
	hostCache := strings.TrimSpace(string(cacheOutput))
	if hostCache == "" || !filepath.IsAbs(hostCache) {
		return fmt.Errorf("%w: host GOMODCACHE is unavailable", ErrOfflineDependenciesUnavailable)
	}
	cmd := exec.Command("go", "mod", "download", "-json", "all")
	cmd.Dir = moduleRoot
	cmd.Env = append(os.Environ(), "GOPROXY=off")
	output, downloadErr := cmd.Output()
	decoder := json.NewDecoder(strings.NewReader(string(output)))
	modules := make([]goModuleDownload, 0)
	for {
		var module goModuleDownload
		if err := decoder.Decode(&module); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return fmt.Errorf("%w: decode cached Go module inventory: %v", ErrOfflineDependenciesUnavailable, err)
		}
		if module.Error != "" {
			return fmt.Errorf("%w: %s: %s; run `go mod download` for this project while the host has network access", ErrOfflineDependenciesUnavailable, module.Path, module.Error)
		}
		if module.Dir != "" {
			modules = append(modules, module)
		}
	}
	if downloadErr != nil {
		return fmt.Errorf("%w: required Go modules are not present in the host cache; run `go mod download` for this project while the host has network access", ErrOfflineDependenciesUnavailable)
	}
	for _, module := range modules {
		rel, err := filepath.Rel(hostCache, module.Dir)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("%w: cached module %s escaped GOMODCACHE", ErrOfflineDependenciesUnavailable, module.Path)
		}
		if err := copyDependencyTree(module.Dir, filepath.Join(targetCache, rel), hostCache, targetCache); err != nil {
			return fmt.Errorf("%w: copy cached Go module %s: %v", ErrOfflineDependenciesUnavailable, module.Path, err)
		}
		for _, cachedFile := range []string{module.Info, module.GoMod, module.Zip, module.Zip + "hash"} {
			if cachedFile == "" {
				continue
			}
			fileRel, err := filepath.Rel(hostCache, cachedFile)
			if err != nil || fileRel == ".." || strings.HasPrefix(fileRel, ".."+string(filepath.Separator)) {
				return fmt.Errorf("%w: cached metadata for %s escaped GOMODCACHE", ErrOfflineDependenciesUnavailable, module.Path)
			}
			info, err := os.Stat(cachedFile)
			if err != nil {
				return fmt.Errorf("%w: cached metadata for %s is incomplete: %s", ErrOfflineDependenciesUnavailable, module.Path, filepath.Base(cachedFile))
			}
			if err := copyFile(cachedFile, filepath.Join(targetCache, fileRel), info.Mode().Perm()); err != nil {
				return fmt.Errorf("%w: copy cached metadata for %s: %v", ErrOfflineDependenciesUnavailable, module.Path, err)
			}
		}
	}
	if err := os.MkdirAll(targetCache, 0o755); err != nil {
		return err
	}
	return os.WriteFile(marker, []byte("offline module cache ready\n"), 0o600)
}

func nearestGoModuleRoot(sourceRoot, start string) (string, bool) {
	root := filepath.Clean(sourceRoot)
	current := filepath.Clean(start)
	for {
		if _, err := os.Stat(filepath.Join(current, "go.mod")); err == nil {
			return current, true
		}
		if current == root {
			return "", false
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", false
		}
		current = parent
	}
}

func requiresLocalGoDependencies(argv []string) bool {
	if len(argv) < 2 || filepath.Base(argv[0]) != "go" {
		return false
	}
	switch argv[1] {
	case "build", "install", "list", "run", "test", "vet":
		return true
	default:
		return false
	}
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
