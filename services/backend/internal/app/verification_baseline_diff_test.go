package app

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func goSuite(stdout string) domain.CommandResult {
	return domain.CommandResult{Argv: []string{"go", "test", "./..."}, ExitCode: 1, Stdout: stdout}
}

// The exact shape observed on chat b0ceb726e438: `go test ./...` aggregates
// every package into one exit code, the repository already failed one test for
// an unrelated reason, and the candidate added two of its own.
const (
	baselineGoOutput = `ok  	kernl.local/harness/backend/internal/audit	0.005s
--- FAIL: TestCaptureWharnessRuntimeIncludesStatusAndBoundedRedactedLogs (0.18s)
    metadata_test.go:93: runtime metadata missing "## Wharness status"
FAIL
FAIL	kernl.local/harness/backend/internal/exportmeta	0.431s
ok  	kernl.local/harness/backend/internal/session	0.102s`

	candidateGoOutput = `ok  	kernl.local/harness/backend/internal/audit	0.005s
--- FAIL: TestOrchestratorRefusesSecondProjectMutationSlot (0.03s)
    service_orchestrator_test.go:99: expected occupied mutation slot error, got task is not READY in this project
--- FAIL: TestOrchestratorStartQueuesWorkerRunBeforeDoing (0.04s)
    service_orchestrator_test.go:138: task is not READY in this project
FAIL
FAIL	kernl.local/harness/backend/internal/app	26.858s
--- FAIL: TestCaptureWharnessRuntimeIncludesStatusAndBoundedRedactedLogs (0.18s)
    metadata_test.go:93: runtime metadata missing "## Wharness status"
FAIL
FAIL	kernl.local/harness/backend/internal/exportmeta	0.431s
ok  	kernl.local/harness/backend/internal/session	0.102s`
)

func TestGoSuiteFailuresAreAttributedIndividually(t *testing.T) {
	baseline := goSuite(baselineGoOutput)
	post := goSuite(candidateGoOutput)

	introduced := newVerificationFailures(baseline, post)
	for _, want := range []string{
		"failing test TestOrchestratorRefusesSecondProjectMutationSlot",
		"failing test TestOrchestratorStartQueuesWorkerRunBeforeDoing",
		"failing package kernl.local/harness/backend/internal/app",
	} {
		if !containsFailure(introduced, want) {
			t.Fatalf("introduced failures must include %q, got %v", want, introduced)
		}
	}
	for _, unwanted := range []string{
		"failing test TestCaptureWharnessRuntimeIncludesStatusAndBoundedRedactedLogs",
		"failing package kernl.local/harness/backend/internal/exportmeta",
	} {
		if containsFailure(introduced, unwanted) {
			t.Fatalf("a failure present on the baseline must never be attributed to the candidate: %q", unwanted)
		}
	}

	preExisting := preExistingVerificationFailures(baseline, post)
	if !containsFailure(preExisting, "failing test TestCaptureWharnessRuntimeIncludesStatusAndBoundedRedactedLogs") {
		t.Fatalf("pre-existing failures must be named, got %v", preExisting)
	}
}

// This is the sentence the repair round is steered by; it has to say plainly
// which failures are not the planner's to fix.
func TestAttributionTellsThePlannerWhatIsNotItsToFix(t *testing.T) {
	attribution := describeVerificationAttribution(goSuite(baselineGoOutput), goSuite(candidateGoOutput))
	if !strings.Contains(attribution, "Introduced by this change (fix these):") {
		t.Fatalf("attribution must name the candidate's own failures: %s", attribution)
	}
	if !strings.Contains(attribution, "do NOT modify code to satisfy them") {
		t.Fatalf("attribution must forbid fixing pre-existing failures: %s", attribution)
	}
	if !strings.Contains(attribution, "TestCaptureWharnessRuntimeIncludesStatusAndBoundedRedactedLogs") {
		t.Fatalf("attribution must name the pre-existing failure: %s", attribution)
	}
}

// A repository whose suite already failed, with a candidate that adds nothing,
// must pass verification rather than spend repair rounds on somebody else's bug.
func TestAGoSuiteFailingOnlyAsBeforeIsNotARegression(t *testing.T) {
	if !verificationFailureEquivalent(goSuite(baselineGoOutput), goSuite(baselineGoOutput+"\n")) {
		t.Fatal("an unchanged Go failure set must be recognised as pre-existing")
	}
	if verificationFailureEquivalent(goSuite(baselineGoOutput), goSuite(candidateGoOutput)) {
		t.Fatal("a candidate that adds its own failures must still be a regression")
	}
}

// A package that fails to build emits no `--- FAIL` line at all, so without the
// package-level fingerprint a real regression would look like no failure.
func TestAPackageThatFailsToBuildIsStillARegression(t *testing.T) {
	baseline := goSuite("ok  	kernl.local/harness/backend/internal/session	0.102s")
	post := goSuite(`# kernl.local/harness/backend/internal/domain
internal/domain/types.go:796:20: undefined: DebugRun
FAIL	kernl.local/harness/backend/internal/domain [build failed]`)
	if verificationFailureEquivalent(baseline, post) {
		t.Fatal("a newly unbuildable package must not be waved through as pre-existing")
	}
	if !containsFailure(newVerificationFailures(baseline, post), "failing package kernl.local/harness/backend/internal/domain") {
		t.Fatalf("the unbuildable package must be attributed, got %v", newVerificationFailures(baseline, post))
	}
}

// Output in no family we can decompose stays on the strict comparison: guessing
// would let a real regression through.
func TestUnparseableOutputIsTreatedAsARegression(t *testing.T) {
	baseline := domain.CommandResult{ExitCode: 1, Stdout: "something went wrong"}
	post := domain.CommandResult{ExitCode: 1, Stdout: "something else went wrong"}
	if verificationFailureEquivalent(baseline, post) {
		t.Fatal("output we cannot decompose must never be waved through")
	}
}

// The TypeScript family that this comparison originally understood must keep
// behaving exactly as before.
func TestTypescriptDiagnosticsStillSubtract(t *testing.T) {
	baseline := domain.CommandResult{ExitCode: 2, Stdout: "src/App.tsx(18,136): error TS2307: Cannot find module './lib/x'"}
	same := domain.CommandResult{ExitCode: 2, Stdout: "src/App.tsx(18,136): error TS2307: Cannot find module './lib/x'\n"}
	extra := domain.CommandResult{ExitCode: 2, Stdout: "src/App.tsx(18,136): error TS2307: Cannot find module './lib/x'\nsrc/App.tsx(381,16): error TS2345: Argument of type X"}
	if !verificationFailureEquivalent(baseline, same) {
		t.Fatal("an unchanged TypeScript diagnostic set must stay pre-existing")
	}
	if verificationFailureEquivalent(baseline, extra) {
		t.Fatal("a new TypeScript diagnostic must stay a regression")
	}
}

func containsFailure(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestVitestFailuresAreAttributedIndividuallyAndIgnoreANSI(t *testing.T) {
	baseline := domain.CommandResult{ExitCode: 0}
	post := domain.CommandResult{ExitCode: 1, Stdout: "\x1b[31mFAIL\x1b[39m src/components/Inspector.test.tsx > Inspector ChatGPT engine pool (desktop) > keeps exactly one Supervisor pane while the active chat changes\n\x1b[31mFAIL\x1b[39m src/lib/attentionCenter.test.ts > attention center > preserves active item"}

	introduced := newVerificationFailures(baseline, post)
	for _, want := range []string{
		"failing Vitest test src/components/Inspector.test.tsx > Inspector ChatGPT engine pool (desktop) > keeps exactly one Supervisor pane while the active chat changes",
		"failing Vitest test src/lib/attentionCenter.test.ts > attention center > preserves active item",
	} {
		if !containsFailure(introduced, want) {
			t.Fatalf("introduced Vitest failures must include %q, got %v", want, introduced)
		}
	}
	attribution := describeVerificationAttribution(baseline, post)
	if !strings.Contains(attribution, "Introduced by this change (fix these):") || !strings.Contains(attribution, "Inspector.test.tsx") {
		t.Fatalf("passing baseline must still produce actionable attribution: %s", attribution)
	}
}
