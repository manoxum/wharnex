package app

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func ledgerSession(rootID string) *domain.Session {
	item := &domain.Session{ID: "sess_test", LastRequestID: rootID}
	resetAttemptLedger(item, rootID)
	return item
}

// The measured history is Wharnex's own evidence, not the planner's notes. A
// round that failed has to reach the next request whether or not the model
// chose to write it down — that is the whole point of measuring it separately.
func TestMeasuredRoundsAccumulateAcrossWaves(t *testing.T) {
	item := ledgerSession("req_root")
	recordAttemptRound(item, "req_root", domain.AttemptRound{
		RequestID: "req_root", Kind: requestKindStandard, Outcome: domain.AttemptOutcomeVerificationFailed, Detail: "go test exited 1",
	})
	recordAttemptRound(item, "req_root", domain.AttemptRound{
		RequestID: "req_two", Kind: requestKindRepair, Outcome: domain.AttemptOutcomePolicyBlocked, Detail: "policy denied curl",
	})
	ledger := attemptLedgerForRoot(*item, "req_root")
	if ledger == nil || len(ledger.Rounds) != 2 {
		t.Fatalf("expected two measured rounds, got %+v", ledger)
	}
	if ledger.Rounds[0].Round != 1 || ledger.Rounds[1].Round != 2 {
		t.Fatalf("rounds must be numbered in order: %+v", ledger.Rounds)
	}
}

// One request can be measured twice — a plan is rejected, then its retained
// payload fails verification. The later, more specific measurement is the true
// outcome of that round and must replace the earlier one in place rather than
// inflating the round count.
func TestRemeasuringOneRequestReplacesItInPlace(t *testing.T) {
	item := ledgerSession("req_root")
	recordAttemptRound(item, "req_root", domain.AttemptRound{RequestID: "req_root", Outcome: domain.AttemptOutcomePolicyBlocked})
	recordAttemptRound(item, "req_root", domain.AttemptRound{RequestID: "req_root", Outcome: domain.AttemptOutcomeVerificationFailed, Detail: "tests failed"})
	ledger := attemptLedgerForRoot(*item, "req_root")
	if len(ledger.Rounds) != 1 {
		t.Fatalf("expected one round, got %d", len(ledger.Rounds))
	}
	if ledger.Rounds[0].Outcome != domain.AttemptOutcomeVerificationFailed || ledger.Rounds[0].Round != 1 {
		t.Fatalf("expected the later measurement at round 1, got %+v", ledger.Rounds[0])
	}
}

// A response that returns no ledger is a degradation, never a reset. Losing the
// accumulated exclusion list to one non-compliant round would hand the next
// round back every approach already proven to fail.
func TestMissingNarrativeRetainsThePreviousLedger(t *testing.T) {
	item := ledgerSession("req_root")
	if !stageAttemptNarrative(item, "req_root", "req_root", "## Does not work locally\n- curl is absent\n") {
		t.Fatal("expected the first narrative to be staged")
	}
	if stageAttemptNarrative(item, "req_root", "req_two", "   ") {
		t.Fatal("an empty narrative must not be staged")
	}
	ledger := attemptLedgerForRoot(*item, "req_root")
	if !strings.Contains(ledger.Narrative, "curl is absent") {
		t.Fatalf("previous ledger was lost: %q", ledger.Narrative)
	}
	if ledger.NarrativeRequestID != "req_root" {
		t.Fatalf("narrative attribution must stay with the round that authored it, got %q", ledger.NarrativeRequestID)
	}
}

// The ledger records what worked and failed while pursuing ONE goal. Carrying
// it into the next Main Request would have the planner excluding approaches for
// a problem nobody asked about.
func TestLedgerFromAnotherMainRequestIsNotReused(t *testing.T) {
	item := ledgerSession("req_root")
	recordAttemptRound(item, "req_root", domain.AttemptRound{RequestID: "req_root", Outcome: domain.AttemptOutcomeVerificationFailed})
	if attemptLedgerForRoot(*item, "req_other") != nil {
		t.Fatal("a ledger must never be served to a different Main Request")
	}
	resetAttemptLedger(item, "req_other")
	if ledger := attemptLedgerForRoot(*item, "req_other"); ledger == nil || len(ledger.Rounds) != 0 {
		t.Fatalf("a new Main Request must start from an empty ledger, got %+v", ledger)
	}
}

// The terminal boundary is where durable residue has already been promoted into
// the knowledge catalog, so the scaffolding must not survive it.
func TestClearingTheLedgerOnlyAffectsItsOwnMainRequest(t *testing.T) {
	item := ledgerSession("req_root")
	clearAttemptLedger(item, "req_unrelated")
	if item.AttemptLedger == nil {
		t.Fatal("clearing an unrelated root must not drop the active ledger")
	}
	clearAttemptLedger(item, "req_root")
	if item.AttemptLedger != nil {
		t.Fatal("the ledger must be discarded at its own terminal boundary")
	}
}

// The rendered section is what the planner actually reads. Measured evidence
// has to be labelled as Wharnex's, so the model cannot treat it as its own
// revisable notes and quietly drop a failure it would rather retry.
func TestRenderedLedgerSeparatesMeasuredEvidenceFromPlannerProse(t *testing.T) {
	item := ledgerSession("req_root")
	recordAttemptRound(item, "req_root", attemptRoundFromExecution("req_root", requestKindStandard, domain.ExecutionResult{
		PlanID:   "plan_1",
		Commands: []domain.CommandResult{{Argv: []string{"go", "test", "./..."}, ExitCode: 1}},
	}, domain.AttemptOutcomeVerificationFailed, "package build failed"))
	stageAttemptNarrative(item, "req_root", "req_root", "## Does not work locally\n- rewriting main.go")

	rendered := renderAttemptLedger(attemptLedgerForRoot(*item, "req_root"), 2, 6)
	for _, want := range []string{
		domain.AttemptProtocolV1,
		"WHARNEX-MEASURED ROUND HISTORY",
		"plan=plan_1",
		"go test ./... → exit 1",
		"YOUR CUMULATIVE LEDGER",
		"rewriting main.go",
		"round 2",
	} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered ledger is missing %q:\n%s", want, rendered)
		}
	}
}

// A policy refusal means the plan never executed and the patch may be entirely
// sound; a verification failure means it ran and was wrong. Collapsing the two
// would send the next round rewriting correct source.
func TestRepairOutcomeDistinguishesPolicyFromVerification(t *testing.T) {
	cases := map[string]string{
		"policy denied plan: curl is not allowed": domain.AttemptOutcomePolicyBlocked,
		"merge conflict in a.go":                  domain.AttemptOutcomeConflict,
		"go vet exited 1":                         domain.AttemptOutcomeVerificationFailed,
	}
	for message, want := range cases {
		if got := repairAttemptOutcome(errString(message)); got != want {
			t.Fatalf("%q: got %q want %q", message, got, want)
		}
	}
}

type errString string

func (e errString) Error() string { return string(e) }

func TestExecutionFailureCauseSummaryPrefersStructuredAttribution(t *testing.T) {
	result := domain.ExecutionResult{Commands: []domain.CommandResult{{
		Argv:           []string{"npm", "test", "--", "--run", "src/components/Inspector.test.tsx"},
		ExitCode:       1,
		BaselineOutput: "Introduced by this change (fix these): failing Vitest test src/components/Inspector.test.tsx > keeps exactly one Supervisor pane",
	}}}
	got := executionFailureCauseSummary(result, errString("verification failed with a very long raw DOM dump"))
	if !strings.Contains(got, "failing Vitest test") || strings.Contains(got, "raw DOM dump") {
		t.Fatalf("expected structured attribution to win, got %q", got)
	}
}
