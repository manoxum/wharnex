package sandbox

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

type DockerRunner struct {
	image              string
	dependencyCacheDir string
}

func NewDockerRunner(image string) *DockerRunner { return &DockerRunner{image: image} }
func NewDockerRunnerWithDependencyCache(image, cacheDir string) *DockerRunner {
	return &DockerRunner{image: image, dependencyCacheDir: filepath.Clean(cacheDir)}
}
func (r *DockerRunner) Prepare(ctx context.Context, projectRoot string) (Workspace, error) {
	return r.PrepareFromProject(ctx, projectRoot, projectRoot)
}

// PrepareFromProject copies executionRoot into an isolated workspace while
// keying the private dependency cache on projectPath. The two differ whenever a
// request is rooted at its own immutable base: the tree to execute is a
// temporary extraction, but the cache it must share belongs to the project.
func (r *DockerRunner) PrepareFromProject(_ context.Context, executionRoot, projectPath string) (Workspace, error) {
	workspace, err := copyProject(executionRoot)
	if err != nil {
		return Workspace{}, err
	}
	workspace.ProjectPath = canonicalProjectPath(projectPath, workspace.SourcePath)
	if r.dependencyCacheDir != "" && r.dependencyCacheDir != "." {
		projectKey := fmt.Sprintf("%x", sha256.Sum256([]byte(workspace.ProjectPath)))
		workspace.GoModuleCachePath = filepath.Join(r.dependencyCacheDir, "go-mod", projectKey)
	}
	return workspace, nil
}

// canonicalProjectPath resolves the key the dependency cache is bound to,
// falling back to the executed tree only when no project is supplied — never
// silently, because that fallback is the defect this function exists to close.
func canonicalProjectPath(projectPath, sourcePath string) string {
	if trimmed := strings.TrimSpace(projectPath); trimmed != "" {
		if absolute, err := filepath.Abs(trimmed); err == nil {
			return filepath.Clean(absolute)
		}
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(sourcePath)
}
func (r *DockerRunner) Cleanup(workspace Workspace) error { return os.RemoveAll(workspace.Path) }

func (r *DockerRunner) ApplyPatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error) {
	dir := filepath.Join(workspace.Path, ".kernl")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return domain.CommandResult{}, err
	}
	path := filepath.Join(dir, ids.New("patch")+".diff")
	if err := os.WriteFile(path, []byte(patch), 0o600); err != nil {
		return domain.CommandResult{}, err
	}
	defer os.Remove(path)
	return applyPatchWithStrategies(ctx, workspace, patch, "/workspace/.kernl/"+filepath.Base(path), 60, r.Run)
}

func (r *DockerRunner) Run(ctx context.Context, workspace Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	return r.RunStreaming(ctx, workspace, command, nil)
}

func (r *DockerRunner) RunStreaming(ctx context.Context, workspace Workspace, command domain.CommandSpec, onOutput StreamCallback) (domain.CommandResult, error) {
	timeout := time.Duration(command.TimeoutSeconds) * time.Second
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	if _, err := safeWorkspaceCwd(workspace.Path, command.Cwd); err != nil {
		return domain.CommandResult{}, err
	}
	needNodeAcquisition := false
	if err := prepareCommandDependenciesContext(runCtx, workspace, command); err != nil {
		if errors.Is(err, ErrNodeDependenciesUnavailable) {
			needNodeAcquisition = true
		} else {
			return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: -1, DurationMS: time.Since(started).Milliseconds()}, commandPreparationError(runCtx, timeout, "dependency preparation", err)
		}
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return domain.CommandResult{}, errors.New("docker CLI not found; build/install Docker or use explicitly-enabled local dev sandbox")
	}
	if err := refuseDockerSocketActivationContext(runCtx); err != nil {
		return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: -1, DurationMS: time.Since(started).Milliseconds()}, commandPreparationError(runCtx, timeout, "Docker daemon preflight", err)
	}
	if err := ensureLocalRunnerImage(runCtx, r.image); err != nil {
		return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: -1, DurationMS: time.Since(started).Milliseconds()}, commandPreparationError(runCtx, timeout, "runner image check", err)
	}
	if needNodeAcquisition {
		if err := r.acquireNodeDependencies(runCtx, workspace, command); err != nil {
			return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: -1, DurationMS: time.Since(started).Milliseconds(), Stderr: limit(err.Error())}, commandPreparationError(runCtx, timeout, "node dependency acquisition", err)
		}
		if err := prepareCommandDependenciesContext(runCtx, workspace, command); err != nil {
			return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: -1, DurationMS: time.Since(started).Milliseconds()}, commandPreparationError(runCtx, timeout, "dependency preparation after acquisition", err)
		}
	}
	network := "none"
	if command.Network {
		network = "bridge"
	}
	uid, gid := os.Getuid(), os.Getgid()
	containerCwd := "/workspace"
	if command.Cwd != "" && command.Cwd != "." {
		containerCwd = "/workspace/" + filepath.ToSlash(filepath.Clean(command.Cwd))
	}
	limits := CurrentRunnerLimits()
	// GOCACHE lives on the workspace bind mount rather than the tmpfs: a
	// race-instrumented build of a large module writes far more object cache
	// than any reasonable tmpfs size, and overflowing it fails the request
	// with "no space left on device" — an infrastructure fault the repair
	// loop cannot fix. The directory must exist before the read-only-root
	// container starts, because only /workspace and /tmp are writable.
	if err := os.MkdirAll(filepath.Join(workspace.Path, ".kernl", "go-build"), 0o700); err != nil {
		return domain.CommandResult{}, fmt.Errorf("prepare sandbox build cache: %w", err)
	}
	args := []string{
		"run", "--rm", "--read-only", "--network", network,
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--pids-limit", strconv.Itoa(limits.Pids), "--memory", limits.Memory, "--cpus", limits.CPUs,
		"--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=" + limits.TmpfsSize,
		"--env", "HOME=/tmp/kernl-home", "--env", "XDG_CACHE_HOME=/tmp/cache",
		"--env", "COREPACK_HOME=/workspace/.kernl/corepack",
		"--env", "GOCACHE=" + workspaceGoBuildCache, "--env", "GOMODCACHE=/workspace/.kernl/go-mod", "--env", "npm_config_cache=/workspace/.kernl/npm-cache",
		"--user", strconv.Itoa(uid) + ":" + strconv.Itoa(gid),
		"--volume", workspace.Path + ":/workspace:rw",
		"--workdir", containerCwd,
		r.image,
	}
	imageIndex := len(args) - 1
	if !command.Network {
		args = append(args[:imageIndex], "--env", "GOPROXY=off", args[imageIndex])
		imageIndex = len(args) - 1
	}
	for _, name := range command.EnvAllowlist {
		if _, ok := os.LookupEnv(name); !ok {
			continue
		}
		args = append(args[:imageIndex], append([]string{"--env", name}, args[imageIndex:]...)...)
		imageIndex += 2
	}
	args = append(args, command.Argv...)
	cmd := exec.CommandContext(runCtx, "docker", args...)
	stdout := newStreamCapture("stdout", onOutput)
	stderr := newStreamCapture("stderr", onOutput)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err := cmd.Run()
	exitCode := exitCode(err)
	result := domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: exitCode, Stdout: limit(stdout.String()), Stderr: processStderr(stderr.String(), err), DurationMS: time.Since(started).Milliseconds()}
	result.Success = containsInt(command.ExpectedExitCodes, exitCode) && runCtx.Err() == nil
	if result.Success {
		if markerErr := markNetworkGoDependenciesReady(workspace, command); markerErr != nil {
			return result, fmt.Errorf("persist network-approved Go dependency cache: %w", markerErr)
		}
	}
	if runCtx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("command timeout after %s", timeout)
	}
	if err != nil && !result.Success {
		return result, nil
	}
	return result, nil
}

func (r *DockerRunner) acquireNodeDependencies(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	argv, relCwd, err := nodeDependencyInstallCommand(workspace.Path, command.Cwd)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNodeDependencyAcquisition, err)
	}
	if err := os.MkdirAll(filepath.Join(workspace.Path, ".kernl", "corepack"), 0o700); err != nil {
		return fmt.Errorf("%w: prepare Corepack cache: %v", ErrNodeDependencyAcquisition, err)
	}
	if err := os.MkdirAll(filepath.Join(workspace.Path, ".kernl", "npm-cache"), 0o700); err != nil {
		return fmt.Errorf("%w: prepare npm cache: %v", ErrNodeDependencyAcquisition, err)
	}
	uid, gid := os.Getuid(), os.Getgid()
	limits := CurrentRunnerLimits()
	containerCwd := "/workspace"
	if relCwd != "." {
		containerCwd += "/" + filepath.ToSlash(relCwd)
	}
	base := []string{
		"run", "--rm", "--read-only", "--network", "bridge",
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--pids-limit", strconv.Itoa(limits.Pids), "--memory", limits.Memory, "--cpus", limits.CPUs,
		"--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=" + limits.TmpfsSize,
		"--env", "HOME=/tmp/kernl-home", "--env", "XDG_CACHE_HOME=/tmp/cache",
		"--env", "COREPACK_HOME=/workspace/.kernl/corepack", "--env", "npm_config_cache=/workspace/.kernl/npm-cache",
		"--user", strconv.Itoa(uid) + ":" + strconv.Itoa(gid),
		"--volume", workspace.Path + ":/workspace:rw",
		"--workdir", containerCwd, r.image,
	}
	const attempts = 3
	var last string
	for attempt := 1; attempt <= attempts; attempt++ {
		args := append(append([]string(nil), base...), argv...)
		output, runErr := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		last = strings.TrimSpace(string(output))
		if runErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !transientNodeDependencyFetch(last) || attempt == attempts {
			return fmt.Errorf("%w after %d attempt(s) running %s: %s", ErrNodeDependencyAcquisition, attempt, strings.Join(argv, " "), last)
		}
		time.Sleep(time.Duration(attempt) * 250 * time.Millisecond)
	}
	return fmt.Errorf("%w: %s", ErrNodeDependencyAcquisition, last)
}

func nodeDependencyInstallCommand(workspacePath, commandCwd string) ([]string, string, error) {
	root := filepath.Clean(workspacePath)
	rel := strings.TrimSpace(commandCwd)
	if rel == "" {
		rel = "."
	}
	start, err := safeWorkspaceCwd(root, rel)
	if err != nil {
		return nil, "", err
	}
	current := start
	for {
		if _, err := os.Stat(filepath.Join(current, "pnpm-lock.yaml")); err == nil {
			return []string{"pnpm", "install", "--frozen-lockfile"}, relativeWorkspaceDir(root, current), nil
		}
		if _, err := os.Stat(filepath.Join(current, "yarn.lock")); err == nil {
			return []string{"yarn", "install", "--frozen-lockfile"}, relativeWorkspaceDir(root, current), nil
		}
		if _, err := os.Stat(filepath.Join(current, "package-lock.json")); err == nil {
			return []string{"npm", "ci"}, relativeWorkspaceDir(root, current), nil
		}
		if _, err := os.Stat(filepath.Join(current, "npm-shrinkwrap.json")); err == nil {
			return []string{"npm", "ci"}, relativeWorkspaceDir(root, current), nil
		}
		if current == root {
			break
		}
		parent := filepath.Dir(current)
		if parent == current || !strings.HasPrefix(parent+string(filepath.Separator), root+string(filepath.Separator)) && parent != root {
			break
		}
		current = parent
	}
	return nil, "", errors.New("no supported lockfile found; automatic sandbox acquisition requires pnpm-lock.yaml, yarn.lock, package-lock.json or npm-shrinkwrap.json")
}

func relativeWorkspaceDir(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "" {
		return "."
	}
	return filepath.Clean(rel)
}

func transientNodeDependencyFetch(output string) bool {
	lower := strings.ToLower(output)
	for _, marker := range []string{"eai_again", "enotfound", "econnreset", "etimedout", "temporary failure in name resolution", "connection reset by peer", "network is unreachable", "registry.npmjs.org"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	var execErr *exec.Error
	if errors.As(err, &execErr) && errors.Is(execErr.Err, exec.ErrNotFound) {
		return 127
	}
	return -1
}

// processStderr preserves failures that happen before a child process exists.
// exec.Cmd cannot write those errors to the child's stderr stream, so without
// this normalization callers see only exit -1 with an empty diagnostic and
// cannot distinguish a missing host tool from a source regression.
func processStderr(captured string, runErr error) string {
	if strings.TrimSpace(captured) != "" || runErr == nil {
		return limit(captured)
	}
	return limit(runErr.Error())
}
func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func limit(s string) string {
	const max = 200000
	if len(s) > max {
		return s[:max] + "\n…[truncated]"
	}
	return s
}
func firstErr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}
