package sandbox

import (
	"context"
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
		check := domain.CommandSpec{Argv: attempt.check, Cwd: ".", TimeoutSeconds: timeoutSeconds, ExpectedExitCodes: []int{0}}
		result, err := run(ctx, workspace, check)
		last = result
		if err != nil {
			diagnostics = append(diagnostics, fmt.Sprintf("%s check error: %v", attempt.name, err))
			continue
		}
		if !result.Success {
			diagnostics = append(diagnostics, patchFailureDetail(attempt.name+" --check", result))
			continue
		}
		apply := check
		apply.Argv = attempt.apply
		result, err = run(ctx, workspace, apply)
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
		check := domain.CommandSpec{Argv: attempt.check, Cwd: ".", TimeoutSeconds: timeoutSeconds, ExpectedExitCodes: []int{0}}
		result, err := run(ctx, workspace, check)
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
