package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

// LocalRunner is intentionally development-only. It still works on an isolated
// copy, but it does not provide a container security boundary.
type LocalRunner struct{}

func NewLocalRunner() *LocalRunner { return &LocalRunner{} }
func (r *LocalRunner) Prepare(_ context.Context, projectRoot string) (Workspace, error) {
	return copyProject(projectRoot)
}
func (r *LocalRunner) Cleanup(workspace Workspace) error { return os.RemoveAll(workspace.Path) }

func (r *LocalRunner) ApplyPatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error) {
	path := filepath.Join(workspace.Path, ".kernl-"+ids.New("patch")+".diff")
	if err := os.WriteFile(path, []byte(patch), 0o600); err != nil {
		return domain.CommandResult{}, err
	}
	defer os.Remove(path)
	check := domain.CommandSpec{Argv: []string{"git", "apply", "--check", path}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}
	res, err := r.Run(ctx, workspace, check)
	if err != nil || !res.Success {
		return res, errors.New("git apply --check failed")
	}
	check.Argv = []string{"git", "apply", path}
	return r.Run(ctx, workspace, check)
}

func (r *LocalRunner) Run(ctx context.Context, workspace Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	cwd, err := safeWorkspaceCwd(workspace.Path, command.Cwd)
	if err != nil {
		return domain.CommandResult{}, err
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(command.TimeoutSeconds)*time.Second)
	defer cancel()
	started := time.Now()
	cmd := exec.CommandContext(runCtx, command.Argv[0], command.Argv[1:]...)
	cmd.Dir = cwd
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	code := exitCode(err)
	res := domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: code, Stdout: limit(stdout.String()), Stderr: limit(stderr.String()), DurationMS: time.Since(started).Milliseconds(), Success: containsInt(command.ExpectedExitCodes, code) && runCtx.Err() == nil}
	return res, nil
}
