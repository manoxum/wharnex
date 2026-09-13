package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

// LocalRunner is intentionally development-only. It still works on an isolated
// copy, but it does not provide a container security boundary.
type LocalRunner struct{}

func NewLocalRunner() *LocalRunner { return &LocalRunner{} }
func (r *LocalRunner) Prepare(ctx context.Context, projectRoot string) (Workspace, error) {
	return r.PrepareFromProject(ctx, projectRoot, projectRoot)
}

// PrepareFromProject mirrors DockerRunner's project scoping so development-mode
// execution records the same canonical project, even though the local runner
// keeps no private dependency cache of its own.
func (r *LocalRunner) PrepareFromProject(_ context.Context, executionRoot, projectPath string) (Workspace, error) {
	workspace, err := copyProject(executionRoot)
	if err != nil {
		return Workspace{}, err
	}
	workspace.ProjectPath = canonicalProjectPath(projectPath, workspace.SourcePath)
	return workspace, nil
}
func (r *LocalRunner) Cleanup(workspace Workspace) error { return os.RemoveAll(workspace.Path) }

func (r *LocalRunner) ApplyPatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error) {
	path := filepath.Join(workspace.Path, ".kernl-"+ids.New("patch")+".diff")
	if err := os.WriteFile(path, []byte(patch), 0o600); err != nil {
		return domain.CommandResult{}, err
	}
	defer os.Remove(path)
	return applyPatchWithStrategies(ctx, workspace, patch, path, 30, r.Run)
}

func (r *LocalRunner) Run(ctx context.Context, workspace Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	return r.RunStreaming(ctx, workspace, command, nil)
}

func (r *LocalRunner) RunStreaming(ctx context.Context, workspace Workspace, command domain.CommandSpec, onOutput StreamCallback) (domain.CommandResult, error) {
	cwd, err := safeWorkspaceCwd(workspace.Path, command.Cwd)
	if err != nil {
		return domain.CommandResult{}, err
	}
	if err := prepareCommandDependencies(workspace, command); err != nil {
		return domain.CommandResult{}, err
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(command.TimeoutSeconds)*time.Second)
	defer cancel()
	started := time.Now()
	cmd := exec.CommandContext(runCtx, command.Argv[0], command.Argv[1:]...)
	cmd.Dir = cwd
	stdout := newStreamCapture("stdout", onOutput)
	stderr := newStreamCapture("stderr", onOutput)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err = cmd.Run()
	code := exitCode(err)
	res := domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: code, Stdout: limit(stdout.String()), Stderr: limit(stderr.String()), DurationMS: time.Since(started).Milliseconds(), Success: containsInt(command.ExpectedExitCodes, code) && runCtx.Err() == nil}
	return res, nil
}
