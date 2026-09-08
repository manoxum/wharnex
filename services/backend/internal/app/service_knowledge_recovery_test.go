package app

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestKnowledgeReviewDeliveryFailurePreservesAppliedTask(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	bus := audit.NewBus()
	service := NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{PlanID: "plan-applied", RequestID: "req-main", Status: "ready"}
	execution := &domain.ExecutionResult{PlanID: plan.PlanID, Success: true}
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		item.State = "applied"
		item.Plan = plan
		item.LastExecution = execution
		item.LastHostAppliedAt = time.Now().UTC()
		item.LastRequestID = "req-main"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	service.triggerKnowledgeReview(context.Background(), started.ID)
	pending, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	reviewID := pending.PendingKnowledgeReviewRequestID
	if reviewID == "" {
		t.Fatal("expected a pending knowledge review")
	}

	failed, err := service.FailRemoteInputRequestWithKind(context.Background(), started.ID, reviewID, "prepared prompt rejected", "bundle_validation")
	if err != nil {
		t.Fatal(err)
	}
	if failed.State != "applied" || failed.Plan != plan || failed.LastExecution != execution {
		t.Fatalf("knowledge review failure mutated the applied task: %#v", failed)
	}
	if failed.PendingKnowledgeReviewRequestID != "" || containsString(failed.PendingManualRequestIDs, reviewID) || failed.LastManualPrompt != "" {
		t.Fatalf("failed knowledge review remained pending: %#v", failed)
	}
	if failed.LastRequestID != "req-main" || failed.LastRepairError != "" || failed.RemoteRecoveryAttempt != 0 {
		t.Fatalf("knowledge review failure polluted main request recovery state: %#v", failed)
	}
	history := bus.History(started.ID)
	found := false
	for _, event := range history {
		if event.Type == "knowledge.review_delivery_failed" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected knowledge.review_delivery_failed event")
	}
}

func TestStartupRepairsLegacyKnowledgeReviewPromptAndFailedState(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(t.TempDir(), "sessions.json")
	store, err := session.NewPersistentStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendProjectKnowledge(root, "# Operational knowledge\n\n- Keep the verified candidate when only dependency hydration failed.\n", "req-earlier"); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()
	builder := contextbundle.NewBuilder(1<<20, 1<<20)
	service := NewService(store, bus, builder, manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{PlanID: "plan-applied", RequestID: "req-main", Status: "ready"}
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		item.State = "applied"
		item.Plan = plan
		item.LastExecution = &domain.ExecutionResult{PlanID: plan.PlanID, Success: true}
		item.LastHostAppliedAt = time.Now().UTC()
		item.LastRequestID = "req-main"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	service.triggerKnowledgeReview(context.Background(), started.ID)
	pending, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	reviewID := pending.PendingKnowledgeReviewRequestID
	snapshot, err := requestKnowledgeSnapshot(pending, reviewID)
	if err != nil {
		t.Fatal(err)
	}
	legacyPrompt := "WHX KNOWLEDGE REVIEW\nREQUEST ID: " + reviewID + "\nCurrent project knowledge document (version=1 sha256=" + snapshot.SHA256 + "):\n" + snapshot.Content
	if _, err := store.Update(started.ID, func(item *domain.Session) error {
		item.State = "failed"
		item.PendingManualRequestIDs = nil
		item.LastManualPrompt = legacyPrompt
		item.LastRepairError = remoteInputFailurePrefix + "Prepared prompt does not contain the request knowledge identity/content"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	restoredStore, err := session.NewPersistentStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	restarted := NewService(restoredStore, audit.NewBus(), builder, manualplanner.New(), policy.NewEngine(), fakeRunner{})
	recovered, err := restarted.GetSession(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != "applied" || recovered.LastExecution == nil || !recovered.LastExecution.Success || recovered.Plan == nil || recovered.Plan.PlanID != plan.PlanID {
		t.Fatalf("startup did not restore the already-applied task: %#v", recovered)
	}
	if recovered.PendingKnowledgeReviewRequestID != reviewID || !containsString(recovered.PendingManualRequestIDs, reviewID) {
		t.Fatalf("startup did not re-arm the knowledge review identity: %#v", recovered)
	}
	identity := "Knowledge identity: version=1 sha256=" + snapshot.SHA256
	if !strings.Contains(recovered.LastManualPrompt, identity) || !strings.Contains(recovered.LastManualPrompt, strings.TrimSpace(snapshot.Content)) {
		t.Fatalf("startup did not regenerate canonical knowledge identity/content: %q", recovered.LastManualPrompt)
	}
	if !strings.Contains(recovered.LastManualPrompt, expectedResponseBundleFilename(recovered, reviewID)) || !strings.Contains(recovered.LastManualPrompt, "REQUEST ID: "+reviewID) {
		t.Fatalf("regenerated prompt does not use the pending review identity: %q", recovered.LastManualPrompt)
	}
	if recovered.LastRequestID != "req-main" || recovered.LastRepairError != "" {
		t.Fatalf("startup recovery corrupted the main request identity/failure state: %#v", recovered)
	}
}

func TestRecoverPostApplyStatePreservesSelfEvolutionActivation(t *testing.T) {
	item := domain.Session{
		State:                   "failed",
		SelfEvolutionActivation: "restart_pending",
		LastExecution:           &domain.ExecutionResult{Success: true},
		LastHostAppliedAt:       time.Now().UTC(),
		LastRepairError:         remoteInputFailurePrefix + "review transport failed",
	}
	state, ok := recoverPostApplyState(item)
	if !ok || state != "restart_pending" {
		t.Fatalf("recoverPostApplyState = %q, %v; want restart_pending, true", state, ok)
	}
}
