package postintegration

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestRepairCannotSubstituteForRuntimeObservation(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"source":       {Kind: "evidence"},
		"post":         {Kind: RequestKind, ParentRequestID: "source"},
		"repair":       {Kind: "repair", ParentRequestID: "post"},
		"context":      {Kind: "context_request", ParentRequestID: "repair"},
		"observed":     {Kind: "evidence", ParentRequestID: "context"},
		"later-repair": {Kind: "repair", ParentRequestID: "observed"},
	}}
	for _, id := range []string{"post", "repair", "context"} {
		if !RequiresObservation(item, id) {
			t.Fatalf("premature runtime conclusion allowed: %s", id)
		}
	}
	for _, id := range []string{"source", "observed", "later-repair", "unrelated"} {
		if RequiresObservation(item, id) {
			t.Fatalf("actual evidence or unrelated request blocked: %s", id)
		}
	}
	item.RequestLineages["cycle"] = domain.RequestLineage{ParentRequestID: "cycle"}
	if !RequiresObservation(item, "cycle") {
		t.Fatal("corrupt cyclic lineage must fail closed")
	}
}
