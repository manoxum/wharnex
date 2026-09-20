package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

// Temporary diagnostic replay of TestArchivedGitConflictResolutionPreservesOriginalCandidate.
func TestZZDebugArchivedResolution(t *testing.T) {
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
	afterFirst, _ := service.store.Get(started.ID)
	dumpCandidates(t, "após execução original", afterFirst)

	if err := os.WriteFile(apiPath, []byte("package replay\n\nconst API = \"host\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	conflicted, err := service.ApplyToHost(context.Background(), started.ID)
	if !errors.Is(err, ErrIntegrationConflict) {
		t.Fatalf("expected focused integration conflict, got %v", err)
	}
	dumpCandidates(t, "após 1º apply (conflito)", conflicted)
	if conflicted.IntegrationConflict != nil {
		t.Logf("CONFLITO: paths=%v plans=%v", conflicted.IntegrationConflict.Paths, conflicted.IntegrationConflict.OriginalPlanIDs)
	}

	if _, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.State = "failed"
		current.PendingManualRequestIDs = nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, applyErr := service.ApplyToHost(context.Background(), started.ID); applyErr == nil {
		t.Fatal("active conflict did not block stale Apply")
	}
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
	_, resolved, err := service.Execute(context.Background(), started.ID, false)
	if err != nil {
		t.Fatalf("resolution execute failed: %v", err)
	}
	dumpCandidates(t, "após resolução verificada", resolved)

	// Qual é o conteúdo de api.go em cada um dos lados do merge?
	resolvedCandidate := resolved.PendingHostChanges[len(resolved.PendingHostChanges)-1]
	baseRef := "refs/wharnex/base/" + resolvedCandidate.Plan.RequestID
	for _, ref := range []string{"HEAD", baseRef, resolvedCandidate.IntegrationBranch} {
		content, exists, readErr := sandbox.ReadFileAtRef(context.Background(), root, ref, "api.go")
		t.Logf("api.go @ %-46s exists=%v err=%v => %q", ref, exists, readErr, content)
	}

	_, applyErr := service.ApplyToHost(context.Background(), started.ID)
	t.Logf("APPLY FINAL => err=%v", applyErr)
	after, _ := service.store.Get(started.ID)
	dumpCandidates(t, "após apply final", after)
	if after.IntegrationConflict != nil {
		t.Logf("CONFLITO FINAL: paths=%v plans=%v", after.IntegrationConflict.Paths, after.IntegrationConflict.OriginalPlanIDs)
	}
	for _, event := range bus.History(started.ID) {
		switch event.Type {
		case "integration.merge_preflight_conflict", "integration.merge_started", "integration.selfheal_applied",
			"integration.selfheal_degraded", "changeset.conflict", "host.apply_started":
			t.Logf("EVENT %s %v", event.Type, event.Data)
		}
	}
}

func dumpCandidates(t *testing.T, label string, item domain.Session) {
	t.Helper()
	t.Logf("--- %s: state=%s candidatos=%d", label, item.State, len(item.PendingHostChanges))
	for _, change := range item.PendingHostChanges {
		t.Logf("      plan=%s branch=%q commit=%q changeset=%v impact=%v",
			change.Plan.PlanID, change.IntegrationBranch, change.IntegrationCommit, change.ChangeSet != nil, change.Plan.ImpactFiles)
	}
}
