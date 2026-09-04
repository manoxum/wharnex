package app

import (
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPatchTouchedPathsIncludesCreateDeleteAndUpdate(t *testing.T) {
	patch := "diff --git a/old.txt b/old.txt\n--- a/old.txt\n+++ /dev/null\n" +
		"diff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n" +
		"diff --git a/edit.txt b/edit.txt\n--- a/edit.txt\n+++ b/edit.txt\n"
	got := patchTouchedPaths(patch)
	want := []string{"edit.txt", "new.txt", "old.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("paths=%v want=%v", got, want)
	}
}

func TestOverlapPathsUsesImpactForecast(t *testing.T) {
	got := overlapPaths([]string{"a.go", "ui/App.tsx", "docs/readme.md"}, []string{"ui/App.tsx", "other.go"})
	if !reflect.DeepEqual(got, []string{"ui/App.tsx"}) {
		t.Fatalf("overlap=%v", got)
	}
}

func TestEnrichPlanConcurrencyPreservesForecastAndAddsPatchPaths(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol:    domain.ProtocolV1,
		ImpactFiles: []string{"frontend/App.tsx"},
		Operations:  []domain.Operation{{Type: "apply_patch", Patch: "--- a/backend/a.go\n+++ b/backend/a.go\n@@ -1 +1 @@\n-a\n+b\n"}},
	}
	enrichPlanConcurrency(&plan, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if plan.BaseContextSHA256 != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("baseline=%q", plan.BaseContextSHA256)
	}
	want := []string{"frontend/App.tsx"}
	if !reflect.DeepEqual(plan.ImpactFiles, want) {
		t.Fatalf("impact=%v want=%v", plan.ImpactFiles, want)
	}
}

func TestPlanTouchedFilesCombinesForecastWithActualPatchPaths(t *testing.T) {
	plan := domain.ExecutionPlan{
		ImpactFiles: []string{"frontend/App.tsx"},
		Operations:  []domain.Operation{{Type: "apply_patch", Patch: "--- a/backend/a.go\n+++ b/backend/a.go\n@@ -1 +1 @@\n-a\n+b\n"}},
	}
	want := []string{"backend/a.go", "frontend/App.tsx"}
	if got := planTouchedFiles(&plan); !reflect.DeepEqual(got, want) {
		t.Fatalf("touched=%v want=%v", got, want)
	}
}

func TestCanFastForwardBaselineAcrossDisjointCompleteTransitions(t *testing.T) {
	const h0 = "0000000000000000000000000000000000000000000000000000000000000000"
	const h1 = "1111111111111111111111111111111111111111111111111111111111111111"
	const h2 = "2222222222222222222222222222222222222222222222222222222222222222"
	item := domain.Session{BaselineNotices: []domain.BaselineNotice{
		{PreviousSHA256: h0, NewSHA256: h1, ChangedFiles: []string{"a.go"}, CompleteDelta: true},
		{PreviousSHA256: h1, NewSHA256: h2, ChangedFiles: []string{"b.go"}, CompleteDelta: true},
	}}
	if !canFastForwardBaseline(item, h0, h2, []string{"ui.tsx"}) {
		t.Fatal("expected disjoint baseline chain to fast-forward")
	}
	if canFastForwardBaseline(item, h0, h2, []string{"b.go"}) {
		t.Fatal("overlapping baseline chain must not fast-forward")
	}
	item.BaselineNotices[1].CompleteDelta = false
	if canFastForwardBaseline(item, h0, h2, []string{"ui.tsx"}) {
		t.Fatal("incomplete baseline chain must not fast-forward")
	}
}

func TestRequestSupersededByBaselineContinuation(t *testing.T) {
	item := domain.Session{State: "baseline_update_pending", LastRequestID: "req-new"}
	if !requestSupersededByBaselineContinuation(item, "req-old") {
		t.Fatal("older request must be superseded while baseline adaptation is active")
	}
	if requestSupersededByBaselineContinuation(item, "req-new") {
		t.Fatal("replacement request must remain accepted")
	}
	item.State = "awaiting_plan"
	if requestSupersededByBaselineContinuation(item, "req-old") {
		t.Fatal("ordinary parallel pending requests are not superseded without a baseline continuation")
	}
}
