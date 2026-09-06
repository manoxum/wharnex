package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

type DockerRunner struct{ image string }

func NewDockerRunner(image string) *DockerRunner { return &DockerRunner{image: image} }
func (r *DockerRunner) Prepare(_ context.Context, projectRoot string) (Workspace, error) {
	return copyProject(projectRoot)
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
	if _, err := safeWorkspaceCwd(workspace.Path, command.Cwd); err != nil {
		return domain.CommandResult{}, err
	}
	if err := prepareCommandDependencies(workspace, command); err != nil {
		return domain.CommandResult{}, err
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return domain.CommandResult{}, errors.New("docker CLI not found; build/install Docker or use explicitly-enabled local dev sandbox")
	}
	if err := refuseDockerSocketActivation(); err != nil {
		return domain.CommandResult{}, err
	}
	timeout := time.Duration(command.TimeoutSeconds) * time.Second
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	network := "none"
	if command.Network {
		network = "bridge"
	}
	uid, gid := os.Getuid(), os.Getgid()
	containerCwd := "/workspace"
	if command.Cwd != "" && command.Cwd != "." {
		containerCwd = "/workspace/" + filepath.ToSlash(filepath.Clean(command.Cwd))
	}
	args := []string{
		"run", "--rm", "--read-only", "--network", network,
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--pids-limit", "256", "--memory", "2g", "--cpus", "2",
		"--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=512m",
		"--env", "HOME=/tmp/kernl-home", "--env", "XDG_CACHE_HOME=/tmp/cache",
		"--env", "GOCACHE=/tmp/go-build", "--env", "GOMODCACHE=/workspace/.kernl/go-mod", "--env", "npm_config_cache=/tmp/npm",
		"--user", strconv.Itoa(uid) + ":" + strconv.Itoa(gid),
		"--volume", workspace.Path + ":/workspace:rw",
		"--workdir", containerCwd,
		r.image,
	}
	if !command.Network {
		args = append(args[:len(args)-1], "--env", "GOPROXY=off", args[len(args)-1])
	}
	args = append(args, command.Argv...)
	started := time.Now()
	cmd := exec.CommandContext(runCtx, "docker", args...)
	stdout := newStreamCapture("stdout", onOutput)
	stderr := newStreamCapture("stderr", onOutput)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err := cmd.Run()
	exitCode := exitCode(err)
	result := domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: exitCode, Stdout: limit(stdout.String()), Stderr: limit(stderr.String()), DurationMS: time.Since(started).Milliseconds()}
	result.Success = containsInt(command.ExpectedExitCodes, exitCode) && runCtx.Err() == nil
	if runCtx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("command timeout after %s", timeout)
	}
	if err != nil && !result.Success {
		return result, nil
	}
	return result, nil
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
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
