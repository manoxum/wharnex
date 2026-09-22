package sandbox

import (
	"context"
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
	"sync"

	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

func copyProject(source string) (Workspace, error) {
	return copyProjectWithSubmodules(source, map[string]bool{})
}

func copyProjectWithSubmodules(source string, ancestors map[string]bool) (Workspace, error) {
	root, err := filepath.Abs(source)
	if err != nil {
		return Workspace{}, err
	}
	root = filepath.Clean(root)
	if ancestors[root] {
		return Workspace{}, fmt.Errorf("recursive submodule cycle at %s", root)
	}
	lineage := make(map[string]bool, len(ancestors)+1)
	for path := range ancestors {
		lineage[path] = true
	}
	lineage[root] = true
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
	if err := copyEligibleProjectFiles(root, tmp, false, nil); err != nil {
		_ = os.RemoveAll(tmp)
		return Workspace{}, fmt.Errorf("copy project: %w", err)
	}
	if tracked {
		if err := copyInitializedSubmodules(root, tmp, lineage); err != nil {
			_ = os.RemoveAll(tmp)
			return Workspace{}, fmt.Errorf("copy project submodules: %w", err)
		}
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

// copyInitializedSubmodules gives every initialized submodule in the isolated
// workspace its own cloned Git metadata and history. Copying only its files
// makes them invisible to the superproject index and is the reason verified
// submodule patches could not previously be committed.
func copyInitializedSubmodules(sourceRoot, targetRoot string, ancestors map[string]bool) error {
	topology, err := hostrepo.Inspect(context.Background(), sourceRoot)
	if err != nil {
		return err
	}
	for _, submodule := range topology.Submodules {
		if !submodule.Initialized {
			continue
		}
		source := filepath.Join(sourceRoot, filepath.FromSlash(submodule.Path))
		child, err := copyProjectWithSubmodules(source, ancestors)
		if err != nil {
			return fmt.Errorf("%s: %w", submodule.Path, err)
		}
		destination := filepath.Join(targetRoot, filepath.FromSlash(submodule.Path))
		if err := os.RemoveAll(destination); err != nil {
			_ = os.RemoveAll(child.Path)
			return err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			_ = os.RemoveAll(child.Path)
			return err
		}
		if err := os.Rename(child.Path, destination); err != nil {
			_ = os.RemoveAll(child.Path)
			return err
		}
	}
	return nil
}

// HydrateMissingProjectFiles completes a private partial request base with
// safe files from the current project without replacing any historical file
// already present in that base. Patch/read/barrier paths must be proven present
// separately before this compatibility operation is selected.
func HydrateMissingProjectFiles(target, source string) error {
	return HydrateMissingProjectFilesExcept(target, source, nil)
}

// HydrateMissingProjectFilesExcept is HydrateMissingProjectFiles with a set of
// paths left absent on purpose.
//
// It exists for the paths the plan's patch CREATES. Those are absent from the
// archive because they did not exist when the request was planned, which is
// correct. Hydrating them from the current project would only matter when a
// peer created the same path meanwhile — and then the creation hunk fails to
// apply, turning a perfectly ordinary collision into an unrecoverable patch
// error. Leaving them absent keeps the base faithful to the tree the patch was
// authored against, so the candidate applies cleanly and the collision is
// decided where it belongs: the real three-way merge at Apply (ADR-0035).
func HydrateMissingProjectFilesExcept(target, source string, skip []string) error {
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
	excluded := make(map[string]bool, len(skip))
	for _, path := range skip {
		if trimmed := strings.TrimSpace(path); trimmed != "" {
			excluded[filepath.ToSlash(filepath.Clean(trimmed))] = true
		}
	}
	return copyEligibleProjectFiles(root, destination, true, excluded)
}

func copyEligibleProjectFiles(root, target string, onlyMissing bool, excluded map[string]bool) error {
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
		if !entry.IsDir() && excluded[relSlash] {
			return nil
		}
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
	return prepareCommandDependenciesContext(context.Background(), workspace, command)
}

func prepareCommandDependenciesContext(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if workspace.SourcePath == "" {
		return nil
	}
	if requiresLocalGoDependencies(command.Argv) || (command.Network && hydratesGoDependencies(command.Argv)) {
		if err := prepareGoDependenciesContext(ctx, workspace, command); err != nil {
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
		if err := copyDependencyTreeContext(ctx, sourceModules, destModules, workspace.SourcePath, workspace.Path); err != nil {
			return fmt.Errorf("prepare sandbox node dependencies: %w", err)
		}
		copied = true
	}
	if copied {
		return nil
	}
	return fmt.Errorf("%w: node_modules was not found in the project workspace or host tree", ErrNodeDependenciesUnavailable)
}

type goModuleDownload struct {
	Path  string
	Dir   string
	Info  string
	GoMod string
	Zip   string
	Error string
}

// goModuleInventoryCommand inventories the main module's *build list* — the
// exact modules needed to build and verify this project. The `all` pattern is
// deliberately absent: it walks test dependencies of dependencies, which are
// neither required to build or verify the project nor present in the host
// cache, and (since Go 1.18) writing that scope with `-mod=mod` semantics
// rewrites the host go.sum. This inventory is strictly read-only with respect
// to the host: GOFLAGS=-mod=readonly turns any attempt to update go.mod into
// a hard error instead of a silent host mutation.
func goModuleInventoryCommand(moduleRoot string) *exec.Cmd {
	return goModuleInventoryCommandFromCacheContext(context.Background(), moduleRoot, "")
}

func goModuleInventoryCommandFromCache(moduleRoot, cacheRoot string) *exec.Cmd {
	return goModuleInventoryCommandFromCacheContext(context.Background(), moduleRoot, cacheRoot)
}

func goModuleInventoryCommandFromCacheContext(ctx context.Context, moduleRoot, cacheRoot string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "go", "mod", "download", "-json")
	cmd.Dir = moduleRoot
	cmd.Env = append(os.Environ(), "GOPROXY=off", "GOFLAGS=-mod=readonly")
	if cacheRoot != "" {
		cmd.Env = append(cmd.Env, "GOMODCACHE="+cacheRoot)
	}
	return cmd
}

// truncateForError bounds a diagnostic snippet (e.g. captured stderr) so a
// single failing command cannot blow out an error message.
func truncateForError(s string, limit int) string {
	s = strings.TrimSpace(s)
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "…"
}

func prepareGoDependencies(workspace Workspace, command domain.CommandSpec) error {
	return prepareGoDependenciesContext(context.Background(), workspace, command)
}

func prepareGoDependenciesContext(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	targetCache := filepath.Join(workspace.Path, ".kernl", "go-mod")
	if command.Network {
		// A network-approved command resolves modules inside the isolated runner.
		// Seed it from the Wharnex-owned cache when available, but never require
		// either that cache or the host cache before the container can start.
		if err := os.MkdirAll(targetCache, 0o755); err != nil {
			return err
		}
		return mergeGoModuleCacheContext(ctx, workspace.GoModuleCachePath, targetCache)
	}
	sourceCwd, err := safeRelativePath(workspace.SourcePath, command.Cwd)
	if err != nil {
		return err
	}
	moduleRoot, ok := nearestGoModuleRoot(workspace.SourcePath, sourceCwd)
	if !ok {
		return nil
	}
	marker := filepath.Join(targetCache, ".wharness-ready")
	if _, err := os.Stat(marker); err == nil {
		return nil
	}
	if workspace.GoModuleCachePath != "" {
		if err := hydrateGoDependenciesFromCacheContext(ctx, moduleRoot, targetCache, workspace.GoModuleCachePath, "private Wharnex Go module cache"); err == nil {
			return os.WriteFile(marker, []byte("offline module cache ready\n"), 0o600)
		} else if ctx.Err() != nil {
			return ctx.Err()
		}
		// A failed private-cache attempt may have copied a prefix before finding
		// an incomplete entry. Discard only this fresh sandbox cache before
		// falling back to the host compatibility source.
		if err := os.RemoveAll(targetCache); err != nil {
			return fmt.Errorf("reset incomplete private Go module cache: %w", err)
		}
	}
	// This fallback reads the GOMODCACHE of the process Wharnex itself runs in.
	// That is the operator's machine only in development mode; in the normal
	// stack it is the control container, whose /go/pkg/mod does not exist at
	// all. Calling it "host" made a container measurement read as a statement
	// about the operator's machine, so the diagnostic names what was actually
	// inspected (see adr/ADR-0045).
	cacheOutput, err := exec.CommandContext(ctx, "go", "env", "GOMODCACHE").Output()
	if err != nil {
		return fmt.Errorf("%w: resolve the Wharnex runtime Go module cache: %v", ErrOfflineDependenciesUnavailable, err)
	}
	runtimeCache := strings.TrimSpace(string(cacheOutput))
	if runtimeCache == "" || !filepath.IsAbs(runtimeCache) {
		return fmt.Errorf("%w: the Wharnex runtime reports no usable GOMODCACHE", ErrOfflineDependenciesUnavailable)
	}
	if err := hydrateGoDependenciesFromCacheContext(ctx, moduleRoot, targetCache, runtimeCache, runtimeCacheLabel(runtimeCache)); err != nil {
		return err
	}
	if err := os.MkdirAll(targetCache, 0o755); err != nil {
		return err
	}
	return os.WriteFile(marker, []byte("offline module cache ready\n"), 0o600)
}

// runtimeCacheLabel names the compatibility cache in the operator's own terms.
// The distinction is load-bearing for the remedy: an absent cache inside the
// control container is Wharnex's own infrastructure to fix, while an absent
// cache in development mode points at the operator's Go installation.
func runtimeCacheLabel(path string) string {
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return "Wharnex runtime Go module cache (" + path + ", which does not exist in this runtime)"
	}
	return "Wharnex runtime Go module cache (" + path + ")"
}

func hydrateGoDependenciesFromCache(moduleRoot, targetCache, sourceCache, cacheLabel string) error {
	return hydrateGoDependenciesFromCacheContext(context.Background(), moduleRoot, targetCache, sourceCache, cacheLabel)
}

func hydrateGoDependenciesFromCacheContext(ctx context.Context, moduleRoot, targetCache, sourceCache, cacheLabel string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if info, err := os.Stat(sourceCache); err != nil || !info.IsDir() {
		return fmt.Errorf("%w: %s is unavailable", ErrOfflineDependenciesUnavailable, cacheLabel)
	}
	cmd := goModuleInventoryCommandFromCacheContext(ctx, moduleRoot, sourceCache)
	output, downloadErr := cmd.Output()
	if ctx.Err() != nil {
		return ctx.Err()
	}
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
			return fmt.Errorf("%w: %s: %s; this module is in the project's build list but missing from the %s", ErrOfflineDependenciesUnavailable, module.Path, module.Error, cacheLabel)
		}
		if module.Dir != "" {
			modules = append(modules, module)
		}
	}
	if downloadErr != nil {
		detail := ""
		var exitErr *exec.ExitError
		if errors.As(downloadErr, &exitErr) && len(exitErr.Stderr) > 0 {
			detail = fmt.Sprintf(": %s", truncateForError(string(exitErr.Stderr), 2000))
		} else {
			detail = fmt.Sprintf(": %v", downloadErr)
		}
		return fmt.Errorf("%w: the project's Go build list could not be resolved from the %s (GOPROXY=off)%s", ErrOfflineDependenciesUnavailable, cacheLabel, detail)
	}
	for _, module := range modules {
		rel, err := filepath.Rel(sourceCache, module.Dir)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("%w: cached module %s escaped GOMODCACHE", ErrOfflineDependenciesUnavailable, module.Path)
		}
		if err := copyDependencyTreeContext(ctx, module.Dir, filepath.Join(targetCache, rel), sourceCache, targetCache); err != nil {
			return fmt.Errorf("%w: copy cached Go module %s: %v", ErrOfflineDependenciesUnavailable, module.Path, err)
		}
		for _, cachedFile := range []string{module.Info, module.GoMod, module.Zip, module.Zip + "hash"} {
			if cachedFile == "" {
				continue
			}
			fileRel, err := filepath.Rel(sourceCache, cachedFile)
			if err != nil || fileRel == ".." || strings.HasPrefix(fileRel, ".."+string(filepath.Separator)) {
				return fmt.Errorf("%w: cached metadata for %s escaped GOMODCACHE", ErrOfflineDependenciesUnavailable, module.Path)
			}
			info, err := os.Stat(cachedFile)
			if err != nil {
				return fmt.Errorf("%w: cached metadata for %s is incomplete: %s", ErrOfflineDependenciesUnavailable, module.Path, filepath.Base(cachedFile))
			}
			if err := copyFileContext(ctx, cachedFile, filepath.Join(targetCache, fileRel), info.Mode().Perm()); err != nil {
				return fmt.Errorf("%w: copy cached metadata for %s: %v", ErrOfflineDependenciesUnavailable, module.Path, err)
			}
		}
	}
	return nil
}

var goModuleCacheMergeMu sync.Mutex

func markNetworkGoDependenciesReady(workspace Workspace, command domain.CommandSpec) error {
	if !command.Network || !hydratesGoDependencies(command.Argv) {
		return nil
	}
	targetCache := filepath.Join(workspace.Path, ".kernl", "go-mod")
	if err := os.MkdirAll(targetCache, 0o755); err != nil {
		return err
	}
	if workspace.GoModuleCachePath != "" {
		goModuleCacheMergeMu.Lock()
		err := mergeGoModuleCache(targetCache, workspace.GoModuleCachePath)
		goModuleCacheMergeMu.Unlock()
		if err != nil {
			return fmt.Errorf("persist private Go module cache: %w", err)
		}
	}
	return os.WriteFile(filepath.Join(targetCache, ".wharness-ready"), []byte("network-approved module cache ready\n"), 0o600)
}

// mergeGoModuleCache copies only immutable, missing cache entries. Go module
// cache paths are content/version addressed, so an existing path is never
// overwritten. The per-execution readiness marker is intentionally excluded:
// every fresh sandbox validates its current build list before running offline.
func mergeGoModuleCache(source, destination string) error {
	return mergeGoModuleCacheContext(context.Background(), source, destination)
}

func mergeGoModuleCacheContext(ctx context.Context, source, destination string) error {
	if source == "" || destination == "" || filepath.Clean(source) == filepath.Clean(destination) {
		return nil
	}
	info, err := os.Stat(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("Go module cache source is not a directory")
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("Go module cache entry escaped its root")
		}
		if rel == ".wharness-ready" {
			return nil
		}
		target := destination
		if rel != "." {
			target = filepath.Join(destination, rel)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("Go module cache symlink is not allowed: %s", rel)
		}
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		fileInfo, err := entry.Info()
		if err != nil {
			return err
		}
		if !fileInfo.Mode().IsRegular() {
			return nil
		}
		if _, err := os.Lstat(target); err == nil {
			return nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return copyFileContext(ctx, path, target, fileInfo.Mode().Perm())
	})
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

func hydratesGoDependencies(argv []string) bool {
	if requiresLocalGoDependencies(argv) {
		return true
	}
	return len(argv) >= 3 && filepath.Base(argv[0]) == "go" && argv[1] == "mod" && argv[2] == "download"
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
	return copyDependencyTreeContext(context.Background(), source, dest, sourceRoot, destRoot)
}

func copyDependencyTreeContext(ctx context.Context, source, dest, sourceRoot, destRoot string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
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
		return copyFileContext(ctx, path, dst, info.Mode().Perm())
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
		{"git", "-C", root, "-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost", "-c", "commit.gpgSign=false", "commit", "-q", "--allow-empty", "-m", "Wharnex sandbox baseline"},
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
	return copyFileContext(context.Background(), source, dest, mode)
}

func copyFileContext(ctx context.Context, source, dest string, mode os.FileMode) error {
	if err := ctx.Err(); err != nil {
		return err
	}
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
	buffer := make([]byte, 128*1024)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		read, readErr := src.Read(buffer)
		if read > 0 {
			if _, writeErr := dst.Write(buffer[:read]); writeErr != nil {
				return writeErr
			}
		}
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
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
