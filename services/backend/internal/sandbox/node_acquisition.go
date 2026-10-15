package sandbox

import (
	"context"
	"errors"
	"os/exec"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox/nodecontext"
)

func (r *DockerRunner) prepareDockerCommand(runCtx context.Context, workspace Workspace, command domain.CommandSpec, timeout time.Duration, started time.Time) (domain.CommandResult, error) {
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
	return domain.CommandResult{}, nil
}

func (r *DockerRunner) acquireNodeDependencies(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	limits := CurrentRunnerLimits()
	return nodecontext.Acquire(ctx, workspace.Path, r.image, command, nodecontext.Limits{Pids: limits.Pids, Memory: limits.Memory, CPUs: limits.CPUs, TmpfsSize: limits.TmpfsSize}, safeWorkspaceCwd)
}

func nodeDependencyInstallCommand(workspacePath, commandCwd string) ([]string, string, error) {
	return nodecontext.InstallCommand(workspacePath, domain.CommandSpec{Cwd: commandCwd}, safeWorkspaceCwd)
}

func transientNodeDependencyFetch(output string) bool { return nodecontext.TransientFetch(output) }
