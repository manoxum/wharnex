package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

// This is the minimized replay of chat 65a2830d-6b2a-4616-b75b-74b11d9b813f:
// a Git-native candidate conflicts on one path, the host advances again while
// the focused response is in flight, and the response is therefore executed
// from its immutable archive. Non-conflicting files from the original verified
// candidate must survive both that verification and the eventual host Apply.
func TestArchivedGitConflictResolutionPreservesOriginalCandidate(t *testing.T) {
	root := t.TempDir()
	apiPath := filepath.Join(root, "api.go")
	typesPath := filepath.Join(root, "types.go")
	for path, contents := range map[string]string{
		filepath.Join(root, "go.mod"):    "module example.test/replay\n\ngo 1.23\n",
		filepath.Join(root, "drift.txt"): "first host state\n",
		apiPath:                          "package replay\n\nconst API = \"base\"\n",
		typesPath:                        "package replay\n",
	} {
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	original := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "original", Status: "ready", Summary: "add API and types", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/api.go\n+++ b/api.go\n@@ -1,3 +1,3 @@\n package replay\n \n-const API = \"base\"\n+const API = \"candidate\"\n--- a/types.go\n+++ b/types.go\n@@ -1 +1,3 @@\n package replay\n+\n+type CandidateType struct{}\n"}},
	}
	bus := audit.NewBus()
	service := NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{original}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "add API and types"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), started.ID, false); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(apiPath, []byte("package replay\n\nconst API = \"host\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	conflicted, err := service.ApplyToHost(context.Background(), started.ID)
	if !errors.Is(err, ErrIntegrationConflict) {
		t.Fatalf("expected focused integration conflict, got %v", err)
	}
	if conflicted.IntegrationConflict == nil {
		t.Fatal("missing focused conflict state")
	}
	// A failed/preparation-lost focused turn must not expose the still-pending
	// original candidate through Apply. The incident did exactly that after the
	// first resolution failed, creating a second much larger conflict.
	if _, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.State = "failed"
		current.PendingManualRequestIDs = nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, applyErr := service.ApplyToHost(context.Background(), started.ID); applyErr == nil || !strings.Contains(applyErr.Error(), "finish the active planner/repair turn") {
		t.Fatalf("active conflict did not block stale Apply: %v", applyErr)
	}

	// This second host advance makes the focused response stale and forces the
	// same immutable-archive reconstruction used by the incident.
	if err := os.WriteFile(filepath.Join(root, "drift.txt"), []byte("later host work\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	requestID := conflicted.IntegrationConflict.RequestID
	_, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.Plan = &domain.ExecutionPlan{
			Protocol: domain.ProtocolV1, PlanID: "resolution", RequestID: requestID,
			BaseContextSHA256: conflicted.Context.Manifest.SHA256,
			Status:            "ready", Summary: "reconcile API", Risk: "low",
			ImpactFiles: []string{"api.go"}, ReadFiles: []string{"types.go", "drift.txt"},
			Operations:   []domain.Operation{{Type: "apply_patch", Patch: "--- a/api.go\n+++ b/api.go\n@@ -1,3 +1,3 @@\n package replay\n \n-const API = \"host\"\n+var API = CandidateType{} // host and candidate\n"}},
			Verification: []domain.CommandSpec{appCommand("go", "test", "./...")},
		}
		current.Policy = &domain.PolicyDecision{Allowed: true, Risk: "low"}
		current.State = "planned"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	result, resolved, err := service.Execute(context.Background(), started.ID, false)
	if err != nil || !result.Success {
		t.Fatalf("focused resolution lost the original non-conflict file: result=%#v err=%v", result, err)
	}
	if resolved.State != "verified" || resolved.IntegrationConflict != nil {
		t.Fatalf("focused resolution did not converge: state=%s conflict=%#v", resolved.State, resolved.IntegrationConflict)
	}
	if _, err = service.ApplyToHost(context.Background(), started.ID); err != nil {
		t.Fatal(err)
	}
	if contents, readErr := os.ReadFile(apiPath); readErr != nil || string(contents) != "package replay\n\nvar API = CandidateType{} // host and candidate\n" {
		t.Fatalf("resolved API was not applied: %q err=%v", contents, readErr)
	}
	if contents, readErr := os.ReadFile(typesPath); readErr != nil || string(contents) != "package replay\n\ntype CandidateType struct{}\n" {
		t.Fatalf("original non-conflict file was not applied: %q err=%v", contents, readErr)
	}
}
