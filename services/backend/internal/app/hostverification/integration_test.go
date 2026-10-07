package hostverification_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestPermissionFailureRetainsCandidateWithoutGPTRepair(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")
	git(t, root, "config", "user.name", "Tester")
	git(t, root, "config", "user.email", "test@example.invalid")
	file := filepath.Join(root, "file.txt")
	write(t, file, "original\n", 0o600)
	git(t, root, "add", "file.txt")
	git(t, root, "commit", "-qm", "chore: initial")
	store := session.NewStore()
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(ctx, root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "chore: project config")
	git(t, root, "checkout", "-qb", "whx/req_gate")
	write(t, file, "candidate\n", 0o600)
	git(t, root, "add", "file.txt")
	git(t, root, "commit", "-qm", "fix: candidate")
	git(t, root, "checkout", "-q", "main")
	gate := filepath.Join(t.TempDir(), "gate")
	write(t, gate, "#!/bin/sh\nprintf \"Error EACCES: permission denied, rmdir '/project/dist/api/admin'\\n\"\nexit 1\n", 0o700)
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "plan_gate", RequestID: "req_gate", Status: "ready",
		Summary: "Fix candidate", CommitMessage: "fix: candidate", Risk: "low",
		Operations:   []domain.Operation{{Type: "apply_patch", Patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-original\n+candidate\n"}},
		Verification: []domain.CommandSpec{{Argv: []string{gate}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}},
	}
	_, err = store.Update(started.ID, func(item *domain.Session) error {
		item.State, item.Plan, item.LastRequestID = "verified", &plan, plan.RequestID
		item.PendingHostChanges = []domain.PendingHostChange{{Plan: plan, Execution: domain.ExecutionResult{PlanID: plan.PlanID, Success: true}, VerifiedAt: time.Now().UTC(), IntegrationBranch: "whx/req_gate"}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, applyErr := service.ApplyToHost(ctx, started.ID)
	if !errors.Is(applyErr, app.ErrHostWorkingStateBlocked) {
		t.Fatalf("permissions must be a local host block: %v", applyErr)
	}
	_, _ = service.TriggerApplyFailureRepair(ctx, started.ID, applyErr)
	current, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.FailureKind != domain.FailureKindHostWorkingStateBlocked || len(current.PendingHostChanges) != 1 || current.LastRequestID != plan.RequestID || current.PlannerInFlight || current.LastManualPrompt != "" {
		t.Fatalf("candidate lost or unnecessary GPT repair started: %#v", current)
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "original\n" {
		t.Fatalf("failed gate must still roll back host: %q %v", data, err)
	}
}

func git(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s %v", args, out, err)
	}
}

func write(t *testing.T, path, contents string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), mode); err != nil {
		t.Fatal(err)
	}
}
