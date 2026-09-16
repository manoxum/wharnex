package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestReasoningEffortPersistsPerSession(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	first, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if first.ReasoningEffort != domain.ReasoningEffortHigh {
		t.Fatalf("default reasoning effort=%q, want high", first.ReasoningEffort)
	}
	updated, err := service.SetReasoningEffort(first.ID, domain.ReasoningEffortInstant)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ReasoningEffort != domain.ReasoningEffortInstant {
		t.Fatalf("updated reasoning effort=%q", updated.ReasoningEffort)
	}
	unchanged, err := service.GetSession(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.ReasoningEffort != domain.ReasoningEffortHigh {
		t.Fatalf("peer session reasoning effort changed to %q", unchanged.ReasoningEffort)
	}
	if _, err := service.SetReasoningEffort(first.ID, domain.ReasoningEffort("extreme")); err == nil {
		t.Fatal("invalid reasoning effort was accepted")
	}
}
