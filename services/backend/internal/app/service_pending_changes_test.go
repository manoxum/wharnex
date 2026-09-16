package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// Regression test: a session whose sandbox verification already succeeded
// and recorded "verified" with a host-applicable candidate must not be left
// stuck there forever if the backend exits (crash, restart, redeploy) before
// the automatic post-verification Apply runs. The protocol forbids a second
// host-apply approval, so nothing else — not the frontend, not an operator —
// is expected to unstick it; only the engine itself can, on its next startup.
func TestStartupReconciliationAppliesAStrandedVerifiedCandidate(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "shared.txt")
	if err := os.WriteFile(file, []byte("one\ntwo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "stranded-plan", RequestID: "stranded-request", Status: "ready",
		Summary: "append a line", CommitMessage: "feat(demo): append a line", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/shared.txt\n+++ b/shared.txt\n@@ -1,2 +1,3 @@\n one\n two\n+MINE\n"}},
	}
	service := baseRootService(plan)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "change"); err != nil {
		t.Fatal(err)
	}
	// approved=false: the plan does not require approval (low risk, Manual
	// mode), so verification runs and completes, but Execute's own inline
	// host-apply hook only fires when the caller passed approved=true — this
	// reproduces exactly the gap where the process could exit right after
	// recording "verified" and before ever attempting the Apply.
	result, verified, err := service.Execute(context.Background(), started.ID, false)
	if err != nil || !result.Success {
		t.Fatalf("sandbox verification should succeed: result=%#v err=%v", result, err)
	}
	if verified.State != "verified" || len(hostApplicablePendingChanges(pendingHostChanges(verified))) == 0 {
		t.Fatalf("expected a stranded verified candidate, got state=%q pending=%d", verified.State, len(verified.PendingHostChanges))
	}

	// Simulate a backend restart: construct a fresh Service bound to the same
	// durable store, exactly as cmd/harness/main.go does on every boot.
	restarted := NewService(service.store, service.bus, service.context, fakePlanner{plan}, service.policy, service.runner)

	deadline := time.Now().Add(2 * time.Second)
	var current domain.Session
	for {
		var getErr error
		current, getErr = restarted.store.Get(started.ID)
		if getErr != nil {
			t.Fatal(getErr)
		}
		if current.State == "applied" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("startup reconciliation did not apply the stranded candidate: state=%q pending=%d", current.State, len(current.PendingHostChanges))
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(current.PendingHostChanges) != 0 {
		t.Fatalf("startup reconciliation left an unapplied candidate behind: %#v", current.PendingHostChanges)
	}
	merged, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(merged), "MINE") {
		t.Fatalf("startup reconciliation did not apply the verified patch to the host:\n%s", merged)
	}
	// The reconciliation goroutine's integration-branch cleanup runs after the
	// state write observed above; give it a moment to finish before
	// t.TempDir() removes the root out from under a still-running git
	// subprocess.
	time.Sleep(100 * time.Millisecond)
}
