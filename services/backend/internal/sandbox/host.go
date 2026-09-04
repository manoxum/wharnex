package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// HostRunner executes directly in the real project tree. It deliberately
// provides no isolation boundary. It is used by explicit Unprotected execution
// and by the human-only Editor Host terminal after its dedicated confirmation.
type HostRunner struct{}

func NewHostRunner() *HostRunner { return &HostRunner{} }

func (r *HostRunner) Prepare(_ context.Context, projectRoot string) (Workspace, error) {
	root, err := filepath.Abs(projectRoot)
	if err != nil {
		return Workspace{}, err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return Workspace{}, errors.New("host project path must be an existing directory")
	}
	return Workspace{Path: root, SourcePath: root}, nil
}

func (r *HostRunner) Cleanup(Workspace) error { return nil }

func (r *HostRunner) ApplyPatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return domain.CommandResult{}, errors.New("git executable not found")
	}
	file, err := os.CreateTemp("", "wharness-host-patch-*.diff")
	if err != nil {
		return domain.CommandResult{}, err
	}
	path := file.Name()
	if _, err := file.WriteString(patch); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return domain.CommandResult{}, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return domain.CommandResult{}, err
	}
	defer os.Remove(path)
	return applyPatchWithStrategies(ctx, workspace, patch, path, 60, r.Run)
}

func (r *HostRunner) ReversePatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return domain.CommandResult{}, errors.New("git executable not found")
	}
	file, err := os.CreateTemp("", "wharness-host-revert-*.diff")
	if err != nil {
		return domain.CommandResult{}, err
	}
	path := file.Name()
	if _, err := file.WriteString(patch); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return domain.CommandResult{}, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return domain.CommandResult{}, err
	}
	defer os.Remove(path)
	check := domain.CommandSpec{Argv: []string{"git", "apply", "--reverse", "--check", path}, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	checked, err := r.Run(ctx, workspace, check)
	if err != nil || !checked.Success {
		if err != nil {
			return checked, err
		}
		return checked, fmt.Errorf("reverse patch check failed: %s", commandDiagnostic(checked))
	}
	apply := check
	apply.Argv = []string{"git", "apply", "--reverse", path}
	result, err := r.Run(ctx, workspace, apply)
	if err != nil {
		return result, err
	}
	if !result.Success {
		return result, fmt.Errorf("reverse patch failed: %s", commandDiagnostic(result))
	}
	return result, nil
}

func (r *HostRunner) Run(ctx context.Context, workspace Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	return r.RunStreaming(ctx, workspace, command, nil)
}

func (r *HostRunner) RunStreaming(ctx context.Context, workspace Workspace, command domain.CommandSpec, onOutput StreamCallback) (domain.CommandResult, error) {
	cwd, err := safeWorkspaceCwd(workspace.Path, command.Cwd)
	if err != nil {
		return domain.CommandResult{}, err
	}
	if len(command.Argv) == 0 {
		return domain.CommandResult{}, errors.New("empty argv")
	}
	timeout := time.Duration(command.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	cmd := exec.CommandContext(runCtx, command.Argv[0], command.Argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	stdout := newStreamCapture("stdout", onOutput)
	stderr := newStreamCapture("stderr", onOutput)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err = cmd.Run()
	code := exitCode(err)
	result := domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: code, Stdout: limit(stdout.String()), Stderr: limit(stderr.String()), DurationMS: time.Since(started).Milliseconds()}
	result.Success = containsInt(command.ExpectedExitCodes, code) && runCtx.Err() == nil
	if runCtx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("host command timeout after %s", timeout)
	}
	return result, nil
}

var _ Runner = (*HostRunner)(nil)
