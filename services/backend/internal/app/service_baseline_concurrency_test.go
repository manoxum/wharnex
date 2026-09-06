package app

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestParallelMutationDoesNotSupersedePendingPlannerRequest(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "a.txt")
	if err := os.WriteFile(path, []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	source, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	peer, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	const requestID = "req-original"
	peer, err = service.store.Update(peer.ID, func(item *domain.Session) error {
		item.State = "awaiting_plan"
		item.LastRequestID = requestID
		item.LastManualPrompt = "original prompt"
		item.PendingManualRequestIDs = []string{requestID}
		recordRequestBaseline(item, requestID, item.Context.Manifest.SHA256)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	oldSHA := peer.Context.Manifest.SHA256
	if err := os.WriteFile(path, []byte("parallel\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	refreshedSource, err := service.refreshContext(source.ID)
	if err != nil {
		t.Fatal(err)
	}
	service.publishBaselineUpdate(context.Background(), refreshedSource, oldSHA, refreshedSource.Context.Manifest.SHA256, "parallel-plan", []string{"a.txt"})

	updated, err := service.store.Get(peer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.LastRequestID != requestID || updated.State != "awaiting_plan" {
		t.Fatalf("parallel update superseded useful in-flight work: request=%q state=%q", updated.LastRequestID, updated.State)
	}
	if len(updated.BaselineNotices) != 1 {
		t.Fatalf("expected an informational baseline notice, got %d", len(updated.BaselineNotices))
	}
}

func TestStartupRestoresStrandedFocusedConflictRequest(t *testing.T) {
	store := session.NewStore()
	const requestID = "req_conflict_restore"
	item := domain.Session{
		ID: "ses_conflict_restore", ProjectPath: t.TempDir(), State: "failed", LastRequestID: requestID,
		LastManualPrompt:    "focused conflict prompt",
		IntegrationConflict: &domain.ConflictResolution{ID: "conflict_restore", RequestID: requestID, Paths: []string{"copy.go"}},
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	restored, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.State != "conflict_resolution_pending" || !containsString(restored.PendingManualRequestIDs, requestID) {
		t.Fatalf("focused conflict was not restored: %#v", restored)
	}
}

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
