package app

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// The exact stderr of the production failure this file exists for: the gate
// passed in the Protected runner (which installs build-essential) and then died
// post-merge in 5 ms inside Wharnex's own control container.
const observedCgoUnavailableOutput = "go: -race requires cgo; enable cgo by setting CGO_ENABLED=1\n"

func TestUnsupportedHostGateClassification(t *testing.T) {
	raceGate := domain.CommandSpec{Argv: []string{"go", "test", "-race", "./..."}, Cwd: "services/backend"}
	for _, testCase := range []struct {
		name       string
		command    domain.CommandSpec
		result     domain.CommandResult
		want       bool
		wantReason string
	}{
		{
			name:       "cgo unavailable for a race build",
			command:    raceGate,
			result:     domain.CommandResult{ExitCode: 2, Stderr: observedCgoUnavailableOutput},
			want:       true,
			wantReason: unsupportedGateToolchain,
		},
		{
			name:       "tool absent from the control container",
			command:    domain.CommandSpec{Argv: []string{"pytest", "-q"}, Cwd: "."},
			result:     domain.CommandResult{ExitCode: 127, Stderr: "sh: exec: pytest: not found\n"},
			want:       true,
			wantReason: unsupportedGateMissingExecutable,
		},
		{
			// The whole risk of this classification is misreading a real
			// regression as an environment gap and letting it onto the host.
			name:    "genuine test regression",
			command: raceGate,
			result:  domain.CommandResult{ExitCode: 1, Stdout: "--- FAIL: TestApply (0.01s)\n    want 3, got 4\nFAIL\n"},
			want:    false,
		},
		{
			name:    "genuine data race detected",
			command: raceGate,
			result:  domain.CommandResult{ExitCode: 66, Stdout: "WARNING: DATA RACE\nRead at 0x00c0000140a0 by goroutine 8:\n"},
			want:    false,
		},
		{
			name:    "compile error in the merged result",
			command: raceGate,
			result:  domain.CommandResult{ExitCode: 1, Stderr: "./service.go:2784:6: undefined: unsupportedHostGates\n"},
			want:    false,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			gate, ok := classifyUnsupportedHostGate(testCase.command, testCase.result)
			if ok != testCase.want {
				t.Fatalf("classifyUnsupportedHostGate ok = %t, want %t", ok, testCase.want)
			}
			if !ok {
				return
			}
			if gate.Reason != testCase.wantReason {
				t.Fatalf("reason = %q, want %q", gate.Reason, testCase.wantReason)
			}
			if gate.commandLine() == "" || gate.Diagnostic == "" {
				t.Fatalf("an unsupported gate must carry its argv and diagnostic: %+v", gate)
			}
		})
	}
}

// writeFailingGate installs an executable that reproduces a command failing
// with a given diagnostic and exit code, so the post-merge loop can be driven
// end to end without depending on which toolchain the test host happens to own.
func writeFailingGate(t *testing.T, diagnostic string, exitCode int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "gate")
	script := "#!/bin/sh\nprintf '%s' " + shellQuote(diagnostic) + " >&2\nexit " + strconv.Itoa(exitCode) + "\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func shellQuote(value string) string {
	quoted := "'"
	for _, r := range value {
		if r == '\'' {
			quoted += `'\''`
			continue
		}
		quoted += string(r)
	}
	return quoted + "'"
}

// applyWithPostMergeGate drives a complete Git-native Apply whose single
// post-merge verification gate is the supplied failing executable.
func applyWithPostMergeGate(t *testing.T, gate string, exitCode int) (*Service, string, domain.Session, error) {
	t.Helper()
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	host := gitRepo(t, "app.go", "package main\n")

	started, err := service.StartSessionWithModes(context.Background(), host, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, host, "add", "-A")
	runGitForApp(t, host, "commit", "-qm", "chore: add project config")

	cloneParent := t.TempDir()
	candidate := filepath.Join(cloneParent, "candidate")
	runGitForApp(t, cloneParent, "clone", "-q", "--local", host, candidate)
	runGitForApp(t, candidate, "checkout", "-qb", "whx/req_gate")
	if err := os.WriteFile(filepath.Join(candidate, "app.go"), []byte("package main\n\nfunc main() {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, candidate, "add", "app.go")
	runGitForApp(t, candidate, "commit", "-qm", "feat(app): add entry point")
	runGitForApp(t, candidate, "push", "-q", "--", host, "whx/req_gate:refs/heads/whx/req_gate")

	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "plan_gate", RequestID: "req_gate", Status: "ready",
		Summary: "Add the application entry point.", CommitMessage: "feat(app): add entry point", Risk: "low",
		Operations:   []domain.Operation{{Type: "apply_patch", Patch: "--- a/app.go\n+++ b/app.go\n@@ -1 +1,3 @@\n package main\n+\n+func main() {}\n"}},
		Verification: []domain.CommandSpec{{Argv: []string{gate}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}},
	}
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.Plan = &plan
		item.LastRequestID = plan.RequestID
		item.PendingHostChanges = []domain.PendingHostChange{{
			Plan:      plan,
			Execution: domain.ExecutionResult{PlanID: plan.PlanID, Success: true, CompletedAt: time.Now().UTC()},
			// The gate already passed in Protected verification against this
			// same candidate — that is what makes the host re-run corroboration
			// rather than the only verdict.
			VerifiedAt: time.Now().UTC(), IntegrationBranch: "whx/req_gate",
		}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	applied, applyErr := service.ApplyToHost(context.Background(), started.ID)
	return service, host, applied, applyErr
}

// A gate the host verification environment cannot run at all yields no verdict
// about the merge. Reverting a verified candidate over it — and spending a
// repair round asking the planner to fix source that was never implicated — is
// the production defect this test pins closed.
func TestPostMergeGateTheHostCannotRunDoesNotDiscardTheVerifiedCandidate(t *testing.T) {
	gate := writeFailingGate(t, observedCgoUnavailableOutput, 2)
	service, host, applied, err := applyWithPostMergeGate(t, gate, 2)
	if err != nil {
		t.Fatalf("an unrunnable host gate must not fail the Apply: %v", err)
	}
	if applied.State != "applied" {
		t.Fatalf("session state = %q, want applied", applied.State)
	}
	if applied.LastRepairError != "" {
		t.Fatalf("no repair error may be recorded for an environment fault: %q", applied.LastRepairError)
	}
	merged, readErr := os.ReadFile(filepath.Join(host, "app.go"))
	if readErr != nil || string(merged) != "package main\n\nfunc main() {}\n" {
		t.Fatalf("the verified change was reverted: body=%q err=%v", merged, readErr)
	}

	// Silence is not acceptable here: the operator has to be told which
	// corroboration this Apply went without, and why.
	var unsupported, appliedEvent *domain.Event
	history := service.bus.History(applied.ID)
	for index := range history {
		switch history[index].Type {
		case "integration.verification_unsupported":
			unsupported = &history[index]
		case "host.applied":
			appliedEvent = &history[index]
		}
	}
	if unsupported == nil {
		t.Fatal("an unrunnable gate must publish integration.verification_unsupported")
	}
	if unsupported.Data["reason"] != unsupportedGateToolchain {
		t.Fatalf("event reason = %v, want %q", unsupported.Data["reason"], unsupportedGateToolchain)
	}
	if appliedEvent == nil || appliedEvent.Data["unverified_host_gates"] == nil {
		t.Fatalf("host.applied must name the gates it went without: %+v", appliedEvent)
	}
}

// The counterpart contract: an ordinary failure of the same gate still reverts
// the host. Classifying too widely would put unverified code on the host.
func TestPostMergeRegressionStillRevertsTheHost(t *testing.T) {
	gate := writeFailingGate(t, "--- FAIL: TestEntryPoint (0.00s)\n    want 3, got 4\nFAIL\n", 1)
	_, host, applied, err := applyWithPostMergeGate(t, gate, 1)
	if err == nil {
		t.Fatal("a real post-merge regression must still fail the Apply")
	}
	if applied.State == "applied" {
		t.Fatal("a real post-merge regression must not reach the applied state")
	}
	reverted, readErr := os.ReadFile(filepath.Join(host, "app.go"))
	if readErr != nil || string(reverted) != "package main\n" {
		t.Fatalf("the host was not reverted: body=%q err=%v", reverted, readErr)
	}
}
