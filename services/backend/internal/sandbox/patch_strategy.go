package sandbox

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

type patchRunFunc func(context.Context, Workspace, domain.CommandSpec) (domain.CommandResult, error)

type patchAttempt struct {
	name  string
	check []string
	apply []string
}

func applyPatchWithStrategies(ctx context.Context, workspace Workspace, patch, patchArg string, timeoutSeconds int, run patchRunFunc) (domain.CommandResult, error) {
	attempts := []patchAttempt{
		{name: "git apply", check: []string{"git", "apply", "--check", patchArg}, apply: []string{"git", "apply", patchArg}},
		{name: "git apply --recount", check: []string{"git", "apply", "--recount", "--check", patchArg}, apply: []string{"git", "apply", "--recount", patchArg}},
	}
	if strings.Contains(patch, "\nindex ") || strings.HasPrefix(patch, "index ") {
		attempts = append(attempts, patchAttempt{name: "git apply --3way", check: []string{"git", "apply", "--3way", "--check", patchArg}, apply: []string{"git", "apply", "--3way", patchArg}})
	}

	var diagnostics []string
	var last domain.CommandResult
	for _, attempt := range attempts {
		if err := ctx.Err(); err != nil {
			return last, err
		}
		check := domain.CommandSpec{Argv: attempt.check, Cwd: ".", TimeoutSeconds: timeoutSeconds, ExpectedExitCodes: []int{0}}
		result, err := run(ctx, workspace, check)
		last = result
		if cancelErr := patchCancellationError(ctx, err); cancelErr != nil {
			return result, cancelErr
		}
		if err != nil {
			diagnostics = append(diagnostics, fmt.Sprintf("%s check error: %v", attempt.name, err))
			continue
		}
		if !result.Success {
			diagnostics = append(diagnostics, patchFailureDetail(attempt.name+" --check", result))
			continue
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
		apply := check
		apply.Argv = attempt.apply
		result, err = run(ctx, workspace, apply)
		last = result
		if cancelErr := patchCancellationError(ctx, err); cancelErr != nil {
			return result, cancelErr
		}
		if err != nil {
			return result, fmt.Errorf("%s failed: %w", attempt.name, err)
		}
		if !result.Success {
			return result, fmt.Errorf("%s failed: %s", attempt.name, commandDiagnostic(result))
		}
		return result, nil
	}
	// A repeated/manual plan can legitimately target a change that has already
	// reached the current workspace. In that case, the reverse patch applies
	// cleanly. Treat it as an idempotent no-op; never actually reverse it.
	reverseAttempts := []patchAttempt{
		{name: "git apply --reverse", check: []string{"git", "apply", "--reverse", "--check", patchArg}},
		{name: "git apply --reverse --recount", check: []string{"git", "apply", "--reverse", "--recount", "--check", patchArg}},
	}
	for _, attempt := range reverseAttempts {
		if err := ctx.Err(); err != nil {
			return last, err
		}
		check := domain.CommandSpec{Argv: attempt.check, Cwd: ".", TimeoutSeconds: timeoutSeconds, ExpectedExitCodes: []int{0}}
		result, err := run(ctx, workspace, check)
		last = result
		if cancelErr := patchCancellationError(ctx, err); cancelErr != nil {
			return result, cancelErr
		}
		if err == nil && result.Success {
			result.Argv = []string{"git", "apply", "<already-applied>"}
			result.Stdout = "patch already applied; no changes needed"
			result.Stderr = ""
			result.Success = true
			return result, nil
		}
	}

	if len(diagnostics) == 0 {
		diagnostics = append(diagnostics, "git apply rejected the patch")
	}
	return last, fmt.Errorf("patch does not apply cleanly:\n%s", strings.Join(diagnostics, "\n"))
}

func patchCancellationError(ctx context.Context, runErr error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if errors.Is(runErr, context.Canceled) || errors.Is(runErr, context.DeadlineExceeded) {
		return runErr
	}
	return nil
}

func patchFailureDetail(label string, result domain.CommandResult) string {
	return fmt.Sprintf("%s: %s", label, commandDiagnostic(result))
}

func commandDiagnostic(result domain.CommandResult) string {
	stderr := strings.TrimSpace(result.Stderr)
	stdout := strings.TrimSpace(result.Stdout)
	if stderr != "" {
		return stderr
	}
	if stdout != "" {
		return stdout
	}
	return fmt.Sprintf("exit code %d", result.ExitCode)
}
