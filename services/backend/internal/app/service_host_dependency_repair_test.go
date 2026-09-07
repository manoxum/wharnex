package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func rolldownVerificationPlan(cwd string) domain.ExecutionPlan {
	patch := "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
	return domain.ExecutionPlan{
		Protocol:  domain.ProtocolV1,
		PlanID:    "plan-rolldown",
		RequestID: "req-rolldown",
		Status:    "ready",
		Risk:      "medium",
		Operations: []domain.Operation{
			{Type: "apply_patch", Patch: patch},
		},
		Verification: []domain.CommandSpec{
			{Argv: []string{"npm", "run", "build"}, Cwd: cwd, TimeoutSeconds: 60, ExpectedExitCodes: []int{0}},
		},
	}
}

func TestHostDependencyRemediationSiteFindsNpmVerificationCwd(t *testing.T) {
	plan := rolldownVerificationPlan("services/sgdp-formatter")
	pending := []domain.PendingHostChange{{Plan: plan}}
	cwd, ok := hostDependencyRemediationSite(pending)
	if !ok || cwd != "services/sgdp-formatter" {
		t.Fatalf("hostDependencyRemediationSite() = (%q, %v)", cwd, ok)
	}
}

func TestHostDependencyRemediationSiteRejectsPlanWithoutNpmCommand(t *testing.T) {
	plan := domain.ExecutionPlan{Verification: []domain.CommandSpec{{Argv: []string{"go", "build", "./..."}, Cwd: "."}}}
	if _, ok := hostDependencyRemediationSite([]domain.PendingHostChange{{Plan: plan}}); ok {
		t.Fatal("expected no eligible npm/node command")
	}
}

func TestHostDependencyRemediationCommandsAreTheFixedNpmBugRecipe(t *testing.T) {
	commands := hostDependencyRemediationCommands("services/sgdp-formatter")
	if len(commands) != 3 {
		t.Fatalf("expected exactly 3 remediation commands, got %d", len(commands))
	}
	want := [][]string{
		{"rm", "-rf", "node_modules"},
		{"rm", "-f", "package-lock.json"},
		{"npm", "install"},
	}
	for i, command := range commands {
		if strings.Join(command.Argv, " ") != strings.Join(want[i], " ") {
			t.Fatalf("command %d = %v want %v", i, command.Argv, want[i])
		}
		if command.Cwd != "services/sgdp-formatter" {
			t.Fatalf("command %d cwd = %q", i, command.Cwd)
		}
		// npm install is the only command allowed to touch the network —
		// removing node_modules/the lockfile never does.
		if command.Network != (command.Argv[0] == "npm") {
			t.Fatalf("command %d network = %v", i, command.Network)
		}
	}
}

// scriptedHostRunner records every command it runs (in order) and lets a
// test decide per-argv success/failure, without touching a real filesystem
// or network — the same role terminalTargetRunner/fakeRunner play elsewhere
// in this package, specialized for scripting a remediation-then-reverify
// sequence.
type scriptedHostRunner struct {
	calls []domain.CommandSpec
	fail  map[string]bool
}

func (r *scriptedHostRunner) Prepare(_ context.Context, projectRoot string) (sandbox.Workspace, error) {
	return sandbox.Workspace{Path: projectRoot, SourcePath: projectRoot}, nil
}

func (r *scriptedHostRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{Success: true}, nil
}

func (r *scriptedHostRunner) Run(_ context.Context, _ sandbox.Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	r.calls = append(r.calls, command)
	key := strings.Join(command.Argv, " ")
	if r.fail[key] {
		return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: 1, Stderr: "scripted failure", Success: false}, nil
	}
	return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: 0, Success: true}, nil
}

func (r *scriptedHostRunner) Cleanup(sandbox.Workspace) error { return nil }

type streamingHostRepairRunner struct {
	scriptedHostRunner
}

func (r *streamingHostRepairRunner) RunStreaming(_ context.Context, _ sandbox.Workspace, command domain.CommandSpec, onOutput sandbox.StreamCallback) (domain.CommandResult, error) {
	r.calls = append(r.calls, command)
	if onOutput != nil {
		onOutput("stdout", "repair stdout\n")
		onOutput("stderr", "repair stderr\n")
	}
	return domain.CommandResult{
		Argv: command.Argv, Cwd: command.Cwd, ExitCode: 0, Success: true,
		Stdout: "repair stdout\n", Stderr: "repair stderr\n", DurationMS: 12,
	}, nil
}

func newHostDependencyRepairSession(t *testing.T, plan domain.ExecutionPlan) (*Service, domain.Session) {
	t.Helper()
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan: plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.FailureKind = domain.FailureKindHostDependencyState
		item.LastRepairError = "host dependency state prevents verification"
		item.PendingHostChanges = []domain.PendingHostChange{{Plan: plan, Execution: domain.ExecutionResult{PlanID: plan.PlanID, Success: true}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return service, updated
}

func TestRetryHostDependencyRepairRequiresApproval(t *testing.T) {
	service, started := newHostDependencyRepairSession(t, rolldownVerificationPlan("."))
	_, err := service.RetryHostDependencyRepair(context.Background(), started.ID, false)
	if !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("expected ErrApprovalRequired, got %v", err)
	}
}

func TestRetryHostDependencyRepairRejectsUnrelatedFailureKind(t *testing.T) {
	service, started := newHostDependencyRepairSession(t, rolldownVerificationPlan("."))
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.FailureKind = domain.FailureKindOfflineGoModuleCache
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, err := service.RetryHostDependencyRepair(context.Background(), started.ID, true)
	if err == nil || !strings.Contains(err.Error(), "no host dependency failure") {
		t.Fatalf("expected no-host-dependency-failure rejection, got %v", err)
	}
}

func TestRetryHostDependencyRepairRunsFixedRecipeThenReverifiesAndApplies(t *testing.T) {
	plan := rolldownVerificationPlan(".")
	service, started := newHostDependencyRepairSession(t, plan)
	host := &scriptedHostRunner{}
	service.hostRunner = host

	_, err := service.RetryHostDependencyRepair(context.Background(), started.ID, true)
	if err != nil {
		t.Fatalf("RetryHostDependencyRepair() error = %v", err)
	}

	if len(host.calls) < 4 {
		t.Fatalf("expected at least 4 host commands (3 remediation + 1 reverify), got %d: %#v", len(host.calls), host.calls)
	}
	wantPrefix := [][]string{
		{"rm", "-rf", "node_modules"},
		{"rm", "-f", "package-lock.json"},
		{"npm", "install"},
		{"npm", "run", "build"},
	}
	for i, want := range wantPrefix {
		if strings.Join(host.calls[i].Argv, " ") != strings.Join(want, " ") {
			t.Fatalf("call %d = %v want %v", i, host.calls[i].Argv, want)
		}
	}

	final, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.FailureKind != "" {
		t.Fatalf("expected FailureKind cleared after successful repair, got %q", final.FailureKind)
	}
}

func TestRetryHostDependencyRepairKeepsFailureConcreteWhenReverifyStillFails(t *testing.T) {
	plan := rolldownVerificationPlan(".")
	service, started := newHostDependencyRepairSession(t, plan)
	host := &scriptedHostRunner{fail: map[string]bool{"npm run build": true}}
	service.hostRunner = host

	_, err := service.RetryHostDependencyRepair(context.Background(), started.ID, true)
	if err == nil || !strings.Contains(err.Error(), "verification still fails") {
		t.Fatalf("expected reverify-still-fails error, got %v", err)
	}

	final, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.FailureKind != "" {
		t.Fatalf("stale host_dependency_state label should be cleared once the diagnosis no longer applies, got %q", final.FailureKind)
	}
	if !strings.Contains(final.LastRepairError, "verification still fails") {
		t.Fatalf("expected concrete new error persisted, got %q", final.LastRepairError)
	}
}

func TestRetryHostDependencyRepairPublishesLiveCommandOutput(t *testing.T) {
	plan := rolldownVerificationPlan(".")
	service, started := newHostDependencyRepairSession(t, plan)
	host := &streamingHostRepairRunner{}
	service.hostRunner = host

	if _, err := service.RetryHostDependencyRepair(context.Background(), started.ID, true); err != nil {
		t.Fatalf("RetryHostDependencyRepair() error = %v", err)
	}

	var repairRunID string
	var sawOutput bool
	var sawCompletedFallback bool
	for _, event := range service.bus.History(started.ID) {
		switch event.Type {
		case "host_dependency_repair.command_started":
			if repairRunID == "" {
				repairRunID, _ = event.Data["run_id"].(string)
			}
		case "host_dependency_repair.command_output":
			if event.Data["run_id"] == repairRunID && event.Data["stream"] == "stdout" && event.Data["text"] == "repair stdout\n" {
				sawOutput = true
			}
		case "host_dependency_repair.command_completed":
			if event.Data["run_id"] == repairRunID && event.Data["stdout"] == "repair stdout\n" && event.Data["stderr"] == "repair stderr\n" {
				sawCompletedFallback = true
			}
		}
	}
	if repairRunID == "" {
		t.Fatal("expected repair command_started to carry a run_id")
	}
	if !sawOutput {
		t.Fatal("expected live host_dependency_repair.command_output event")
	}
	if !sawCompletedFallback {
		t.Fatal("expected completed repair event to retain stdout/stderr fallback")
	}
}
