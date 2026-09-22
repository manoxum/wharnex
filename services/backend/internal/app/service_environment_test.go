package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandboxenv"
	"kernl.local/harness/backend/internal/session"
)

func environmentService(t *testing.T, withProber bool) (*Service, string) {
	t.Helper()
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	if withProber {
		service.SetEnvironmentProber(sandboxenv.NewProber("kernl-runner:test", "docker"))
	}
	return service, root
}

// The planner is only able to avoid absent tools, denied executables and
// out-of-range budgets if the measured environment actually reaches its
// prompt. This asserts the wiring end to end for a real request.
func TestManualPromptCarriesTheMeasuredExecutionEnvironment(t *testing.T) {
	service, root := environmentService(t, true)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "adiciona uma verificação")
	if err != nil {
		t.Fatal(err)
	}
	prompt := prompted.LastManualPrompt
	for _, required := range []string{
		"LOCAL EXECUTION ENVIRONMENT",
		sandboxenv.SchemaVersion,
		"sandbox_tools",
		"host_tools",
		"denied_executables",
		"command_timeout_seconds_max",
		"memory_total_mb",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("the manual prompt is missing %q", required)
		}
	}
	// The rules that make the section actionable must travel with it.
	if !strings.Contains(prompt, "LOCAL EXECUTION ENVIRONMENT RULES") {
		t.Fatal("the prompt must state how the environment section is to be used")
	}
}

// Without a prober the section is simply absent: environment measurement is an
// enhancement and must never be able to block or fail a request.
func TestManualPromptRemainsValidWithoutAnEnvironmentProber(t *testing.T) {
	service, root := environmentService(t, false)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "adiciona uma verificação")
	if err != nil {
		t.Fatal(err)
	}
	if prompted.LastManualPrompt == "" {
		t.Fatal("a prompt must still be produced without an environment prober")
	}
	if strings.Contains(prompted.LastManualPrompt, sandboxenv.SchemaVersion) {
		t.Fatal("no environment document may appear when nothing measured one")
	}
}
