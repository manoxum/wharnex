package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/changeset"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

// A staging failure never touched the host, so the verified candidate is
// intact and the divergence it describes is exactly what a planner round can
// answer. It used to be an unmarked plumbing error that no recovery path
// claimed, which left the request parked until a human noticed.
func TestIntegrationStagingFailureOpensAutomaticCorrection(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	seeded, err := store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.EffortLevel = domain.EffortLevelHigh
		item.LastRequestID = "req-original"
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan-original", Success: true}
		item.PendingHostChanges = []domain.PendingHostChange{{Plan: domain.ExecutionPlan{PlanID: "plan-original"}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	cause := plannerRepairableApplyFailure(errors.New("stage ChangeSet integration: " + ErrIntegrationStaging.Error() + ": merge shell.tsx: exit status 2"))
	repaired, err := service.TriggerApplyFailureRepair(context.Background(), seeded.ID, cause)
	if err != nil {
		t.Fatal(err)
	}
	if repaired.State != "repair_pending" || repaired.LastManualPrompt == "" {
		t.Fatalf("staging failure did not open an automatic correction: state=%q prompt=%d", repaired.State, len(repaired.LastManualPrompt))
	}
	if len(repaired.PendingManualRequestIDs) != 1 {
		t.Fatalf("pending manual requests=%v", repaired.PendingManualRequestIDs)
	}
}

// The effort level owns the budget: Wharnex escalates on its own until the
// attempts the operator already chose are spent, and only then stops.
func TestEscalationIsAutomaticUntilEffortBudgetIsSpent(t *testing.T) {
	conflicts := []domain.IntegrationConflictDetail{{Path: "a.ts", Reason: "overlapping text edits", Complexity: domain.ConflictComplexitySemantic, Hunks: 3, ResolvedHunks: 2}}

	auto := domain.Session{AutomationMode: domain.AutomationModeAuto, EffortLevel: domain.EffortLevelHigh, ConflictAttempt: 1, AutomationAttempt: 1}
	decision := classifyIntegrationEscalation(auto, conflicts)
	if !decision.Automatic {
		t.Fatalf("a budget with attempts left did not escalate automatically: %+v", decision)
	}
	if decision.Complexity != domain.ConflictComplexitySemantic {
		t.Fatalf("complexity=%q", decision.Complexity)
	}

	spent := auto
	spent.ConflictAttempt = policyForEffort(domain.EffortLevelHigh).MaxAttempts
	if decision := classifyIntegrationEscalation(spent, conflicts); decision.Automatic {
		t.Fatalf("a spent budget still escalated without a human: %+v", decision)
	}

	manual := auto
	manual.AutomationMode = domain.AutomationModeManual
	if decision := classifyIntegrationEscalation(manual, conflicts); decision.Automatic {
		t.Fatalf("manual automation mode escalated on its own: %+v", decision)
	}
}

// A structural collision has no patch-expressible answer, so spending a
// planner round on it only burns the budget that a resolvable conflict needs.
func TestStructuralConflictDoesNotSpendAPlannerRound(t *testing.T) {
	item := domain.Session{AutomationMode: domain.AutomationModeAuto, EffortLevel: domain.EffortLevelHigh}
	decision := classifyIntegrationEscalation(item, []domain.IntegrationConflictDetail{
		{Path: "a.ts", Reason: "overlapping text edits", Complexity: domain.ConflictComplexitySemantic},
		{Path: "logo.png", Reason: "binary content conflict", Complexity: domain.ConflictComplexityStructural},
	})
	if decision.Automatic {
		t.Fatalf("structural collision escalated to the planner: %+v", decision)
	}
	if decision.Complexity != domain.ConflictComplexityStructural {
		t.Fatalf("complexity=%q", decision.Complexity)
	}
}

// The resolver has to know the mechanical union was already tried and refused,
// or the first thing it proposes is the merge that just failed.
func TestConflictPromptCarriesLocalReconciliationEvidence(t *testing.T) {
	summary := conflictComplexitySummary([]domain.IntegrationConflictDetail{
		{Path: "shell.tsx", Reason: "overlapping text edits", Complexity: domain.ConflictComplexitySemantic, Hunks: 3, ResolvedHunks: 2},
	})
	if !strings.Contains(summary, "shell.tsx") || !strings.Contains(summary, "merged 2 of 3") {
		t.Fatalf("summary=%q", summary)
	}
	message := buildConflictResolutionMessage([]string{"shell.tsx"}, summary)
	if !strings.Contains(message, "token-granular three-way merge") {
		t.Fatalf("conflict prompt omitted the local attempt evidence:\n%s", message)
	}
	if empty := buildConflictResolutionMessage([]string{"shell.tsx"}, ""); strings.Contains(empty, "LOCAL RECONCILIATION") {
		t.Fatalf("conflict prompt invented evidence that does not exist:\n%s", empty)
	}
}

// A candidate that integrated only because the token tier caught a
// line-granularity artefact is a different Apply from one that never collided.
func TestReconciliationEvidenceDistinguishesTokenTierApplies(t *testing.T) {
	bus := audit.NewBus()
	publishReconciliationEvidence(bus, "ses-1", []changeset.Reconciliation{
		{Path: "a.css", Tier: changeset.MergeTierLine},
		{Path: "shell.tsx", Tier: changeset.MergeTierToken, Hunks: 2, TokenResolved: 2},
	})
	found := false
	for _, event := range bus.History("ses-1") {
		if event.Type != "integration.reconciled_locally" {
			continue
		}
		found = true
		if got, _ := event.Data["subline_resolved_hunks"].(int); got != 2 {
			t.Fatalf("subline_resolved_hunks=%v", event.Data["subline_resolved_hunks"])
		}
	}
	if !found {
		t.Fatal("missing local reconciliation evidence")
	}

	quiet := audit.NewBus()
	publishReconciliationEvidence(quiet, "ses-2", nil)
	if len(quiet.History("ses-2")) != 0 {
		t.Fatal("an Apply with nothing to reconcile still published reconciliation evidence")
	}
}
