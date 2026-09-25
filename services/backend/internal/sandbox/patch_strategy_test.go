package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestLocalRunnerTreatsAlreadyAppliedPatchAsSuccess(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"
	result, err := runner.ApplyPatch(context.Background(), workspace, patch)
	if err != nil {
		t.Fatalf("already applied patch should be idempotent: %v", err)
	}
	if !result.Success || !strings.Contains(result.Stdout, "already applied") {
		t.Fatalf("expected already-applied success, got %#v", result)
	}
}

func TestApplyPatchWithStrategiesStopsBeforeRunnerWhenContextCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	_, err := applyPatchWithStrategies(ctx, Workspace{}, "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n", "/tmp/patch", 60, func(context.Context, Workspace, domain.CommandSpec) (domain.CommandResult, error) {
		calls++
		return domain.CommandResult{}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if calls != 0 {
		t.Fatalf("canceled context started %d patch command(s)", calls)
	}
}

func TestApplyPatchWithStrategiesStopsFallbacksWhenRunnerCancels(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	_, err := applyPatchWithStrategies(ctx, Workspace{}, "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n", "/tmp/patch", 60, func(context.Context, Workspace, domain.CommandSpec) (domain.CommandResult, error) {
		calls++
		cancel()
		return domain.CommandResult{ExitCode: -1, Success: false}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("cancellation should stop recount/3way/reverse fallbacks, got %d calls", calls)
	}
}

func TestApplyPatchWithStrategiesStopsOnDeadlineErrorWithoutContextMutation(t *testing.T) {
	calls := 0
	_, err := applyPatchWithStrategies(context.Background(), Workspace{}, "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n", "/tmp/patch", 60, func(context.Context, Workspace, domain.CommandSpec) (domain.CommandResult, error) {
		calls++
		return domain.CommandResult{ExitCode: -1, Success: false}, context.DeadlineExceeded
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline error, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("deadline error should stop fallback strategies, got %d calls", calls)
	}
}

func TestApplyPatchWithStrategiesKeepsFallbacksWhileContextIsAlive(t *testing.T) {
	calls := 0
	result, err := applyPatchWithStrategies(context.Background(), Workspace{}, "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n", "/tmp/patch", 60, func(_ context.Context, _ Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
		calls++
		switch calls {
		case 1:
			return domain.CommandResult{Argv: command.Argv, ExitCode: 1, Stderr: "stale context", Success: false}, nil
		case 2:
			return domain.CommandResult{Argv: command.Argv, ExitCode: 0, Success: true}, nil
		default:
			return domain.CommandResult{Argv: command.Argv, ExitCode: 0, Success: true}, nil
		}
	})
	if err != nil {
		t.Fatalf("live-context recount fallback failed: %v", err)
	}
	if !result.Success || calls != 3 {
		t.Fatalf("expected check, recount-check and recount-apply, got result=%#v calls=%d", result, calls)
	}
}
