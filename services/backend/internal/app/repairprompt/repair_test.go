package repairprompt

import (
	"strings"
	"testing"
)

func TestPolicyRejectionAsksForAPermittedReplacement(t *testing.T) {
	got := Build(Input{AttemptLabel: "attempt 2/4", Effort: "high", Cause: "policy denied plan: curl is network", PlanID: "plan-1"})
	for _, want := range []string{"AUTOMATIC POLICY REPAIR REQUEST — attempt 2/4 · effort high", "BLOCKED PLAN ID: plan-1", "curl is network"} {
		if !strings.Contains(got, want) {
			t.Fatalf("policy repair is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "policy denied plan:") {
		t.Fatalf("policy reasons must drop the internal error prefix:\n%s", got)
	}
}

func TestManualRepairKeepsTheOperatorHeadingForPolicyFailures(t *testing.T) {
	got := Build(Input{Manual: true, AttemptsSpent: 3, Cause: "policy denied plan: x", Guidance: "use make"})
	if !strings.HasPrefix(got, "MANUAL GPT REPAIR REQUEST — operator requested after 3 autonomous attempt(s)") {
		t.Fatalf("manual heading lost:\n%s", got)
	}
	if !strings.HasSuffix(got, "OPTIONAL OPERATOR GUIDANCE:\nuse make") {
		t.Fatalf("operator guidance must close the request:\n%s", got)
	}
}

func TestExecutionRepairNamesWorkspaceStateAndMissingTools(t *testing.T) {
	got := Build(Input{
		AttemptLabel: "attempt 1/4", Effort: "medium", Cause: "verification failed", PlanID: "plan-2", ExecutionMode: "protected",
		PendingHostChanges: true, PendingChangesPrompt: "PENDING: a.go",
		Commands:          []Command{{Argv: []string{"jq", "."}, ExitCode: 127, Diagnostic: "jq: not found"}},
		MissingExecutable: &MissingExecutable{Name: "jq", CommandLine: "jq ."},
		CauseSummary:      "jq is missing",
	})
	for _, want := range []string{
		"AUTOMATIC REPAIR REQUEST — attempt 1/4 · effort medium", "Verified host-pending changes are retained",
		`ROOT CAUSE — MISSING EXECUTABLE: "jq"`, "[1] jq . (exit 127, success=false)\njq: not found", "PENDING: a.go", "EXECUTION MODE: protected",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("execution repair is missing %q:\n%s", want, got)
		}
	}
}

func TestHostDirectFailuresPreferTheRefreshedContext(t *testing.T) {
	got := Build(Input{Cause: "boom", HostDirect: true, PendingHostChanges: true})
	if !strings.Contains(got, "host-direct execution may have partially changed the host") || strings.Contains(got, "host-pending changes are retained") {
		t.Fatalf("host-direct note must win over pending-change note:\n%s", got)
	}
}

func TestTruncationIsBoundedAndKeepsBuildTails(t *testing.T) {
	if got := Truncate("  abcdef  ", 3); got != "abc"+truncatedMarker {
		t.Fatalf("Truncate = %q", got)
	}
	got := TruncateBuildOutput(strings.Repeat("a", 50)+"EXIT 2", 30)
	if !strings.HasPrefix(got, strings.Repeat("a", 10)) || !strings.HasSuffix(got, "EXIT 2") {
		t.Fatalf("build output must keep its head and terminal diagnostic: %q", got)
	}
	if AppendOperatorGuidance(AppendOperatorGuidance("p", "g"), "g") != "p\n\nOPTIONAL OPERATOR GUIDANCE:\ng" {
		t.Fatal("operator guidance must be appended once")
	}
}
