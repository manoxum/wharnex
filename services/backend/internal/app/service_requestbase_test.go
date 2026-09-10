package app

import (
	"context"
	"os"
	"os/exec"
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

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

// peerIntegration simulates what another Harness chat (or a human, or an
// external agent) does to the host while this request is out at the planner:
// it advances the project with its own committed change.
func peerIntegration(t *testing.T, root, file, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, file), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", "-A")
	gitIn(t, root, "-c", "user.name=Peer", "-c", "user.email=peer@example.invalid", "commit", "-qm", "peer change")
}

func baseRootService(plan domain.ExecutionPlan) *Service {
	return NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
}

// This is the regression test for the recurring production failure: a patch is
// planned against one tree, an unrelated chat integrates a change to the same
// file first, and executing the original plan died with "patch does not apply
// cleanly" — a dead end that spent an AI repair round and could not be retried
// out of. The request base makes the patch apply to the tree it was written
// for, and the divergence becomes a merge Git resolves on its own.
func TestPlanSurvivesPeerIntegrationIntoTheSameFile(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "shared.txt")
	if err := os.WriteFile(file, []byte("one\ntwo\nthree\nfour\nfive\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "p1", RequestID: "placeholder", Status: "ready",
		Summary: "append a line", CommitMessage: "feat(demo): append a line", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/shared.txt\n+++ b/shared.txt\n@@ -1,5 +1,6 @@\n one\n two\n three\n four\n+MINE\n five\n"}},
	}
	service := baseRootService(plan)
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.SubmitMessage(context.Background(), created.ID, "change"); err != nil {
		t.Fatal(err)
	}
	// The plan is now authored against the tree captured above. A peer chat
	// integrates its own edit to the top of the very same file.
	peerIntegration(t, root, "shared.txt", "one\nPEER\nthree\nfour\nfive\n")

	// Force the branch that produced the reported failure: no immutable
	// archive is available, so the plan is rebased onto the current host.
	if _, err := service.store.Update(created.ID, func(item *domain.Session) error {
		item.RequestContextArchives = nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	result, _, err := service.Execute(context.Background(), created.ID, false)
	if err != nil {
		t.Fatalf("execution should survive a peer integration into the same file: %v", err)
	}
	if !result.Success {
		t.Fatal("sandbox verification should pass")
	}
	if _, err := service.ApplyToHost(context.Background(), created.ID); err != nil {
		t.Fatalf("apply should merge cleanly with no model turn: %v", err)
	}
	merged, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(merged), "PEER") {
		t.Fatalf("apply discarded the peer's integrated change:\n%s", merged)
	}
	if !strings.Contains(string(merged), "MINE") {
		t.Fatalf("apply lost this plan's own change:\n%s", merged)
	}
}

// The parentage is the whole mechanism: the integration commit must descend
// from the request's captured base, not from whatever the host advanced to,
// because that is what gives the later merge a meaningful merge-base.
func TestIntegrationCommitDescendsFromTheRequestBase(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("start\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "p2", RequestID: "placeholder", Status: "ready",
		Summary: "edit a", CommitMessage: "fix(demo): edit a", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-start\n+done\n"}},
	}
	service := baseRootService(plan)
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.SubmitMessage(context.Background(), created.ID, "change"); err != nil {
		t.Fatal(err)
	}
	item, err := service.store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := item.Plan.RequestID
	base := requestBaseCommit(item, requestID)
	if base == "" {
		t.Fatal("the request base was not captured")
	}
	// A peer advances the host on an unrelated file before this plan executes.
	peerIntegration(t, root, "other.txt", "peer file\n")

	if _, _, err := service.Execute(context.Background(), created.ID, false); err != nil {
		t.Fatalf("execute: %v", err)
	}
	branch := integrationBranchName(requestID)
	parent := gitIn(t, root, "rev-parse", branch+"^")
	if parent != base {
		t.Fatalf("integration commit parent is %s, expected the request base %s", parent, base)
	}
}

func TestRequestBaseIsCapturedWithoutDisturbingTheHost(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("start\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "p3", RequestID: "placeholder", Status: "ready", Summary: "s", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-start\n+done\n"}},
	}
	service := baseRootService(plan)
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	// An operator with work in progress must be untouched by base capture.
	if err := os.WriteFile(filepath.Join(root, "wip.txt"), []byte("in progress\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	headBefore := gitIn(t, root, "rev-parse", "HEAD")
	statusBefore := gitIn(t, root, "status", "--porcelain")
	branchesBefore := gitIn(t, root, "branch", "--list")

	if _, _, err := service.SubmitMessage(context.Background(), created.ID, "change"); err != nil {
		t.Fatal(err)
	}
	if after := gitIn(t, root, "rev-parse", "HEAD"); after != headBefore {
		t.Fatalf("base capture moved HEAD: %s -> %s", headBefore, after)
	}
	if after := gitIn(t, root, "status", "--porcelain"); after != statusBefore {
		t.Fatalf("base capture changed the working tree:\n%s\n---\n%s", statusBefore, after)
	}
	if after := gitIn(t, root, "branch", "--list"); after != branchesBefore {
		t.Fatalf("base capture created a visible branch: %q", after)
	}
	item, err := service.store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if requestBaseCommit(item, item.Plan.RequestID) == "" {
		t.Fatal("expected a captured request base")
	}
}

func TestRecordRequestBaseCommitEvictsOnlyReleasableAnchors(t *testing.T) {
	item := &domain.Session{LastRequestID: "keep-active", PendingManualRequestIDs: []string{"keep-pending"}}
	recordRequestBaseCommit(item, "keep-active", "a1")
	recordRequestBaseCommit(item, "keep-pending", "a2")
	var released []string
	for index := 0; index < maxRetainedRequestBases+5; index++ {
		released = append(released, recordRequestBaseCommit(item, "req-"+string(rune('a'+index)), "sha")...)
	}
	if len(released) == 0 {
		t.Fatal("expected eviction beyond the retention bound")
	}
	for _, id := range released {
		if id == "keep-active" || id == "keep-pending" {
			t.Fatalf("evicted an anchor that is still needed: %s", id)
		}
	}
	if _, ok := item.RequestBaseCommits["keep-active"]; !ok {
		t.Fatal("the active request's base was evicted")
	}
	if _, ok := item.RequestBaseCommits["keep-pending"]; !ok {
		t.Fatal("a pending request's base was evicted")
	}
}
