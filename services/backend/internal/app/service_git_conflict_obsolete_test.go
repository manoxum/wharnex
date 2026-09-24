package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The operator resolved a Wharnex-recorded push conflict by hand. The Git
// surface must stop reporting a conflict "in resolution", and a planner answer
// that arrives afterwards must not be replayed or planned as new work.
func TestHandResolvedGitConflictIsRetiredAndItsLateAnswerIgnored(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root, sessionID, _ := pushSetup(t, service, true)
	ctx := context.Background()
	if _, err := service.PushBranch(ctx, sessionID, "origin", "main", false); err != nil {
		t.Fatal(err)
	}
	before, err := service.GetSession(sessionID)
	if err != nil || before.IntegrationConflict == nil {
		t.Fatalf("expected a recorded conflict, got %+v err=%v", before.IntegrationConflict, err)
	}
	requestID := before.IntegrationConflict.RequestID

	overview, err := service.GitOverview(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if overview.Conflict == nil {
		t.Fatal("a conflict whose merge has not landed must still be reported")
	}

	// The merge conflicts and exits non-zero; the operator resolves it below.
	_ = exec.Command("git", "-C", root, "merge", "-q", "origin/main").Run()
	if err := os.WriteFile(filepath.Join(root, "shared.txt"), []byte("mine\npeer\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "add", "shared.txt")
	runGitForApp(t, root, "commit", "-qm", "merge origin/main by hand")

	overview, err = service.GitOverview(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if overview.Conflict != nil {
		t.Fatalf("a merge concluded by hand must retire the conflict card, got %+v", overview.Conflict)
	}
	after, err := service.GetSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if after.IntegrationConflict != nil || after.State != "ready" {
		t.Fatalf("expected the session released for new work, got state=%q conflict=%+v", after.State, after.IntegrationConflict)
	}
	for _, pending := range after.PendingManualRequestIDs {
		if pending == requestID {
			t.Fatal("the retired conflict request must no longer be pending")
		}
	}

	submission, ignored, err := service.ignoreObsoleteConflictAnswer(sessionID, after, requestID)
	if err != nil || !ignored {
		t.Fatalf("a late answer to a retired conflict must be ignored, ignored=%v err=%v", ignored, err)
	}
	if submission.Session.Plan != nil {
		t.Fatal("the late answer must not become a planned candidate")
	}
}

func TestOpenGitConflictAnswerIsNotIgnored(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	_, sessionID, _ := pushSetup(t, service, true)
	if _, err := service.PushBranch(context.Background(), sessionID, "origin", "main", false); err != nil {
		t.Fatal(err)
	}
	item, err := service.GetSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ignored, _ := service.ignoreObsoleteConflictAnswer(sessionID, item, item.IntegrationConflict.RequestID); ignored {
		t.Fatal("the answer to a still-open conflict must be processed")
	}
}
