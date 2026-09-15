package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// pushSetup builds a host repository, a bare remote, and a peer clone that has
// already advanced the remote — the ordinary shape of "someone else pushed
// while you were working".
func pushSetup(t *testing.T, service *Service, conflicting bool) (root, sessionID, remote string) {
	t.Helper()
	remote = filepath.Join(t.TempDir(), "remote.git")
	runGitForApp(t, t.TempDir(), "init", "-q", "--bare", "-b", "main", remote)
	root = gitRepo(t, "shared.txt", "base\n")
	runGitForApp(t, root, "remote", "add", "origin", remote)
	runGitForApp(t, root, "push", "-q", "--set-upstream", "origin", "main")

	peer := filepath.Join(t.TempDir(), "peer")
	runGitForApp(t, t.TempDir(), "clone", "-q", remote, peer)
	peerContent := "peer\n"
	if !conflicting {
		if err := os.WriteFile(filepath.Join(peer, "peer-only.txt"), []byte("peer\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	} else {
		if err := os.WriteFile(filepath.Join(peer, "shared.txt"), []byte(peerContent), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	runGitForApp(t, peer, "add", "-A")
	runGitForApp(t, peer, "commit", "-qm", "feat(shared): peer rewrites the shared line")
	runGitForApp(t, peer, "push", "-q", "origin", "main")

	sessionID = startGitSession(t, service, root)
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "chore: project config")
	if err := os.WriteFile(filepath.Join(root, "shared.txt"), []byte("mine\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "commit", "-qam", "feat(shared): my own rewrite of the shared line")
	return root, sessionID, remote
}

// A rejected push is not a dead end: the remote simply holds work this branch
// does not, which is an ordinary merge.
func TestPushIntegratesRemoteWorkAndPushesAgain(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root, sessionID, _ := pushSetup(t, service, false)

	result, err := service.PushBranch(context.Background(), sessionID, "origin", "main", false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Integrated {
		t.Fatalf("the remote's work should have been integrated, got %+v", result)
	}
	if result.Outcome != string(hostrepo.PushOutcomePushed) {
		t.Fatalf("expected a successful second push, got %+v", result)
	}
	if _, statErr := os.Stat(filepath.Join(root, "peer-only.txt")); statErr != nil {
		t.Fatalf("the peer's file must be present locally after integrating: %v", statErr)
	}
}

// When integrating the remote conflicts, the merge is aborted and the conflict
// becomes a bounded planner request — never a repository left mid-merge.
func TestPushConflictRequestsResolutionAndLeavesTheRepositoryUsable(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root, sessionID, _ := pushSetup(t, service, true)

	result, err := service.PushBranch(context.Background(), sessionID, "origin", "main", false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "conflict" || result.ConflictID == "" {
		t.Fatalf("expected a conflict routed to resolution, got %+v", result)
	}
	// Wharnex's own integration refuses to act on a repository with unresolved
	// paths, so leaving the merge in place would block every Agent request on
	// this project until a human intervened.
	state, err := hostrepo.Working(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Unmerged) != 0 {
		t.Fatalf("the repository must be left usable, got unmerged %+v", state.Unmerged)
	}
	if topology, _ := hostrepo.Inspect(context.Background(), root); topology.InProgress != hostrepo.OperationNone {
		t.Fatalf("no Git operation may be left in progress, got %q", topology.InProgress)
	}

	item, err := service.GetSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if item.IntegrationConflict == nil || item.IntegrationConflict.Git == nil {
		t.Fatalf("expected a Git-origin conflict recorded, got %+v", item.IntegrationConflict)
	}
	gitContext := item.IntegrationConflict.Git
	if gitContext.Origin != domain.GitConflictOriginPush || gitContext.Ref != "origin/main" {
		t.Fatalf("unexpected conflict context %+v", gitContext)
	}
	if gitContext.BaseSHA == "" || gitContext.OursSHA == "" || gitContext.TheirsSHA == "" {
		t.Fatalf("all three merge sides must be recorded so the merge can be replayed, got %+v", gitContext)
	}
	if item.State != "conflict_resolution_pending" {
		t.Fatalf("expected the session awaiting a resolution, got %q", item.State)
	}
	// Large BASE/CURRENT/RESULT bodies travel as a request file, never inline in
	// the prompt that Desktop bounds at 1 MiB.
	if !strings.Contains(item.LastManualPrompt, conflictCapsuleArtifactPath) {
		t.Fatal("the prompt must direct the resolver to the attached capsule")
	}
	var capsuleRaw []byte
	for _, artifact := range service.RequestContinuationArtifacts(sessionID, item.LastRequestID) {
		if artifact.Name == conflictCapsuleArtifactPath {
			capsuleRaw = artifact.Raw
		}
	}
	if !strings.Contains(string(capsuleRaw), `"origin": "push"`) {
		t.Fatal("the capsule must tell the resolver this is a push integration")
	}
	if !strings.Contains(string(capsuleRaw), "peer rewrites the shared line") {
		t.Fatal("the incoming side's own purpose must travel with the conflict")
	}
}

// The resolution is replayed into the same merge and committed as its merge
// commit, rather than becoming a new verified candidate.
func TestConcludeGitConflictCommitsTheMerge(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root, sessionID, _ := pushSetup(t, service, true)
	if _, err := service.PushBranch(context.Background(), sessionID, "origin", "main", false); err != nil {
		t.Fatal(err)
	}
	item, err := service.GetSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}

	// The patch is authored against CURRENT ("mine"), which is exactly what
	// BeginMergeResolution puts on disk before applying it.
	patch := strings.Join([]string{
		"--- a/shared.txt",
		"+++ b/shared.txt",
		"@@ -1 +1,2 @@",
		"-mine",
		"+mine",
		"+peer",
		"",
	}, "\n")
	plan := &domain.ExecutionPlan{
		Protocol: "harness.execution/v1", PlanID: "plan_res", RequestID: item.IntegrationConflict.RequestID,
		Summary:    "keep both sides of the shared line",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: patch}},
	}

	updated, err := service.concludeGitConflict(context.Background(), sessionID, item, plan)
	if err != nil {
		t.Fatal(err)
	}
	if updated.IntegrationConflict != nil {
		t.Fatal("the conflict must be cleared once the merge is committed")
	}
	body, err := os.ReadFile(filepath.Join(root, "shared.txt"))
	if err != nil || !strings.Contains(string(body), "mine") || !strings.Contains(string(body), "peer") {
		t.Fatalf("both sides must survive the reconciliation, got %q err=%v", body, err)
	}
	commits, err := hostrepo.Log(context.Background(), root, 5)
	if err != nil {
		t.Fatal(err)
	}
	if !commits[0].Merge {
		t.Fatalf("the resolution must land as a real merge commit, got %+v", commits[0])
	}
	// The commit is honest about being AI-assisted, so history stays readable.
	if !strings.Contains(commits[0].Body, "Wharnex assistance") {
		t.Fatalf("the merge commit must record its own provenance, got %q", commits[0].Body)
	}
	if state, _ := hostrepo.Working(context.Background(), root); len(state.Unmerged) != 0 {
		t.Fatal("the merge must be fully concluded")
	}
	// Publishing the reconciled code stays an explicit push, never automatic.
	if commits[0].Pushed {
		t.Fatal("an AI-assisted merge must not be published without another explicit push")
	}
}

// An explicit branch merge takes the same route.
func TestMergeBranchConflictRoutesToResolution(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	root := gitRepo(t, "shared.txt", "base\n")
	sessionID := startGitSession(t, service, root)
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "chore: project config")
	runGitForApp(t, root, "checkout", "-q", "-b", "other")
	if err := os.WriteFile(filepath.Join(root, "shared.txt"), []byte("other\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "commit", "-qam", "feat(shared): the other branch's take")
	runGitForApp(t, root, "checkout", "-q", "main")
	if err := os.WriteFile(filepath.Join(root, "shared.txt"), []byte("mine\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "commit", "-qam", "feat(shared): my take")

	result, err := service.MergeBranchIntoCurrent(context.Background(), sessionID, "other")
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != string(hostrepo.MergeOutcomeConflict) || result.ConflictID == "" {
		t.Fatalf("expected a conflict routed to resolution, got %+v", result)
	}
	item, _ := service.GetSession(sessionID)
	if item.IntegrationConflict.Git.Origin != domain.GitConflictOriginBranchMerge {
		t.Fatalf("expected a branch_merge origin, got %+v", item.IntegrationConflict.Git)
	}
	if state, _ := hostrepo.Working(context.Background(), root); len(state.Unmerged) != 0 {
		t.Fatal("a conflicting merge must leave the repository usable")
	}
}
