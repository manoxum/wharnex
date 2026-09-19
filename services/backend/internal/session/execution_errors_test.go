package session

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestExecutionErrorsFallbackResolvesAllFailuresInRoot(t *testing.T) {
	store := NewStore()
	now := time.Now().UTC()
	for index, planID := range []string{"plan_one", "plan_two"} {
		if err := store.RecordExecutionError(domain.ExecutionErrorRecord{
			ID: planID, SessionID: "ses_1", ChatID: "chat_1", RootRequestID: "req_root", PlanID: planID,
			Stage: "execution", Error: "failed", Status: domain.ExecutionErrorStatusOpen,
			OccurredAt: now.Add(time.Duration(index) * time.Second), UpdatedAt: now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	count, err := store.ResolveExecutionErrors("ses_1", "req_root", domain.ExecutionErrorSolution{RequestID: "req_fix", PlanID: "plan_fix", Summary: "fixed"})
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("resolved count = %d, want 2", count)
	}
	items, err := store.ExecutionErrors("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].PlanID != "plan_two" {
		t.Fatalf("unexpected ordering/records: %#v", items)
	}
	for _, item := range items {
		if item.Status != domain.ExecutionErrorStatusSolved || item.GPTSolution == nil || item.GPTSolution.PlanID != "plan_fix" {
			t.Fatalf("unresolved record: %#v", item)
		}
	}
}
